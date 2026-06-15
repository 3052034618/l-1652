import { query } from '../database/pool';
import { DailyRevenuePoint, HotDishItem } from '../types';

export async function getRevenueTrend(
  startDate: string,
  endDate: string,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<{ dates: string[]; revenues: number[]; orderCounts: number[]; points: DailyRevenuePoint[] }> {
  const dateFormatMap = {
    day: 'YYYY-MM-DD',
    week: 'IYYY-IW',
    month: 'YYYY-MM',
  };
  const toCharFormat = dateFormatMap[groupBy];

  const result = await query(
    `SELECT 
       TO_CHAR(DATE(o.created_at), 'YYYY-MM-DD') as date_key,
       COALESCE(SUM(o.total_amount), 0) as revenue,
       COUNT(DISTINCT o.id) as order_count
     FROM orders o
     WHERE o.status IN ('paid', 'preparing', 'ready', 'completed')
       AND DATE(o.created_at) BETWEEN $1::date AND $2::date
     GROUP BY DATE(o.created_at)
     ORDER BY date_key ASC`,
    [startDate, endDate]
  );

  const points: DailyRevenuePoint[] = result.rows.map((row: any) => ({
    date: row.date_key,
    revenue: parseFloat(row.revenue) || 0,
    order_count: parseInt(row.order_count, 10) || 0,
  }));

  return {
    dates: points.map(p => p.date),
    revenues: points.map(p => p.revenue),
    orderCounts: points.map(p => p.order_count),
    points,
  };
}

export async function getOrderTrend(
  startDate: string,
  endDate: string
): Promise<{
  dates: string[];
  totalOrders: number[];
  paidOrders: number[];
  preparingOrders: number[];
  readyOrders: number[];
  completedOrders: number[];
  cancelledOrders: number[];
}> {
  const result = await query(
    `SELECT 
       TO_CHAR(DATE(o.created_at), 'YYYY-MM-DD') as date_key,
       COUNT(DISTINCT o.id) as total,
       COUNT(DISTINCT CASE WHEN o.status = 'paid' THEN o.id END) as paid,
       COUNT(DISTINCT CASE WHEN o.status = 'preparing' THEN o.id END) as preparing,
       COUNT(DISTINCT CASE WHEN o.status = 'ready' THEN o.id END) as ready,
       COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completed,
       COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END) as cancelled
     FROM orders o
     WHERE DATE(o.created_at) BETWEEN $1::date AND $2::date
     GROUP BY DATE(o.created_at)
     ORDER BY date_key ASC`,
    [startDate, endDate]
  );

  const rows = result.rows;
  return {
    dates: rows.map((r: any) => r.date_key),
    totalOrders: rows.map((r: any) => parseInt(r.total, 10) || 0),
    paidOrders: rows.map((r: any) => parseInt(r.paid, 10) || 0),
    preparingOrders: rows.map((r: any) => parseInt(r.preparing, 10) || 0),
    readyOrders: rows.map((r: any) => parseInt(r.ready, 10) || 0),
    completedOrders: rows.map((r: any) => parseInt(r.completed, 10) || 0),
    cancelledOrders: rows.map((r: any) => parseInt(r.cancelled, 10) || 0),
  };
}

export async function getHotDishesRanking(
  startDate: string,
  endDate: string,
  limit: number = 10,
  category?: string
): Promise<HotDishItem[]> {
  let sql = `
    SELECT 
      d.id as dish_id,
      d.name as dish_name,
      d.type as category,
      COALESCE(SUM(oi.quantity), 0) as count,
      COALESCE(SUM(oi.subtotal), 0) as revenue
    FROM dishes d
    LEFT JOIN order_items oi ON d.id = oi.dish_id
    LEFT JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('paid', 'preparing', 'ready', 'completed')
      AND DATE(o.created_at) BETWEEN $1::date AND $2::date
  `;
  const params: any[] = [startDate, endDate];
  let idx = 3;

  if (category) {
    sql += ` AND d.type = $${idx}`;
    params.push(category);
    idx++;
  }

  sql += `
    GROUP BY d.id, d.name, d.type
    ORDER BY count DESC, revenue DESC
    LIMIT $${idx}
  `;
  params.push(limit);

  const result = await query(sql, params);

  return result.rows.map((row: any) => ({
    dish_id: row.dish_id,
    dish_name: row.dish_name,
    count: parseInt(row.count, 10) || 0,
    revenue: parseFloat(row.revenue) || 0,
    category: row.category,
  }));
}

export async function getDishCategoryDistribution(
  startDate: string,
  endDate: string
): Promise<{ categories: string[]; values: number[]; percentages: number[] }> {
  const result = await query(
    `SELECT 
       d.type as category,
       COALESCE(SUM(oi.quantity), 0) as count
     FROM dishes d
     LEFT JOIN order_items oi ON d.id = oi.dish_id
     LEFT JOIN orders o ON oi.order_id = o.id
     WHERE o.status IN ('paid', 'preparing', 'ready', 'completed')
       AND DATE(o.created_at) BETWEEN $1::date AND $2::date
     GROUP BY d.type
     ORDER BY count DESC`,
    [startDate, endDate]
  );

  const rows = result.rows;
  const totalCount = rows.reduce((sum: number, r: any) => sum + (parseInt(r.count, 10) || 0), 0);

  return {
    categories: rows.map((r: any) => r.category),
    values: rows.map((r: any) => parseInt(r.count, 10) || 0),
    percentages: rows.map((r: any) => totalCount > 0 ? ((parseInt(r.count, 10) || 0) / totalCount * 100) : 0),
  };
}

export async function getTimeSlotDistribution(
  date: string
): Promise<{ slots: string[]; values: number[] }> {
  const result = await query(
    `SELECT 
       TO_CHAR(created_at, 'HH24:00') as time_slot,
       COUNT(*) as count
     FROM orders
     WHERE status IN ('paid', 'preparing', 'ready', 'completed')
       AND DATE(created_at) = $1::date
     GROUP BY TO_CHAR(created_at, 'HH24:00')
     ORDER BY time_slot ASC`,
    [date]
  );

  return {
    slots: result.rows.map((r: any) => r.time_slot),
    values: result.rows.map((r: any) => parseInt(r.count, 10) || 0),
  };
}

export async function getPeriodComparison(
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string
): Promise<{
  current: { totalRevenue: number; totalOrders: number; avgOrderValue: number };
  previous: { totalRevenue: number; totalOrders: number; avgOrderValue: number };
  change: { revenueChange: number; orderChange: number; avgValueChange: number };
}> {
  const currentResult = await query(
    `SELECT 
       COALESCE(SUM(total_amount), 0) as revenue,
       COUNT(*) as orders,
       COALESCE(AVG(total_amount), 0) as avg_value
     FROM orders
     WHERE status IN ('paid', 'preparing', 'ready', 'completed')
       AND DATE(created_at) BETWEEN $1::date AND $2::date`,
    [currentStart, currentEnd]
  );

  const previousResult = await query(
    `SELECT 
       COALESCE(SUM(total_amount), 0) as revenue,
       COUNT(*) as orders,
       COALESCE(AVG(total_amount), 0) as avg_value
     FROM orders
     WHERE status IN ('paid', 'preparing', 'ready', 'completed')
       AND DATE(created_at) BETWEEN $1::date AND $2::date`,
    [previousStart, previousEnd]
  );

  const curr = currentResult.rows[0];
  const prev = previousResult.rows[0];

  const currentRevenue = parseFloat(curr.revenue) || 0;
  const currentOrders = parseInt(curr.orders, 10) || 0;
  const currentAvg = parseFloat(curr.avg_value) || 0;

  const previousRevenue = parseFloat(prev.revenue) || 0;
  const previousOrders = parseInt(prev.orders, 10) || 0;
  const previousAvg = parseFloat(prev.avg_value) || 0;

  return {
    current: {
      totalRevenue: currentRevenue,
      totalOrders: currentOrders,
      avgOrderValue: currentAvg,
    },
    previous: {
      totalRevenue: previousRevenue,
      totalOrders: previousOrders,
      avgOrderValue: previousAvg,
    },
    change: {
      revenueChange: previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100) : 0,
      orderChange: previousOrders > 0 ? ((currentOrders - previousOrders) / previousOrders * 100) : 0,
      avgValueChange: previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg * 100) : 0,
    },
  };
}

