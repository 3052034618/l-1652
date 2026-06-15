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
