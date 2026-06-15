import { getClient, query } from '../database/pool';
import { AppError } from '../utils/response';
import { deductBalance } from './account';
import { checkDishesAvailability, updateDishStock } from './dish';
import { createAndAssignMealTasks } from './mealTask';
import { OrderStatus } from '../types';
import { broadcastOrderUpdate } from './socket';
import { notifyOrderStatusChange, notifyLowBalance } from './notification';
import { validatePickupTimeWithDB } from './canteenHours';

export interface OrderItemInput {
  dish_id: string;
  quantity: number;
}

export interface CreateOrderOptions {
  pickup_scheduled_time?: string;
  clear_cart?: boolean;
}

export async function createOrder(studentId: string, items: OrderItemInput[], options: CreateOrderOptions = {}) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');

    const { validated, totalAmount, issues } = await checkDishesAvailability(items);
    
    if (issues.length > 0) {
      throw new AppError(issues.join('; '), 400);
    }

    if (validated.length === 0) {
      throw new AppError('没有有效的餐品', 400);
    }

    let pickupScheduledTime: Date | null = null;
    if (options.pickup_scheduled_time) {
      const validationResult = await validatePickupTimeWithDB(options.pickup_scheduled_time);
      if (!validationResult.valid) {
        throw new AppError(validationResult.message, 400);
      }
      pickupScheduledTime = new Date(options.pickup_scheduled_time);
    }

    const accountResult = await client.query(
      'SELECT balance FROM student_accounts WHERE student_id = $1',
      [studentId]
    );
    if (accountResult.rows.length === 0) {
      throw new AppError('学生账户不存在', 404);
    }
    const currentBalance = parseFloat(accountResult.rows[0].balance);
    if (currentBalance < totalAmount) {
      await client.query('ROLLBACK');
      await notifyLowBalance(studentId, currentBalance, totalAmount);
      throw new AppError('账户余额不足，请先充值后再点餐', 400);
    }

    const orderResult = await client.query(
      `INSERT INTO orders (student_id, total_amount, status, pickup_scheduled_time)
       VALUES ($1, $2, 'paid', $3)
       RETURNING *`,
      [studentId, totalAmount, pickupScheduledTime]
    );
    const order = orderResult.rows[0];

    await deductBalance(client, studentId, totalAmount, order.id, '订单扣款');

    const orderItems: any[] = [];
    for (const item of validated) {
      const oiResult = await client.query(
        `INSERT INTO order_items (order_id, dish_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [order.id, item.dish.id, item.quantity, item.dish.price, item.subtotal]
      );
      orderItems.push(oiResult.rows[0]);

      await updateDishStock(client, item.dish.id, -item.quantity);
    }

    const pickupStart = new Date();
    const pickupEnd = new Date(pickupStart.getTime() + 30 * 60 * 1000);
    
    await client.query(
      `UPDATE orders 
       SET status = 'preparing', pickup_window_start = $1, pickup_window_end = $2
       WHERE id = $3
       RETURNING *`,
      [pickupStart, pickupEnd, order.id]
    );
    order.status = OrderStatus.PREPARING;
    order.pickup_window_start = pickupStart;
    order.pickup_window_end = pickupEnd;

    const mealTasks = await createAndAssignMealTasks(client, order.id, orderItems);

    if (options.clear_cart) {
      await client.query(
        'DELETE FROM shopping_cart WHERE student_id = $1',
        [studentId]
      );
    }

    await client.query('COMMIT');

    broadcastOrderUpdate(order);
    notifyOrderStatusChange(
      studentId,
      order.id,
      OrderStatus.PREPARING,
      `订单已提交，共 ${orderItems.length} 道菜，金额 ¥${totalAmount.toFixed(2)}${pickupScheduledTime ? `，预约取餐：${formatDateTime(pickupScheduledTime)}` : ''}`
    );

    return {
      order: { ...order, items: orderItems },
      mealTasks,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function formatDateTime(date: Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

async function getCurrentBalance(studentId: string): Promise<number> {
  const result = await query(
    'SELECT balance FROM student_accounts WHERE student_id = $1',
    [studentId]
  );
  return result.rows.length > 0 ? parseFloat(result.rows[0].balance) : 0;
}

export async function getOrderById(orderId: string) {
  const orderResult = await query(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );
  if (orderResult.rows.length === 0) {
    throw new AppError('订单不存在', 404);
  }
  const order = orderResult.rows[0];

  const itemsResult = await query(
    `SELECT oi.*, d.name as dish_name, d.image_url as dish_image 
     FROM order_items oi 
     JOIN dishes d ON oi.dish_id = d.id 
     WHERE oi.order_id = $1`,
    [orderId]
  );

  return { ...order, items: itemsResult.rows };
}

export async function getStudentOrders(studentId: string, limit: number = 50) {
  const result = await query(
    `SELECT * FROM orders 
     WHERE student_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [studentId, limit]
  );
  return result.rows;
}

