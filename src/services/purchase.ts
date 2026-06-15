import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { PurchaseStatus, UserRole } from '../types';
import { broadcastPurchaseUpdate } from './socket';
import { notifyPurchaseRequest, notifyPurchaseApproved, getAllAdmins, createNotification } from './notification';

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

  const ingredientResult = await query(
    'SELECT name FROM ingredients WHERE id = $1',
    [ingredientId]
  );
  const ingredientName = ingredientResult.rows[0]?.name || '食材';

  await notifyPurchaseRequest(adminIds, ingredientName, quantity);

  return purchase;
}

export async function checkAndCreatePurchaseRequest(ingredientId: string) {
  const ingredientResult = await query(
    'SELECT * FROM ingredients WHERE id = $1',
    [ingredientId]
  );

  if (ingredientResult.rows.length === 0) return null;

  const ingredient = ingredientResult.rows[0];

  const existingRequest = await query(
    'SELECT * FROM purchase_requests ' +
    'WHERE ingredient_id = $1 AND status IN (\'pending\', \'approved\', \'ordered\', \'supplier_accepted\', \'shipping\')',
    [ingredientId]
  );

  if (existingRequest.rows.length > 0) return null;

  const reorderQuantity = Math.max(
    parseFloat(ingredient.safety_stock) * 2,
    parseFloat(ingredient.safety_stock) - parseFloat(ingredient.current_stock)
  );

  const systemUserId = await getSystemUserId();

  return createPurchaseRequest(
    ingredientId,
    reorderQuantity,
    systemUserId,
    ingredient.supplier_id
  );
}