export async function getExceptionDashboard(
  startDate: string,
  endDate: string
): Promise<{
  summary: {
    refundOrders: number;
    cancelledOrders: number;
    lowStockAlerts: number;
    purchaseTimeouts: number;
    totalExceptions: number;
  };
  trend: {
    dates: string[];
    refundOrders: number[];
    cancelledOrders: number[];
    lowStockAlerts: number[];
    purchaseTimeouts: number[];
    snapshotNotes: string;
  };
  alertCards: {
    type: string;
    title: string;
    count: number;
    level: 'high' | 'medium' | 'low';
    suggestion: string;
    metric_kind: 'event' | 'snapshot';
  }[];
  details: {
    recentCancelledOrders: any[];
    lowStockItems: any[];
    timeoutPurchases: any[];
  };
}> {
  const cancelTrendResult = await query(
    'SELECT ' +
    "  TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date_key, " +
    '  COUNT(*) as count ' +
    'FROM orders ' +
    "WHERE status IN ('cancelled') " +
    '  AND DATE(created_at) BETWEEN $1::date AND $2::date ' +
    'GROUP BY DATE(created_at) ' +
    'ORDER BY date_key ASC',
    [startDate, endDate]
  );

  const orderStatsResult = await query(
    'SELECT ' +
    "  COUNT(*) as cancelled_count, " +
    "  COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total_amount ELSE 0 END), 0) as cancelled_amount " +
    'FROM orders ' +
    "WHERE status IN ('cancelled') " +
    '  AND DATE(created_at) BETWEEN $1::date AND $2::date',
    [startDate, endDate]
  );

  const lowStockResult = await query(
    'SELECT ' +
    '  i.id, i.name, i.category, i.current_stock, i.safety_stock, i.status, i.unit, ' +
    '  i.supplier_id, u.name as supplier_name, i.updated_at, ' +
    "  CASE WHEN i.status = 'expired' THEN 0 " +
    "       WHEN i.status = 'near_expiry' THEN 1 " +
    '       ELSE 2 ' +
    '  END as urgency_rank ' +
    'FROM ingredients i ' +
    'LEFT JOIN users u ON i.supplier_id = u.id ' +
    "WHERE i.current_stock <= i.safety_stock " +
    "  OR i.status IN ('near_expiry', 'expired') " +
    'ORDER BY ' +
    "  urgency_rank ASC, " +
    '  (i.current_stock / NULLIF(i.safety_stock, 0)) ASC ' +
    'LIMIT 50'
  );

  const timeoutPurchaseSql =
    'SELECT pr.id, pr.ingredient_id, pr.quantity, pr.status, pr.created_at, pr.supplier_id, ' +
    '       pr.expected_delivery_time, pr.remark, i.name as ingredient_name, u.name as supplier_name, ' +
    '       EXTRACT(EPOCH FROM (NOW() - pr.created_at)) / 3600 as hours_since_created, ' +
    '       CASE ' +
    "         WHEN pr.status = 'pending' AND EXTRACT(EPOCH FROM (NOW() - pr.created_at)) > 2 * 3600 THEN 'pending_timeout' " +
    "         WHEN pr.status = 'ordered' AND EXTRACT(EPOCH FROM (NOW() - pr.created_at)) > 4 * 3600 THEN 'supplier_slow' " +
    "         WHEN pr.status = 'supplier_accepted' AND pr.expected_delivery_time IS NOT NULL AND pr.expected_delivery_time < NOW() THEN 'delivery_overdue' " +
    "         WHEN pr.status = 'shipping' AND pr.expected_delivery_time IS NOT NULL AND pr.expected_delivery_time < NOW() THEN 'shipping_overdue' " +
    '         ELSE NULL ' +
    '       END as timeout_reason ' +
    'FROM purchase_requests pr ' +
    'JOIN ingredients i ON pr.ingredient_id = i.id ' +
    'LEFT JOIN users u ON pr.supplier_id = u.id ' +
    "WHERE pr.status IN ('pending', 'ordered', 'supplier_accepted', 'shipping') " +
    '  AND (' +
    "    (pr.status = 'pending' AND EXTRACT(EPOCH FROM (NOW() - pr.created_at)) > 2 * 3600) OR " +
    "    (pr.status = 'ordered' AND EXTRACT(EPOCH FROM (NOW() - pr.created_at)) > 4 * 3600) OR " +
    "    (pr.status = 'supplier_accepted' AND pr.expected_delivery_time IS NOT NULL AND pr.expected_delivery_time < NOW()) OR " +
    "    (pr.status = 'shipping' AND pr.expected_delivery_time IS NOT NULL AND pr.expected_delivery_time < NOW()) " +
    '  ) ' +
    'ORDER BY hours_since_created DESC ' +
    'LIMIT 50';

  const pendingPurchasesResult = await query(timeoutPurchaseSql);

  const cancelledOrdersResult = await query(
    'SELECT o.id, o.student_id, o.total_amount, o.status, o.created_at, o.completed_at, ' +
    '       o.cancelled_at, o.pickup_scheduled_time, o.remark, ' +
    '       s.name as student_name, s.student_no ' +
    'FROM orders o ' +
    'LEFT JOIN student_accounts sa ON o.student_id = sa.student_id ' +
    'LEFT JOIN users s ON sa.student_id = s.id ' +
    "WHERE o.status IN ('cancelled') " +
    '  AND DATE(o.created_at) BETWEEN $1::date AND $2::date ' +
    'ORDER BY o.created_at DESC ' +
    'LIMIT 50',
    [startDate, endDate]
  );

  const cancelledCount = parseInt(orderStatsResult.rows[0]?.cancelled_count || 0, 10);
  const lowStockCount = lowStockResult.rows.length;
  const purchaseTimeoutCount = pendingPurchasesResult.rows.length;
  const refundCount = 0;

  const totalExceptions = cancelledCount + refundCount + lowStockCount + purchaseTimeoutCount;

  const allDates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split('T')[0]);
  }

  const cancelMap: Record<string, number> = {};
  cancelTrendResult.rows.forEach((row: any) => {
    cancelMap[row.date_key] = parseInt(row.count || 0, 10);
  });

  const cancelledOrdersArray = allDates.map(d => cancelMap[d] || 0);
  const refundOrdersArray = allDates.map(_d => 0);

  return {
    summary: {
      refundOrders: refundCount,
      cancelledOrders: cancelledCount,
      lowStockAlerts: lowStockCount,
      purchaseTimeouts: purchaseTimeoutCount,
      totalExceptions,
    },
    trend: {
      dates: allDates,
      refundOrders: refundOrdersArray,
      cancelledOrders: cancelledOrdersArray,
      lowStockAlerts: allDates.map(() => lowStockCount),
      purchaseTimeouts: allDates.map(() => purchaseTimeoutCount),
      snapshotNotes:
        '低库存告警和采购超时为当前快照指标（非区间历史事件），区间内每日值与当前实际值一致，便于统一看板展示。取消订单和退款为区间内真实事件统计。',
    },
    alertCards: [
      {
        type: 'cancelled',
        title: '订单取消',
        count: cancelledCount,
        level: cancelledCount > 20 ? 'high' : cancelledCount > 5 ? 'medium' : 'low',
        suggestion:
          cancelledCount > 20
            ? '取消订单数量异常偏高，建议检查备餐和库存情况，了解学生退单原因'
            : cancelledCount > 5
            ? '取消订单数量略高，可关注是否有集中菜品问题'
            : '订单取消数处于正常范围',
        metric_kind: 'event',
      },
      {
        type: 'refund',
        title: '退款处理',
        count: refundCount,
        level: 'low',
        suggestion: '关注退款流程的及时性，确保学生账户余额正确到账',
        metric_kind: 'event',
      },
      {
        type: 'low_stock',
        title: '库存告警',
        count: lowStockCount,
        level: lowStockCount > 10 ? 'high' : lowStockCount > 3 ? 'medium' : 'low',
        suggestion:
          lowStockCount > 10
            ? '低库存食材较多，紧急采购并检查安全水位设置'
            : lowStockCount > 3
            ? '有部分食材需要补充，安排采购审批'
            : '库存状况良好',
        metric_kind: 'snapshot',
      },
      {
        type: 'purchase_timeout',
        title: '采购超时',
        count: purchaseTimeoutCount,
        level: purchaseTimeoutCount > 5 ? 'high' : purchaseTimeoutCount > 0 ? 'medium' : 'low',
        suggestion:
          purchaseTimeoutCount > 5
            ? '多笔采购单超时，建议更换供应商或重新询价'
            : purchaseTimeoutCount > 0
            ? '有采购单响应较慢，请主动联系供应商确认'
            : '所有采购单进度正常',
        metric_kind: 'snapshot',
      },
    ],
    details: {
      recentCancelledOrders: cancelledOrdersResult.rows,
      lowStockItems: lowStockResult.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        unit: r.unit,
        current_stock: parseFloat(r.current_stock) || 0,
        safety_stock: parseFloat(r.safety_stock) || 0,
        shortage_ratio: r.safety_stock > 0 ? (parseFloat(r.current_stock) || 0) / (parseFloat(r.safety_stock) || 1) : 0,
        status: r.status,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        updated_at: r.updated_at,
      })),
      timeoutPurchases: pendingPurchasesResult.rows.map((r: any) => ({
        id: r.id,
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        quantity: parseFloat(r.quantity) || 0,
        status: r.status,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        expected_delivery_time: r.expected_delivery_time,
        remark: r.remark,
        hours_since_created: parseFloat(r.hours_since_created) || 0,
        timeout_reason: r.timeout_reason,
      })),
    },
  };
}
