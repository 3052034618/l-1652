import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { PurchaseStatus, UserRole } from '../types';
import { broadcastPurchaseUpdate } from './socket';
import {
  notifyPurchaseRequest,
  notifyPurchaseApproved,
  getAllAdmins,
  createNotification,
} from './notification';

export async function createPurchaseRequest(
  ingredientId: string,
  quantity: number,
  requestedBy: string,
  supplierId?: string,
  estimatedPrice?: number,
  remark?: string
) {
  const result = await query(
    'INSERT INTO purchase_requests ' +
    '  (ingredient_id, quantity, requested_by, supplier_id, estimated_price, remark) ' +
    'VALUES ($1, $2, $3, $4, $5, $6) ' +
    'RETURNING *',
    [ingredientId, quantity, requestedBy, supplierId || null, estimatedPrice || null, remark || null]
  );

  const purchase = result.rows[0];
  broadcastPurchaseUpdate(purchase);

  const admins = await getAllAdmins();
  const adminIds = admins.map((a: { id: string }) => a.id);

  const ingredientResult = await query('SELECT name FROM ingredients WHERE id = $1', [ingredientId]);
  const ingredientName = ingredientResult.rows[0]?.name || 'ingredient';

  await notifyPurchaseRequest(adminIds, ingredientName, quantity);

  return purchase;
}

export async function checkAndCreatePurchaseRequest(ingredientId: string) {
  const ingredientResult = await query('SELECT * FROM ingredients WHERE id = $1', [ingredientId]);
  if (ingredientResult.rows.length === 0) return null;

  const ingredient = ingredientResult.rows[0];

  const existingRequest = await query(
    'SELECT * FROM purchase_requests ' +
    "WHERE ingredient_id = $1 AND status IN ('pending', 'approved', 'ordered', 'supplier_accepted', 'shipping')",
    [ingredientId]
  );
  if (existingRequest.rows.length > 0) return null;

  const reorderQuantity = Math.max(
    parseFloat(ingredient.safety_stock) * 2,
    parseFloat(ingredient.safety_stock) - parseFloat(ingredient.current_stock)
  );

  const systemUserId = await getSystemUserId();
  return createPurchaseRequest(ingredientId, reorderQuantity, systemUserId, ingredient.supplier_id);
}

async function getSystemUserId(): Promise<string> {
  const result = await query("SELECT id FROM users WHERE role = $1 LIMIT 1", [UserRole.ADMIN]);
  if (result.rows.length > 0) return result.rows[0].id;
  return '00000000-0000-0000-0000-000000000000';
}

