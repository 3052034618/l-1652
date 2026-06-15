import { query, getClient } from '../database/pool';
import { emitToUser } from './socket';

export type NotificationType =
  | 'order_status'
  | 'order_ready'
  | 'balance_low'
  | 'meal_task'
  | 'ingredient_expiry'
  | 'ingredient_low_stock'
  | 'purchase_request'
  | 'purchase_approved'
  | 'nutrition_report'
  | 'operations_report'
  | 'system';

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  content: string,
  data?: Record<string, any>
) {
  const result = await query(
    `INSERT INTO notifications (user_id, type, title, content, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [userId, type, title, content, data ? JSON.stringify(data) : null]
  );

  const notification = result.rows[0];
  
  emitToUser(userId, 'notification:new', notification);
  
  return notification;
}

export async function getUserNotifications(userId: string, limit: number = 50) {
  const result = await query(
    `SELECT * FROM notifications 
     WHERE user_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

export async function getUnreadCount(userId: string) {
  const result = await query(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`,
    [userId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function markAsRead(userId: string, notificationId: string) {
  await query(
    `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
}

export async function markAllAsRead(userId: string) {
  await query(
    `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
    [userId]
  );
}

export async function notifyOrderStatusChange(
  userId: string,
  orderId: string,
  status: string,
  message: string
) {
  const statusMap: Record<string, string> = {
    paid: '已支付',
    preparing: '制作中',
    ready: '待取餐',
    completed: '已完成',
    cancelled: '已取消',
  };

  return createNotification(
    userId,
    'order_status',
    `订单${statusMap[status] || status}`,
    message,
    { orderId, status }
  );
}

export async function notifyLowBalance(userId: string, currentBalance: number, needed: number) {
  return createNotification(
    userId,
    'balance_low',
    '账户余额不足',
    `当前余额 ¥${currentBalance.toFixed(2)}，需要 ¥${needed.toFixed(2)}，请及时充值`,
    { currentBalance, needed }
  );
}

export async function notifyMealTask(
  chefId: string,
  taskId: string,
  dishName: string,
  quantity: number
) {
  return createNotification(
    chefId,
    'meal_task',
    '新的备餐任务',
    `请备餐：${dishName} x ${quantity}`,
    { taskId, dishName, quantity }
  );
}

export async function notifyIngredientExpiry(
  adminIds: string[],
  ingredientName: string,
  daysLeft: number,
  status: 'near_expiry' | 'expired'
) {
  const title = status === 'expired' ? '食材已过期' : '食材即将过期';
  const content = status === 'expired'
    ? `食材「${ingredientName}」已过期，请及时处理`
    : `食材「${ingredientName}」将在 ${daysLeft} 天后过期`;

  for (const adminId of adminIds) {
    await createNotification(adminId, 'ingredient_expiry', title, content, {
      ingredientName,
      daysLeft,
      status,
    });
  }
}

export async function notifyLowStock(
  adminIds: string[],
  ingredientName: string,
  currentStock: number,
  safetyStock: number
) {
  for (const adminId of adminIds) {
    await createNotification(adminId, 'ingredient_low_stock', '库存低于安全水位',
      `食材「${ingredientName}」当前库存 ${currentStock}，低于安全库存 ${safetyStock}`,
      { ingredientName, currentStock, safetyStock }
    );
  }
}

export async function notifyPurchaseRequest(
  adminIds: string[],
  ingredientName: string,
  quantity: number
) {
  for (const adminId of adminIds) {
    await createNotification(adminId, 'purchase_request', '新的采购申请',
      `需要采购「${ingredientName}」数量: ${quantity}`,
      { ingredientName, quantity }
    );
  }
}

export async function notifyPurchaseApproved(
  supplierId: string,
  ingredientName: string,
  quantity: number
) {
  return createNotification(
    supplierId,
    'purchase_approved',
    '采购订单已批准',
    `请准备配送「${ingredientName}」数量: ${quantity}`,
    { ingredientName, quantity }
  );
}

export async function notifyNutritionReport(
  parentId: string,
  studentName: string,
  reportDate: string,
  summary: string
) {
  return createNotification(
    parentId,
    'nutrition_report',
    `${studentName}的营养报告`,
    `${reportDate}营养分析：${summary}`,
    { studentName, reportDate }
  );
}

export async function notifyOperationsReport(
  adminIds: string[],
  reportMonth: string
) {
  for (const adminId of adminIds) {
    await createNotification(adminId, 'operations_report', '月度运营报表已生成',
      `${reportMonth} 运营报表已就绪，请查看`,
      { reportMonth }
    );
  }
}
