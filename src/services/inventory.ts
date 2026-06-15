import { getClient, query } from '../database/pool';
import { AppError } from '../utils/response';
import { IngredientStatus } from '../types';
import { config } from '../config';
import { broadcastInventoryUpdate } from './socket';
import { notifyIngredientExpiry, notifyLowStock, getAllAdmins } from './notification';
import { checkAndCreatePurchaseRequest } from './purchase';

export interface InboundIngredientInput {
  ingredient_id: string;
  quantity: number;
  expiry_date?: string;
  batch_no?: string;
  remark?: string;
}

export async function getAllIngredients(category?: string, status?: IngredientStatus) {
  let sql = `SELECT i.*, u.name as supplier_name 
             FROM ingredients i 
             LEFT JOIN users u ON i.supplier_id = u.id
             WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;

  if (category) {
    sql += ` AND i.category = $${idx}`;
    params.push(category);
    idx++;
  }

  if (status) {
    sql += ` AND i.status = $${idx}`;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY i.category, i.name';

  const result = await query(sql, params);
  return result.rows;
}

export async function getIngredientById(id: string) {
  const result = await query(
    'SELECT * FROM ingredients WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) {
    throw new AppError('食材不存在', 404);
  }
  return result.rows[0];
}

export async function createIngredient(
  name: string,
  category: string,
  unit: string,
  safetyStock: number,
  supplierId?: string
) {
  const result = await query(
    `INSERT INTO ingredients (name, category, unit, safety_stock, supplier_id, status)
     VALUES ($1, $2, $3, $4, $5, 'normal')
     RETURNING *`,
    [name, category, unit, safetyStock, supplierId || null]
  );
  return result.rows[0];
}

export async function inboundIngredient(
  operatorId: string,
  input: InboundIngredientInput
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const ingredient = await getIngredientById(input.ingredient_id);
    
    let status: IngredientStatus = IngredientStatus.NORMAL;
    let expiryDateObj: Date | null = null;
    
    if (input.expiry_date) {
      expiryDateObj = new Date(input.expiry_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const daysToExpiry = Math.ceil(
        (expiryDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysToExpiry < 0) {
        status = IngredientStatus.EXPIRED;
      } else if (daysToExpiry <= config.nearExpiryDays) {
        status = IngredientStatus.NEAR_EXPIRY;
      }
    }

    const newStock = parseFloat(ingredient.current_stock) + input.quantity;
    
    await client.query(
      `UPDATE ingredients 
       SET current_stock = $1, expiry_date = $2, status = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [newStock, expiryDateObj, status, input.ingredient_id]
    );

    await client.query(
      `INSERT INTO ingredient_stock_records 
        (ingredient_id, quantity, type, expiry_date, batch_no, remark)
       VALUES ($1, $2, 'in', $3, $4, $5)`,
      [
        input.ingredient_id,
        input.quantity,
        expiryDateObj,
        input.batch_no || null,
        input.remark || `入库操作，操作员: ${operatorId}`,
      ]
    );

    const updatedIngredient = {
      ...ingredient,
      current_stock: newStock,
      expiry_date: expiryDateObj,
      status,
    };

    await client.query('COMMIT');

    broadcastInventoryUpdate(updatedIngredient);

    const admins = await getAllAdmins();
    const adminIds = admins.map(a => a.id);

    if (status === IngredientStatus.EXPIRED) {
      await notifyIngredientExpiry(adminIds, ingredient.name, 0, 'expired');
    } else if (status === IngredientStatus.NEAR_EXPIRY && expiryDateObj) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil(
        (expiryDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      await notifyIngredientExpiry(adminIds, ingredient.name, daysLeft, 'near_expiry');
    }

    return updatedIngredient;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeIngredient(
  client: any,
  ingredientId: string,
  quantity: number,
  remark?: string
) {
  const result = await client.query(
    `UPDATE ingredients 
     SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND current_stock >= $1
     RETURNING *`,
    [quantity, ingredientId]
  );

  if (result.rows.length === 0) {
    throw new AppError(`食材库存不足: ${ingredientId}`, 400);
  }

  await client.query(
    `INSERT INTO ingredient_stock_records 
      (ingredient_id, quantity, type, remark)
     VALUES ($1, $2, 'out', $3)`,
    [ingredientId, quantity, remark || '消耗出库']
  );

  const ingredient = result.rows[0];

  if (parseFloat(ingredient.current_stock) <= parseFloat(ingredient.safety_stock)) {
    checkAndCreatePurchaseRequest(ingredientId).catch(console.error);
  }

  return ingredient;
}

export async function recordWaste(
  ingredientId: string,
  quantity: number,
  remark: string
) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE ingredients 
       SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND current_stock >= $1
       RETURNING *`,
      [quantity, ingredientId]
    );

    if (result.rows.length === 0) {
      throw new AppError('食材库存不足', 400);
    }

    await client.query(
      `INSERT INTO ingredient_stock_records 
        (ingredient_id, quantity, type, remark)
       VALUES ($1, $2, 'waste', $3)`,
      [ingredientId, quantity, remark]
    );

    const ingredient = result.rows[0];
    await client.query('COMMIT');

    broadcastInventoryUpdate(ingredient);
    return ingredient;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkExpiryStatus() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nearExpiryDate = new Date(today);
  nearExpiryDate.setDate(today.getDate() + config.nearExpiryDays);

  const result = await query(
    `SELECT * FROM ingredients 
     WHERE expiry_date IS NOT NULL 
       AND status != 'expired'`
  );

  const admins = await getAllAdmins();
  const adminIds = admins.map(a => a.id);

  for (const ingredient of result.rows) {
    const expiryDate = new Date(ingredient.expiry_date);
    expiryDate.setHours(0, 0, 0, 0);
    const daysToExpiry = Math.ceil(
      (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    let newStatus: IngredientStatus | null = null;

    if (daysToExpiry < 0 && ingredient.status !== IngredientStatus.EXPIRED) {
      newStatus = IngredientStatus.EXPIRED;
    } else if (daysToExpiry >= 0 && daysToExpiry <= config.nearExpiryDays && ingredient.status === IngredientStatus.NORMAL) {
      newStatus = IngredientStatus.NEAR_EXPIRY;
    }

    if (newStatus) {
      await query(
        'UPDATE ingredients SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newStatus, ingredient.id]
      );

      if (newStatus === IngredientStatus.EXPIRED) {
        await notifyIngredientExpiry(adminIds, ingredient.name, 0, 'expired');
      } else if (newStatus === IngredientStatus.NEAR_EXPIRY) {
        await notifyIngredientExpiry(adminIds, ingredient.name, daysToExpiry, 'near_expiry');
      }
    }
  }

  return { checked: result.rows.length };
}

export async function checkLowStock() {
  const result = await query(
    `SELECT * FROM ingredients 
     WHERE current_stock <= safety_stock AND status != 'expired'`
  );

  const admins = await getAllAdmins();
  const adminIds = admins.map(a => a.id);

  for (const ingredient of result.rows) {
    await notifyLowStock(
      adminIds,
      ingredient.name,
      parseFloat(ingredient.current_stock),
      parseFloat(ingredient.safety_stock)
    );
    await checkAndCreatePurchaseRequest(ingredient.id);
  }

  return { lowStockItems: result.rows.length };
}

export async function getStockRecords(ingredientId: string, limit: number = 50) {
  const result = await query(
    `SELECT * FROM ingredient_stock_records 
     WHERE ingredient_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [ingredientId, limit]
  );
  return result.rows;
}
