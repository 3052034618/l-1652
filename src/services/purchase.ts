import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { PurchaseStatus, UserRole } from '../types';
import { broadcastPurchaseUpdate } from './socket';
import { notifyPurchaseRequest, notifyPurchaseApproved, getAllAdmins } from './notification';

export async function createPurchaseRequest(
  ingredientId: string,
  quantity: number,
  requestedBy: string,
  supplierId?: string,
  estimatedPrice?: number,
  remark?: string
) {
  const result = await query(
    `INSERT INTO purchase_requests 
      (ingredient_id, quantity, requested_by, supplier_id, estimated_price, remark)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
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
    `SELECT * FROM purchase_requests 
     WHERE ingredient_id = $1 AND status IN ('pending', 'approved', 'ordered')`,
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
    `SELECT id FROM users WHERE role = $1 LIMIT 1`,
    [UserRole.ADMIN]
  );
  if (result.rows.length > 0) {
    return result.rows[0].id;
  }
  return '00000000-0000-0000-0000-000000000000';
}

export async function getAllPurchaseRequests(status?: PurchaseStatus) {
  let sql = `SELECT pr.*, i.name as ingredient_name, i.unit as ingredient_unit,
             u1.name as requester_name, u2.name as approver_name, u3.name as supplier_name
             FROM purchase_requests pr
             JOIN ingredients i ON pr.ingredient_id = i.id
             JOIN users u1 ON pr.requested_by = u1.id
             LEFT JOIN users u2 ON pr.approved_by = u2.id
             LEFT JOIN users u3 ON pr.supplier_id = u3.id
             WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;

  if (status) {
    sql += ` AND pr.status = $${idx}`;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY pr.created_at DESC';

  const result = await query(sql, params);
  return result.rows;
}

export async function getPurchaseById(id: string) {
  const result = await query(
    `SELECT pr.*, i.name as ingredient_name, i.unit as ingredient_unit,
             u1.name as requester_name, u2.name as approver_name, u3.name as supplier_name
     FROM purchase_requests pr
     JOIN ingredients i ON pr.ingredient_id = i.id
     JOIN users u1 ON pr.requested_by = u1.id
     LEFT JOIN users u2 ON pr.approved_by = u2.id
     LEFT JOIN users u3 ON pr.supplier_id = u3.id
     WHERE pr.id = $1`,
    [id]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('采购申请不存在', 404);
  }
  return result.rows[0];
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
      `UPDATE purchase_requests 
       SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, remark = COALESCE($3, remark)
       WHERE id = $4
       RETURNING *`,
      [newStatus, approvedBy, remark || null, purchaseId]
    );

    const updatedPurchase = result.rows[0];

    if (approved) {
      await client.query(
        `UPDATE purchase_requests SET status = 'ordered' WHERE id = $1`,
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

export async function confirmDelivery(purchaseId: string) {
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

    if (pr.status !== PurchaseStatus.ORDERED) {
      throw new AppError('该采购订单状态不允许确认收货', 400);
    }

    await client.query(
      `UPDATE purchase_requests 
       SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [purchaseId]
    );

    const ingredientResult = await client.query(
      `UPDATE ingredients 
       SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [pr.quantity, pr.ingredient_id]
    );

    await client.query(
      `INSERT INTO ingredient_stock_records 
        (ingredient_id, quantity, type, remark)
       VALUES ($1, $2, 'in', $3)`,
      [pr.ingredient_id, pr.quantity, `采购入库，订单号: ${purchaseId}`]
    );

    const result = await client.query(
      `UPDATE purchase_requests SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [purchaseId]
    );
    const updatedPurchase = result.rows[0];

    await client.query('COMMIT');

    broadcastPurchaseUpdate(updatedPurchase);
    return {
      purchase: updatedPurchase, ingredient: ingredientResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