async function getSystemUserId(): Promise<string> {
  const result = await query(
    'SELECT id FROM users WHERE role = $1 LIMIT 1',
    [UserRole.ADMIN]
  );
  if (result.rows.length > 0) {
    return result.rows[0].id;
  }
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

    const current = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1',
      [purchaseId]
    );
    if (current.rows.length === 0) {
      throw new AppError('采购申请不存在', 404);
    }

    const purchase = current.rows[0];

    if (purchase.status !== PurchaseStatus.PENDING) {
      throw new AppError('该采购申请已处理', 400);
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
      await client.query(
        "UPDATE purchase_requests SET status = 'ordered' WHERE id = $1",
        [purchaseId]
      );
      updatedPurchase.status = PurchaseStatus.ORDERED;
    }

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);

    if (approved && purchase.supplier_id) {
      const ingredientResult = await client.query(
        'SELECT name FROM ingredients WHERE id = $1',
        [purchase.ingredient_id]
      );
      await notifyPurchaseApproved(
        purchase.supplier_id,
        ingredientResult.rows[0]?.name || '食材',
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
      throw new AppError('采购订单不存在或不属于您', 404);
    }
    const pr = current.rows[0];

    if (pr.status !== PurchaseStatus.ORDERED) {
      throw new AppError('当前状态为 ' + pr.status + '，无法接单', 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    supplier_accepted_at = CURRENT_TIMESTAMP, ' +
      '    expected_delivery_time = $2, ' +
      '    remark = COALESCE($3, remark) ' +
      'WHERE id = $4 ' +
      'RETURNING *',
      [
        PurchaseStatus.SUPPLIER_ACCEPTED,
        expectedDeliveryTime || null,
        remark || null,
        purchaseId,
      ]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingredientResult = await query(
      'SELECT name FROM ingredients WHERE id = $1',
      [pr.ingredient_id]
    );

    const ingredientName = ingredientResult.rows[0]?.name || '食材';
    const expectedTimeText = expectedDeliveryTime || '待供应商填写';
    const notifyMsg = '「' + ingredientName + '」采购订单已被供应商确认，预计送达：' + expectedTimeText;

    for (const adminId of adminIds) {
      await createNotification(
        adminId,
        'purchase_updated',
        '供应商已接单',
        notifyMsg,
        { purchaseId, expectedDeliveryTime }
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

export async function supplierRejectOrder(
  purchaseId: string,
  supplierId: string,
  reason: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1 AND supplier_id = $2',
      [purchaseId, supplierId]
    );
    if (current.rows.length === 0) {
      throw new AppError('采购订单不存在或不属于您', 404);
    }
    const pr = current.rows[0];

    if (pr.status !== PurchaseStatus.ORDERED) {
      throw new AppError('当前状态为 ' + pr.status + '，无法拒单', 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    remark = COALESCE($2, remark) ' +
      'WHERE id = $3 ' +
      'RETURNING *',
      [PurchaseStatus.SUPPLIER_REJECTED, reason || '供应商拒绝', purchaseId]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingredientResult = await query(
      'SELECT name FROM ingredients WHERE id = $1',
      [pr.ingredient_id]
    );

    const ingredientName = ingredientResult.rows[0]?.name || '食材';
    const rejectMsg = '「' + ingredientName + '」采购订单被供应商拒绝：' + reason;

    for (const adminId of adminIds) {
      await createNotification(
        adminId,
        'purchase_updated',
        '供应商已拒单',
        rejectMsg,
        { purchaseId, reason }
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
      throw new AppError('采购订单不存在或不属于您', 404);
    }
    const pr = current.rows[0];

    const allowedStatuses = [PurchaseStatus.ORDERED, PurchaseStatus.SUPPLIER_ACCEPTED];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('当前状态为 ' + pr.status + '，无法发货', 400);
    }

    const result = await client.query(
      'UPDATE purchase_requests ' +
      'SET status = $1, ' +
      '    tracking_no = $2, ' +
      '    expected_delivery_time = COALESCE($3, expected_delivery_time), ' +
      '    supplier_accepted_at = COALESCE(supplier_accepted_at, CURRENT_TIMESTAMP) ' +
      'WHERE id = $4 ' +
      'RETURNING *',
      [
        PurchaseStatus.SHIPPING,
        trackingNo || null,
        expectedDeliveryTime || null,
        purchaseId,
      ]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);

    const admins = await getAllAdmins();
    const adminIds = admins.map((a: { id: string }) => a.id);
    const ingredientResult = await query(
      'SELECT name FROM ingredients WHERE id = $1',
      [pr.ingredient_id]
    );

    const ingredientName = ingredientResult.rows[0]?.name || '食材';
    const trackingPart = trackingNo ? '，单号：' + trackingNo : '';
    const shipMsg = '「' + ingredientName + '」已发货' + trackingPart;

    for (const adminId of adminIds) {
      await createNotification(
        adminId,
        'purchase_updated',
        '供应商已发货',
        shipMsg,
        { purchaseId, trackingNo }
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

export async function confirmDelivery(purchaseId: string, operatorId: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const purchase = await client.query(
      'SELECT * FROM purchase_requests WHERE id = $1',
      [purchaseId]
    );
    if (purchase.rows.length === 0) {
      throw new AppError('采购申请不存在', 404);
    }
    const pr = purchase.rows[0];

    const allowedStatuses = [PurchaseStatus.ORDERED, PurchaseStatus.SUPPLIER_ACCEPTED, PurchaseStatus.SHIPPING];
    if (!allowedStatuses.includes(pr.status as PurchaseStatus)) {
      throw new AppError('当前状态为 ' + pr.status + '，不允许确认收货', 400);
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

    const inStockRemark = '采购入库，订单号: ' + purchaseId + '，确认人: ' + operatorId;
    await client.query(
      'INSERT INTO ingredient_stock_records ' +
      '  (ingredient_id, quantity, type, remark) ' +
      'VALUES ($1, $2, \'in\', $3)',
      [pr.ingredient_id, pr.quantity, inStockRemark]
    );

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);

    if (pr.supplier_id) {
      await createNotification(
        pr.supplier_id,
        'purchase_updated',
        '采购订单已签收',
        '您配送的订单已确认收货，感谢配合',
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

export function getPurchaseStatusFlow(status: string): {
  currentStep: number;
  totalSteps: number;
  steps: { key: string; label: string; done: boolean; current: boolean }[];
} {
  const steps = [
    { key: PurchaseStatus.PENDING, label: '待审批' },
    { key: PurchaseStatus.APPROVED, label: '已批准' },
    { key: PurchaseStatus.ORDERED, label: '已下单' },
    { key: PurchaseStatus.SUPPLIER_ACCEPTED, label: '供应商接单' },
    { key: PurchaseStatus.SHIPPING, label: '配送中' },
    { key: PurchaseStatus.DELIVERED, label: '已送达' },
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

const HOURS_UNTIL_OVERDUE = {
  ordered: 4,
  supplier_accepted: 24,
  shipping: 48,
  pending: 2,
};

export function enrichPurchase<T extends { status: string; created_at: Date; expected_delivery_time?: Date; remark?: string; supplier_accepted_at?: Date }>(pr: T): T & {
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
    exceptionReason = status === PurchaseStatus.SUPPLIER_REJECTED
      ? '供应商拒绝：' + (pr.remark || '未提供原因')
      : '管理员拒绝：' + (pr.remark || '未提供原因');
  }

  if (status === PurchaseStatus.PENDING) {
    const diff = (now.getTime() - createdAt.getTime()) / 3600000;
    if (diff > HOURS_UNTIL_OVERDUE.pending) {
      isOverdue = true;
      overdueHours = Math.round(diff - HOURS_UNTIL_OVERDUE.pending);
      exceptionType = 'overdue';
      exceptionReason = '采购单审批超时（已超过 ' + HOURS_UNTIL_OVERDUE.pending + ' 小时未审批）';
    }
    nextActions.push('请管理员尽快审批该采购申请');
  }

  if (status === PurchaseStatus.ORDERED) {
    const diff = (now.getTime() - createdAt.getTime()) / 3600000;
    if (diff > HOURS_UNTIL_OVERDUE.ordered) {
      isOverdue = true;
      overdueHours = Math.round(diff - HOURS_UNTIL_OVERDUE.ordered);
      exceptionType = 'overdue';
      exceptionReason = '供应商未及时响应（超过 ' + HOURS_UNTIL_OVERDUE.ordered + ' 小时未接单）';
    }
    nextActions.push('请供应商尽快确认接单或拒绝');
    nextActions.push('管理员可主动联系供应商确认进度');
  }

  if (status === PurchaseStatus.SUPPLIER_ACCEPTED) {
    if (pr.expected_delivery_time && new Date(pr.expected_delivery_time) < now) {
      isOverdue = true;
      const diff = (now.getTime() - new Date(pr.expected_delivery_time).getTime()) / 3600000;
      overdueHours = Math.round(diff);
      exceptionType = 'delayed';
      exceptionReason = '供应商预计送达时间已过，尚未发货';
    }
    nextActions.push('请供应商尽快发货');
    if (pr.expected_delivery_time) {
      nextActions.push('预计送达：' + new Date(pr.expected_delivery_time).toLocaleString('zh-CN'));
    }
  }

  if (status === PurchaseStatus.SHIPPING) {
    if (pr.expected_delivery_time && new Date(pr.expected_delivery_time) < now) {
      isOverdue = true;
      const diff = (now.getTime() - new Date(pr.expected_delivery_time).getTime()) / 3600000;
      overdueHours = Math.round(diff);
      exceptionType = 'delayed';
      exceptionReason = '配送已超时，预计送达时间已过';
    }
    nextActions.push('管理员可联系供应商确认配送进度');
    nextActions.push('收货后请点击确认入库');
  }

  if (status === PurchaseStatus.APPROVED) {
    nextActions.push('请管理员尽快下单给供应商');
  }

  if (status === PurchaseStatus.DELIVERED) {
    nextActions.push('采购已完成，可查看库存更新记录');
  }

  const statusLabelMap: Record<string, string> = {
    [PurchaseStatus.PENDING]: '待审批',
    [PurchaseStatus.APPROVED]: '已批准待下单',
    [PurchaseStatus.ORDERED]: '已下单待供应商响应',
    [PurchaseStatus.SUPPLIER_ACCEPTED]: '供应商已接单备货中',
    [PurchaseStatus.SUPPLIER_REJECTED]: '供应商已拒单',
    [PurchaseStatus.SHIPPING]: '配送中',
    [PurchaseStatus.DELIVERED]: '已送达入库',
    [PurchaseStatus.REJECTED]: '已拒绝',
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
    throw new AppError('采购申请不存在', 404);
  }
  return enrichPurchase({
    ...result.rows[0],
    status_flow: getPurchaseStatusFlow(result.rows[0].status),
  });
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
