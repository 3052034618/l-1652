import { query } from '../database/pool';
import { DishType } from '../types';
import { AppError } from '../utils/response';

export interface CreateDishInput {
  name: string;
  type: DishType;
  price: number;
  stock: number;
  description?: string;
  nutrition_info: Record<string, number>;
  image_url?: string;
}

export async function getAllDishes(availableOnly: boolean = false) {
  let sql = 'SELECT * FROM dishes WHERE 1=1';
  const params: any[] = [];
  
  if (availableOnly) {
    sql += ' AND is_available = true AND stock > 0';
  }
  
  sql += ' ORDER BY type, name';
  const result = await query(sql, params);
  return result.rows;
}

export async function getDishById(dishId: string) {
  const result = await query(
    'SELECT * FROM dishes WHERE id = $1',
    [dishId]
  );
  if (result.rows.length === 0) {
    throw new AppError('餐品不存在', 404);
  }
  return result.rows[0];
}

export async function getDishesByIds(dishIds: string[]) {
  if (dishIds.length === 0) return [];
  
  const placeholders = dishIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await query(
    `SELECT * FROM dishes WHERE id IN (${placeholders})`,
    dishIds
  );
  return result.rows;
}

export async function createDish(input: CreateDishInput) {
  const result = await query(
    `INSERT INTO dishes (name, type, price, stock, description, nutrition_info, image_url)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING *`,
    [
      input.name,
      input.type,
      input.price,
      input.stock,
      input.description || null,
      JSON.stringify(input.nutrition_info),
      input.image_url || null,
    ]
  );
  return result.rows[0];
}

export async function updateDishStock(client: any, dishId: string, quantityChange: number) {
  const result = await client.query(
    `UPDATE dishes 
     SET stock = stock + $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND (stock + $1) >= 0
     RETURNING *`,
    [quantityChange, dishId]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('库存不足', 400);
  }
  
  return result.rows[0];
}

export async function updateDish(dishId: string, updates: Partial<CreateDishInput> & { is_available?: boolean }) {
  const fields: string[] = [];
  const values: any[] = [];
  let index = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = $${index}`);
      if (key === 'nutrition_info') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
      index++;
    }
  }

  if (fields.length === 0) {
    throw new AppError('没有提供更新字段', 400);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(dishId);

  const result = await query(
    `UPDATE dishes SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('餐品不存在', 404);
  }
  return result.rows[0];
}

export async function checkDishesAvailability(items: { dish_id: string; quantity: number }[]) {
  const dishIds = items.map(i => i.dish_id);
  const dishes = await getDishesByIds(dishIds);
  
  const dishMap = new Map(dishes.map(d => [d.id, d]));
  const issues: string[] = [];
  const validated: { dish: any; quantity: number; subtotal: number }[] = [];
  let totalAmount = 0;

  for (const item of items) {
    const dish = dishMap.get(item.dish_id);
    if (!dish) {
      issues.push(`餐品不存在: ${item.dish_id}`);
      continue;
    }
    if (!dish.is_available) {
      issues.push(`餐品已下架: ${dish.name}`);
      continue;
    }
    if (dish.stock < item.quantity) {
      issues.push(`餐品「${dish.name}」库存不足，剩余 ${dish.stock} 份`);
      continue;
    }

    const subtotal = parseFloat(dish.price) * item.quantity;
    validated.push({ dish, quantity: item.quantity, subtotal });
    totalAmount += subtotal;
  }

  return { validated, totalAmount, issues };
}