export async function approvePurchaseRequest(
  purchaseId: string,
  approvedBy: string,
  approved: boolean,
  remark?: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query('SELECT * FROM purchase_requests WHERE id = $1', [purchaseId]);
    if (current.rows.length === 0) {
      throw new AppError('Purchase request not found', 404);
    }
    const purchase = current.rows[0];

    if (purchase.status !== PurchaseStatus.PENDING) {
      throw new AppError('Purchase request already processed', 400);
    }

    const newStatus = approved ? PurchaseStatus.APPROVED : PurchaseStatus.REJECTED;
    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, remark = COALESCE($3, remark) ' +
      'WHERE id = $4 ' +
      'RETURNING *',
      [newStatus, approvedBy, remark || null, purchaseId]
    );
    const updatedPurchase = result.rows[0];

    if (approved) {
      await client.query("UPDATE purchase_requests SET status = 'ordered' WHERE id = $1", [purchaseId]);
      updatedPurchase.status = PurchaseStatus.ORDERED;
    }

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updatedPurchase);

    if (approved && purchase.supplier_id) {
      const ingResult = await client.query('SELECT name FROM ingredients WHERE id = $1', [purchase.ingredient_id]);
      await notifyPurchaseApproved(
        purchase.supplier_id,
        ingResult.rows[0]?.name || 'ingredient',
        purchase.quantity
      );
    }
    return updatedPurchase;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getSupplierPurchases(supplierId: string, status?: PurchaseStatus) {
  let sql =
    'SELECT pr.*, i.name as ingredient_name, i.unit as ingredient_unit, ' +
    '       i.current_stock as current_stock, i.safety_stock as safety_stock, ' +
    '       u1.name as requester_name, u2.name as approver_name ' +
    'FROM purchase_requests pr ' +
    'JOIN ingredients i ON pr.ingredient_id = i.id ' +
    'JOIN users u1 ON pr.requested_by = u1.id ' +
    'LEFT JOIN users u2 ON pr.approved_by = u2.id ' +
    'WHERE pr.supplier_id = $1';
  const params: any[] = [supplierId];
  let idx = 2;

  if (status) {
    sql += ' AND pr.status = $' + idx;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY pr.created_at DESC';
  const result = await query(sql, params);
  return result.rows.map((r: any) => enrichPurchase(r));
}

export async function supplierAcceptOrder(
  purchaseId: string,
  supplierId: string,
  expectedDeliveryTime?: string,
  remark?: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1 AND supplier_id = $2',
      [purchaseId, supplierId]
    );
    if (current.rows.length === 0) {
      throw new AppError('No permission or purchase not found', 403);
    }
    const pr = current.rows[0];

    if (pr.status !== PurchaseStatus.ORDERED) {
      throw new AppError('Cannot accept in status: ' + pr.status, 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    supplier_accepted_at = CURRENT_TIMESTAMP, ' +
      '    expected_delivery_time = $2, ' +
      '    remark = COALESCE($3, remark) ' +
      'WHERE id = $4 ' +
      'RETURNING *',
      [PurchaseStatus.SUPPLIER_ACCEPTED, expectedDeliveryTime || null, remark || null, purchaseId]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingResult = await query('SELECT name FROM ingredients WHERE id = $1', [pr.ingredient_id]);
    const ingredientName = ingResult.rows[0]?.name || 'ingredient';
    const expectedTimeText = expectedDeliveryTime || 'TBD';
    const notifyMsg =
      'Purchase order [' + ingredientName + '] accepted by supplier, ETA: ' + expectedTimeText;

    for (const adminId of adminIds) {
      await createNotification(adminId, 'purchase_updated', 'Supplier accepted order', notifyMsg, {
        purchaseId,
        expectedDeliveryTime,
      });
    }
    return updatedPurchase;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function supplierRejectOrder(purchaseId: string, supplierId: string, reason: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1 AND supplier_id = $2',
      [purchaseId, supplierId]
    );
    if (current.rows.length === 0) {
      throw new AppError('No permission or purchase not found', 403);
    }
    const pr = current.rows[0];

    if (pr.status !== PurchaseStatus.ORDERED) {
      throw new AppError('Cannot reject in status: ' + pr.status, 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    remark = COALESCE($2, remark) ' +
      'WHERE id = $3 ' +
      'RETURNING *',
      [PurchaseStatus.SUPPLIER_REJECTED, reason || 'Supplier rejected', purchaseId]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingResult = await query('SELECT name FROM ingredients WHERE id = $1', [pr.ingredient_id]);
    const ingredientName = ingResult.rows[0]?.name || 'ingredient';
    const rejectMsg = 'Purchase order [' + ingredientName + '] rejected by supplier: ' + reason;

    for (const adminId of adminIds) {
      await createNotification(adminId, 'purchase_updated', 'Supplier rejected order', rejectMsg, {
        purchaseId,
        reason,
      });
    }
    return updatedPurchase;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function startShipping(
  purchaseId: string,
  supplierId: string,
  trackingNo?: string,
  expectedDeliveryTime?: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1 AND supplier_id = $2',
      [purchaseId, supplierId]
    );
    if (current.rows.length === 0) {
      throw new AppError('No permission or purchase not found', 403);
    }
    const pr = current.rows[0];

    const allowedStatuses = [PurchaseStatus.ORDERED, PurchaseStatus.SUPPLIER_ACCEPTED];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('Cannot ship in status: ' + pr.status, 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    tracking_no = $2, ' +
      '    expected_delivery_time = COALESCE($3, expected_delivery_time), ' +
      '    supplier_accepted_at = COALESCE(supplier_accepted_at, CURRENT_TIMESTAMP) ' +
      'WHERE id = $4 ' +
      'RETURNING *',
      [PurchaseStatus.SHIPPING, trackingNo || null, expectedDeliveryTime || null, purchaseId]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingResult = await query('SELECT name FROM ingredients WHERE id = $1', [pr.ingredient_id]);
    const ingredientName = ingResult.rows[0]?.name || 'ingredient';
    const trackingPart = trackingNo ? ', tracking: ' + trackingNo : '';
    const shipMsg = 'Purchase order [' + ingredientName + '] has shipped' + trackingPart;

    for (const adminId of adminIds) {
      await createNotification(adminId, 'purchase_updated', 'Supplier shipped order', shipMsg, {
        purchaseId,
        trackingNo,
      });
    }
    return updatedPurchase;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmDelivery(purchaseId: string, operatorId: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const purchase = await client.query('SELECT * FROM purchase_requests WHERE id = $1', [purchaseId]);
    if (purchase.rows.length === 0) {
      throw new AppError('Purchase request not found', 404);
    }
    const pr = purchase.rows[0];

    const allowedStatuses = [
      PurchaseStatus.ORDERED,
      PurchaseStatus.SUPPLIER_ACCEPTED,
      PurchaseStatus.SHIPPING,
    ];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('Cannot confirm delivery in status: ' + pr.status, 400);
    }

    const result = await client.query(
      "UPDATE purchase_requests " +
      "SET status = 'delivered', " +
      "    delivered_at = CURRENT_TIMESTAMP, " +
      "    actual_delivery_time = CURRENT_TIMESTAMP " +
      "WHERE id = $1 " +
      "RETURNING *",
      [purchaseId]
    );
    const updatedPurchase = result.rows[0];

    const ingredientResult = await client.query(
      'UPDATE ingredients ' +
      'SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP ' +
      'WHERE id = $2 ' +
      'RETURNING *',
      [pr.quantity, pr.ingredient_id]
    );

    const inStockRemark = 'Purchase in, order_id: ' + purchaseId + ', operator: ' + operatorId;
    await client.query(
      'INSERT INTO ingredient_stock_records ' +
      '  (ingredient_id, quantity, type, remark) ' +
      "VALUES ($1, $2, 'in', $3)",
      [pr.ingredient_id, pr.quantity, inStockRemark]
    );

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updatedPurchase);

    if (pr.supplier_id) {
      await createNotification(
        pr.supplier_id,
        'purchase_updated',
        'Purchase delivered and received',
        'Your delivery has been confirmed and stocked. Thank you.',
        { purchaseId }
      );
    }

    return {
      purchase: updatedPurchase,
      ingredient: ingredientResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const HOURS_UNTIL_OVERDUE = {
  ordered: 4,
  supplier_accepted: 24,
  shipping: 48,
  pending: 2,
};

export function enrichPurchase<
  T extends {
    status: string;
    created_at: Date;
    expected_delivery_time?: Date;
    remark?: string;
    supplier_accepted_at?: Date;
  }
>(pr: T): T & {
  is_overdue: boolean;
  overdue_hours: number;
  exception_reason: string | null;
  exception_type: 'rejected' | 'overdue' | 'delayed' | null;
  next_actions: string[];
  status_label: string;
} {
  const status = pr.status;
  const now = new Date();
  let isOverdue = false;
  let overdueHours = 0;
  let exceptionReason: string | null = null;
  let exceptionType: 'rejected' | 'overdue' | 'delayed' | null = null;
  const nextActions: string[] = [];

  const createdAt = new Date(pr.created_at);

  if (status === PurchaseStatus.REJECTED || status === PurchaseStatus.SUPPLIER_REJECTED) {
    exceptionType = 'rejected';
    exceptionReason =
      status === PurchaseStatus.SUPPLIER_REJECTED
        ? 'Supplier rejected: ' + (pr.remark || 'No reason provided')
        : 'Admin rejected: ' + (pr.remark || 'No reason provided');
  }

  if (status === PurchaseStatus.PENDING) {
    const diff = (now.getTime() - createdAt.getTime()) / 3600000;
    if (diff > HOURS_UNTIL_OVERDUE.pending) {
      isOverdue = true;
      overdueHours = Math.round(diff - HOURS_UNTIL_OVERDUE.pending);
      exceptionType = 'overdue';
      exceptionReason = 'Approval pending for more than ' + HOURS_UNTIL_OVERDUE.pending + ' hours';
    }
    nextActions.push('Please approve or reject this purchase request');
  }

  if (status === PurchaseStatus.ORDERED) {
    const diff = (now.getTime() - createdAt.getTime()) / 3600000;
    if (diff > HOURS_UNTIL_OVERDUE.ordered) {
      isOverdue = true;
      overdueHours = Math.round(diff - HOURS_UNTIL_OVERDUE.ordered);
      exceptionType = 'overdue';
      exceptionReason = 'Supplier has not responded in more than ' + HOURS_UNTIL_OVERDUE.ordered + ' hours';
    }
    nextActions.push('Supplier should accept or reject promptly');
    nextActions.push('Admin may contact supplier to follow up');
  }

  if (status === PurchaseStatus.SUPPLIER_ACCEPTED) {
    if (pr.expected_delivery_time && new Date(pr.expected_delivery_time) < now) {
      isOverdue = true;
      const diff = (now.getTime() - new Date(pr.expected_delivery_time).getTime()) / 3600000;
      overdueHours = Math.round(diff);
      exceptionType = 'delayed';
      exceptionReason = 'Expected delivery time passed but not shipped yet';
    }
    nextActions.push('Supplier should ship soon');
    if (pr.expected_delivery_time) {
      nextActions.push('Expected delivery: ' + new Date(pr.expected_delivery_time).toLocaleString('zh-CN'));
    }
  }

  if (status === PurchaseStatus.SHIPPING) {
    if (pr.expected_delivery_time && new Date(pr.expected_delivery_time) < now) {
      isOverdue = true;
      const diff = (now.getTime() - new Date(pr.expected_delivery_time).getTime()) / 3600000;
      overdueHours = Math.round(diff);
      exceptionType = 'delayed';
      exceptionReason = 'Shipping appears delayed past expected delivery';
    }
    nextActions.push('Admin can contact supplier to confirm delivery progress');
    nextActions.push('Click confirm delivery after receiving goods');
  }

  if (status === PurchaseStatus.APPROVED) {
    nextActions.push('Admin should place order with supplier');
  }

  if (status === PurchaseStatus.DELIVERED) {
    nextActions.push('Purchase complete, stock has been updated');
  }

  const statusLabelMap: Record<string, string> = {
    [PurchaseStatus.PENDING]: 'Pending Approval',
    [PurchaseStatus.APPROVED]: 'Approved - Ready to Order',
    [PurchaseStatus.ORDERED]: 'Ordered - Waiting for Supplier',
    [PurchaseStatus.SUPPLIER_ACCEPTED]: 'Supplier Accepted - Preparing',
    [PurchaseStatus.SUPPLIER_REJECTED]: 'Supplier Rejected',
    [PurchaseStatus.SHIPPING]: 'Shipping in Progress',
    [PurchaseStatus.DELIVERED]: 'Delivered and Stocked',
    [PurchaseStatus.REJECTED]: 'Rejected',
  };

  return {
    ...pr,
    is_overdue: isOverdue,
    overdue_hours: overdueHours,
    exception_reason: exceptionReason,
    exception_type: exceptionType,
    next_actions: nextActions,
    status_label: statusLabelMap[status] || status,
  };
}

export function getPurchaseStatusFlow(status: string): {
  currentStep: number;
  totalSteps: number;
  steps: { key: string; label: string; done: boolean; current: boolean }[];
} {
  const steps = [
    { key: PurchaseStatus.PENDING, label: 'Pending Approval' },
    { key: PurchaseStatus.APPROVED, label: 'Approved' },
    { key: PurchaseStatus.ORDERED, label: 'Ordered' },
    { key: PurchaseStatus.SUPPLIER_ACCEPTED, label: 'Supplier Accepted' },
    { key: PurchaseStatus.SHIPPING, label: 'Shipping' },
    { key: PurchaseStatus.DELIVERED, label: 'Delivered' },
  ];

  const currentIdx = steps.findIndex(s => s.key === status);
  const currentStepIdx = currentIdx >= 0 ? currentIdx : 0;

  const stepList = steps.map((step, idx) => ({
    key: step.key,
    label: step.label,
    done: idx < currentStepIdx,
    current: idx === currentStepIdx,
  }));

  return {
    currentStep: currentStepIdx + 1,
    totalSteps: steps.length,
    steps: stepList,
  };
}

export async function getAllPurchaseRequests(status?: PurchaseStatus) {
  let sql =
    'SELECT pr.*, i.name as ingredient_name, i.unit as ingredient_unit, ' +
    '       i.current_stock as current_stock, i.safety_stock as safety_stock, ' +
    '       u1.name as requester_name, u2.name as approver_name, u3.name as supplier_name ' +
    'FROM purchase_requests pr ' +
    'JOIN ingredients i ON pr.ingredient_id = i.id ' +
    'JOIN users u1 ON pr.requested_by = u1.id ' +
    'LEFT JOIN users u2 ON pr.approved_by = u2.id ' +
    'LEFT JOIN users u3 ON pr.supplier_id = u3.id ' +
    'WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (status) {
    sql += ' AND pr.status = $' + idx;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY pr.created_at DESC';
  const result = await query(sql, params);
  return result.rows.map((r: any) => enrichPurchase(r));
}

export async function getPurchaseById(id: string) {
  const result = await query(
    'SELECT pr.*, i.name as ingredient_name, i.unit as ingredient_unit, ' +
    '       i.current_stock as current_stock, i.safety_stock as safety_stock, ' +
    '       u1.name as requester_name, u2.name as approver_name, u3.name as supplier_name ' +
    'FROM purchase_requests pr ' +
    'JOIN ingredients i ON pr.ingredient_id = i.id ' +
    'JOIN users u1 ON pr.requested_by = u1.id ' +
    'LEFT JOIN users u2 ON pr.approved_by = u2.id ' +
    'LEFT JOIN users u3 ON pr.supplier_id = u3.id ' +
    'WHERE pr.id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Purchase request not found', 404);
  }
  return enrichPurchase({
    ...result.rows[0],
    status_flow: getPurchaseStatusFlow(result.rows[0].status),
  });
}

export async function getPurchaseByIdWithPermission(
  purchaseId: string,
  userId: string,
  userRole: UserRole
) {
  const purchase = await getPurchaseById(purchaseId);
  if (userRole === UserRole.SUPPLIER && purchase.supplier_id !== userId) {
    throw new AppError('No permission - this purchase is not assigned to you', 403);
  }
  return purchase;
}

export async function reassignSupplier(
  purchaseId: string,
  adminId: string,
  newSupplierId: string,
  remark?: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT pr.*, i.name as ingredient_name FROM purchase_requests pr ' +
      'JOIN ingredients i ON pr.ingredient_id = i.id WHERE pr.id = $1 FOR UPDATE',
      [purchaseId]
    );
    if (current.rows.length === 0) {
      throw new AppError('Purchase not found', 404);
    }
    const pr = current.rows[0];

    const supplierCheck = await client.query(
      "SELECT * FROM users WHERE id = $1 AND role = 'supplier'",
      [newSupplierId]
    );
    if (supplierCheck.rows.length === 0) {
      throw new AppError('Target supplier not found or wrong role', 400);
    }

    const allowedStatuses = [
      PurchaseStatus.REJECTED,
      PurchaseStatus.SUPPLIER_REJECTED,
      PurchaseStatus.PENDING,
      PurchaseStatus.ORDERED,
      PurchaseStatus.SUPPLIER_ACCEPTED,
      PurchaseStatus.SHIPPING,
    ];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('Cannot reassign supplier in status: ' + pr.status, 400);
    }

    const newRemark =
      (pr.remark ? pr.remark + '\n' : '') +
      '[Admin] ' + new Date().toLocaleString('zh-CN') +
      ' reassigned supplier' +
      (remark ? ': ' + remark : '');

    const updateResult = await client.query(
      'UPDATE purchase_requests ' +
      'SET supplier_id = $1, ' +
      '    supplier_accepted_at = NULL, ' +
      '    expected_delivery_time = NULL, ' +
      '    actual_delivery_time = NULL, ' +
      '    tracking_no = NULL, ' +
      "    status = 'ordered', " +
      '    remark = $2 ' +
      'WHERE id = $3 ' +
      'RETURNING *',
      [newSupplierId, newRemark, purchaseId]
    );
    const updated = updateResult.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updated);

    const ingredientName = pr.ingredient_name || 'ingredient';
    const supplierName = supplierCheck.rows[0].name || 'New Supplier';
    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);

    for (const aId of adminIds) {
      await createNotification(
        aId,
        'purchase_updated',
        'Purchase reassigned to new supplier',
        'Purchase [' + ingredientName + '] reassigned to ' + supplierName + (remark ? ', remark: ' + remark : ''),
        { purchaseId, newSupplierId, remark }
      );
    }

    await createNotification(
      newSupplierId,
      'purchase_approved',
      'New purchase order for you',
      'Purchase: [' + ingredientName + ']' + (remark ? ', remark: ' + remark : ''),
      { purchaseId, ingredientName }
    );

    return enrichPurchase(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reorderPurchase(purchaseId: string, adminId: string, remark?: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT pr.*, i.name as ingredient_name FROM purchase_requests pr ' +
      'JOIN ingredients i ON pr.ingredient_id = i.id WHERE pr.id = $1 FOR UPDATE',
      [purchaseId]
    );
    if (current.rows.length === 0) {
      throw new AppError('Purchase not found', 404);
    }
    const pr = current.rows[0];

    const allowedStatuses = [
      PurchaseStatus.REJECTED,
      PurchaseStatus.SUPPLIER_REJECTED,
      PurchaseStatus.ORDERED,
      PurchaseStatus.SUPPLIER_ACCEPTED,
    ];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('Cannot reorder in status: ' + pr.status, 400);
    }

    if (!pr.supplier_id) {
      throw new AppError('No supplier assigned, please assign one first', 400);
    }

    const newRemark =
      (pr.remark ? pr.remark + '\n' : '') +
      '[Admin] ' + new Date().toLocaleString('zh-CN') + ' reordered' +
      (remark ? ': ' + remark : '');

    const updateResult = await client.query(
      'UPDATE purchase_requests ' +
      "SET status = 'ordered', " +
      '    supplier_accepted_at = NULL, ' +
      '    expected_delivery_time = NULL, ' +
      '    actual_delivery_time = NULL, ' +
      '    tracking_no = NULL, ' +
      '    remark = $1 ' +
      'WHERE id = $2 ' +
      'RETURNING *',
      [newRemark, purchaseId]
    );
    const updated = updateResult.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updated);

    const ingredientName = pr.ingredient_name || 'ingredient';
    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);

    for (const aId of adminIds) {
      await createNotification(
        aId,
        'purchase_updated',
        'Purchase reordered',
        'Purchase [' + ingredientName + '] reordered' + (remark ? ', remark: ' + remark : ''),
        { purchaseId, remark }
      );
    }

    if (pr.supplier_id) {
      await createNotification(
        pr.supplier_id,
        'purchase_approved',
        'Purchase reordered - please process',
        'Purchase: [' + ingredientName + ']' + (remark ? ', remark: ' + remark : ''),
        { purchaseId, ingredientName }
      );
    }

    return enrichPurchase(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePurchaseRequest(purchaseId: string, adminId: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw new AppError('Please provide a closing reason', 400);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT pr.*, i.name as ingredient_name FROM purchase_requests pr ' +
      'JOIN ingredients i ON pr.ingredient_id = i.id WHERE pr.id = $1 FOR UPDATE',
      [purchaseId]
    );
    if (current.rows.length === 0) {
      throw new AppError('Purchase not found', 404);
    }
    const pr = current.rows[0];

    if (pr.status === PurchaseStatus.DELIVERED) {
      throw new AppError('Completed purchases cannot be closed', 400);
    }

    const newRemark =
      (pr.remark ? pr.remark + '\n' : '') +
      '[Admin closed] ' + new Date().toLocaleString('zh-CN') + ' reason: ' + reason;

    const updateResult = await client.query(
      'UPDATE purchase_requests ' +
      "SET status = 'rejected', " +
      '    approved_by = $1, ' +
      '    remark = $2 ' +
      'WHERE id = $3 ' +
      'RETURNING *',
      [adminId, newRemark, purchaseId]
    );
    const updated = updateResult.rows[0];

    await client.query('COMMIT');
    broadcastPurchaseUpdate(updated);

    const ingredientName = pr.ingredient_name || 'ingredient';
    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);

    for (const aId of adminIds) {
      await createNotification(
        aId,
        'purchase_updated',
        'Purchase closed',
        'Purchase [' + ingredientName + '] closed, reason: ' + reason,
        { purchaseId, reason }
      );
    }

    if (pr.supplier_id) {
      await createNotification(
        pr.supplier_id,
        'purchase_updated',
        'Purchase closed by admin',
        'Purchase [' + ingredientName + '] closed, reason: ' + reason,
        { purchaseId, reason }
      );
    }

    return enrichPurchase(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
