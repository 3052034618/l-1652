import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { MealType } from '../types';
import { createOrder } from './order';

export interface CartUpdateInput {
  dish_id: string;
  quantity: number;
}

export async function getCart(studentId: string) {
  const result = await query(
    `SELECT 
       sc.id,
       sc.student_id,
       sc.dish_id,
       sc.quantity,
       sc.created_at,
       sc.updated_at,
       d.name as dish_name,
       d.price as dish_price,
       d.type as dish_type,
       d.stock as dish_stock,
       d.image_url as dish_image,
       d.is_available as dish_available,
       d.nutrition_info as nutrition_info
     FROM shopping_cart sc
     JOIN dishes d ON sc.dish_id = d.id
     WHERE sc.student_id = $1
     ORDER BY sc.updated_at DESC`,
    [studentId]
  );

  const items = result.rows.map((row: any) => ({
    id: row.id,
    student_id: row.student_id,
    dish_id: row.dish_id,
    quantity: row.quantity,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subtotal: parseFloat(row.dish_price) * row.quantity,
    dish: {
      id: row.dish_id,
      name: row.dish_name,
      price: parseFloat(row.dish_price),
      type: row.dish_type,
      stock: row.dish_stock,
      image_url: row.dish_image,
      is_available: row.dish_available,
      nutrition_info: row.nutrition_info,
    },
  }));

  const totalAmount = items.reduce((sum: number, item: any) => {
    if (item.dish && item.dish.is_available && item.dish.stock >= item.quantity) {
      return sum + item.subtotal;
    }
    return sum;
  }, 0);

  const totalCount = items.reduce((sum: number, item: any) => sum + item.quantity, 0);

  const invalidItems = items.filter(
    (item: any) => !item.dish.is_available || item.dish.stock < item.quantity
  );

  return {
    items,
    totalAmount,
    totalCount,
    invalidItems,
    validItems: items.filter(
      (item: any) => item.dish.is_available && item.dish.stock >= item.quantity
    ),
  };
}

export async function addToCart(studentId: string, dishId: string, quantity: number = 1) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const dishResult = await client.query(
      'SELECT * FROM dishes WHERE id = $1',
      [dishId]
    );
    if (dishResult.rows.length === 0) {
      throw new AppError('餐品不存在', 404);
    }
    const dish = dishResult.rows[0];

    if (!dish.is_available) {
      throw new AppError('餐品已下架', 400);
    }
    if (dish.stock <= 0) {
      throw new AppError('餐品库存不足', 400);
    }

    const existingResult = await client.query(
      'SELECT * FROM shopping_cart WHERE student_id = $1 AND dish_id = $2 FOR UPDATE',
      [studentId, dishId]
    );

    let result;
    if (existingResult.rows.length > 0) {
      const newQuantity = existingResult.rows[0].quantity + quantity;
      if (newQuantity > dish.stock) {
        throw new AppError(`超出库存限制，当前仅剩 ${dish.stock} 份`, 400);
      }
      result = await client.query(
        `UPDATE shopping_cart 
         SET quantity = $1, updated_at = CURRENT_TIMESTAMP
         WHERE student_id = $2 AND dish_id = $3
         RETURNING *`,
        [newQuantity, studentId, dishId]
      );
    } else {
      if (quantity > dish.stock) {
        throw new AppError(`超出库存限制，当前仅剩 ${dish.stock} 份`, 400);
      }
      result = await client.query(
        `INSERT INTO shopping_cart (student_id, dish_id, quantity)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [studentId, dishId, quantity]
      );
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCartItem(studentId: string, cartItemId: string, quantity: number) {
  if (quantity <= 0) {
    return removeFromCart(studentId, cartItemId);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const cartResult = await client.query(
      'SELECT * FROM shopping_cart WHERE id = $1 AND student_id = $2',
      [cartItemId, studentId]
    );
    if (cartResult.rows.length === 0) {
      throw new AppError('购物车项不存在', 404);
    }

    const dishResult = await client.query(
      'SELECT stock FROM dishes WHERE id = $1',
      [cartResult.rows[0].dish_id]
    );
    if (dishResult.rows.length === 0 || dishResult.rows[0].stock < quantity) {
      throw new AppError('库存不足', 400);
    }

    const result = await client.query(
      `UPDATE shopping_cart 
       SET quantity = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND student_id = $3
       RETURNING *`,
      [quantity, cartItemId, studentId]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function removeFromCart(studentId: string, cartItemId: string) {
  const result = await query(
    'DELETE FROM shopping_cart WHERE id = $1 AND student_id = $2',
    [cartItemId, studentId]
  );
  if (result.rowCount === 0) {
    throw new AppError('购物车项不存在', 404);
  }
  return { success: true };
}

export async function clearCart(studentId: string) {
  await query(
    'DELETE FROM shopping_cart WHERE student_id = $1',
    [studentId]
  );
  return { success: true };
}

export async function batchUpdateCart(studentId: string, updates: CartUpdateInput[]) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const update of updates) {
      if (update.quantity <= 0) {
        await client.query(
          'DELETE FROM shopping_cart WHERE student_id = $1 AND dish_id = $2',
          [studentId, update.dish_id]
        );
        continue;
      }

      const dishResult = await client.query(
        'SELECT stock, is_available FROM dishes WHERE id = $1',
        [update.dish_id]
      );
      if (dishResult.rows.length === 0) continue;
      if (!dishResult.rows[0].is_available) continue;
      if (dishResult.rows[0].stock < update.quantity) continue;

      await client.query(
        `INSERT INTO shopping_cart (student_id, dish_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id, dish_id) DO UPDATE
         SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP`,
        [studentId, update.dish_id, update.quantity]
      );
    }

    await client.query('COMMIT');
    return await getCart(studentId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkoutFromCart(studentId: string, pickupScheduledTime?: string) {
  const cart = await getCart(studentId);

  if (cart.items.length === 0) {
    throw new AppError('购物车为空，请先添加餐品', 400);
  }

  if (cart.validItems.length === 0) {
    const reasons = cart.invalidItems.map((item: any) => {
      if (!item.dish.is_available) return `${item.dish.name}：已下架`;
      if (item.dish.stock < item.quantity) return `${item.dish.name}：库存仅剩 ${item.dish.stock} 份`;
      return `${item.dish.name}：不可用`;
    });
    throw new AppError('购物车中没有可结算餐品，原因：' + reasons.join('；'), 400);
  }

  const items = cart.validItems.map((item: any) => ({
    dish_id: item.dish_id,
    quantity: item.quantity,
  }));

  return {
    preview: {
      items,
      totalAmount: cart.totalAmount,
      itemCount: cart.validItems.length,
      totalQuantity: cart.validItems.reduce((sum: number, it: any) => sum + it.quantity, 0),
    },
    pickupScheduledTime,
    invalidItems: cart.invalidItems.map((it: any) => ({
      dish_id: it.dish_id,
      dish_name: it.dish?.name || '未知餐品',
      reason: !it.dish.is_available ? '已下架' : `库存不足（剩余 ${it.dish?.stock || 0} 份）`,
    })),
  };
}

export async function submitOrderFromCart(
  studentId: string,
  pickupScheduledTime?: string
) {
  const previewResult = await checkoutFromCart(studentId, pickupScheduledTime);

  const orderResult = await createOrder(
    studentId,
    previewResult.preview.items,
    {
      pickup_scheduled_time: pickupScheduledTime,
      clear_cart: true,
    }
  );

  return {
    order: orderResult.order,
    mealTasks: orderResult.mealTasks,
    skippedItems: previewResult.invalidItems,
  };
}