export async function getAllOrders(status?: OrderStatus, limit: number = 100) {
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (status) {
    sql += ` AND status = $${idx}`;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY created_at DESC LIMIT $' + idx;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

export async function updateOrderStatus(orderId: string, newStatus: OrderStatus, operatorId?: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw new AppError('订单不存在', 404);
    }
    const order = orderResult.rows[0];

    let updateSql = 'UPDATE orders SET status = $1';
    const params: any[] = [newStatus];

    if (newStatus === OrderStatus.COMPLETED) {
      updateSql += ', completed_at = CURRENT_TIMESTAMP';
    } else if (newStatus === OrderStatus.CANCELLED) {
      updateSql += ', cancelled_at = CURRENT_TIMESTAMP';
    }

    updateSql += ' WHERE id = $' + (params.length + 1) + ' RETURNING *';
    params.push(orderId);

    const updateResult = await client.query(updateSql, params);
    const updatedOrder = updateResult.rows[0];

    if (newStatus === OrderStatus.CANCELLED && order.status !== OrderStatus.CANCELLED) {
      const itemsResult = await client.query(
        'SELECT dish_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      );
      for (const item of itemsResult.rows) {
        await client.query(
          'UPDATE dishes SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.dish_id]
        );
      }

      const accountResult = await client.query(
        'SELECT balance FROM student_accounts WHERE student_id = $1 FOR UPDATE',
        [order.student_id]
      );
      const currentBalance = parseFloat(accountResult.rows[0].balance);
      const newBalance = currentBalance + parseFloat(order.total_amount);

      await client.query(
        'UPDATE student_accounts SET balance = $1 WHERE student_id = $2',
        [newBalance, order.student_id]
      );

      await client.query(
        `INSERT INTO account_transactions (student_id, order_id, amount, type, balance_after, description)
         VALUES ($1, $2, $3, 'refund', $4, '订单取消退款')`,
        [order.student_id, orderId, order.total_amount, newBalance]
      );
    }

    await client.query('COMMIT');

    broadcastOrderUpdate(updatedOrder);
    notifyOrderStatusChange(
      order.student_id,
      orderId,
      newStatus,
      getStatusMessage(newStatus, order.total_amount)
    );

    return updatedOrder;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function getStatusMessage(status: OrderStatus, amount?: number): string {
  switch (status) {
    case OrderStatus.READY:
      return '您的餐品已准备好，请前往取餐口取餐';
    case OrderStatus.COMPLETED:
      return '订单已完成，感谢您的惠顾';
    case OrderStatus.CANCELLED:
      return `订单已取消，已退款 ¥${amount?.toFixed(2) || '0.00'}`;
    case OrderStatus.PAID:
      return '支付成功';
    case OrderStatus.PREPARING:
      return '餐品正在制作中';
    default:
      return '订单状态已更新';
  }
}

export async function markOrderReady(orderId: string) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const tasksResult = await client.query(
      `SELECT status FROM meal_tasks WHERE order_id = $1`,
      [orderId]
    );

    if (tasksResult.rows.length === 0) {
      throw new AppError('该订单没有备餐任务', 400);
    }

    const allCompleted = tasksResult.rows.every(t => t.status === 'completed');
    if (!allCompleted) {
      throw new AppError('还有备餐任务未完成', 400);
    }

    const result = await client.query(
      `UPDATE orders SET status = 'ready' WHERE id = $1 RETURNING *`,
      [orderId]
    );
    const order = result.rows[0];

    await client.query('COMMIT');

    broadcastOrderUpdate(order);
    notifyOrderStatusChange(order.student_id, orderId, OrderStatus.READY, '您的餐品已准备好，请前往取餐口取餐');

    return order;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
