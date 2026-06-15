import { query } from '../database/pool';
import { notifyOperationsReport } from './notification';
import { getAllAdmins } from './notification';

export async function generateMonthlyOperationsReport(month?: string) {
  const now = new Date();
  const reportMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, monthNum] = reportMonth.split('-').map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);

  const existing = await query(
    'SELECT * FROM operations_reports WHERE report_month = $1',
    [reportMonth]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const ordersResult = await query(
    `SELECT COUNT(*) as total_orders,
            COALESCE(SUM(total_amount), 0) as total_revenue,
            COALESCE(AVG(total_amount), 0) as avg_order_value
     FROM orders
     WHERE status IN ('completed', 'ready')
       AND created_at BETWEEN $1 AND $2`,
    [startDate, endDate]
  );

  const totalOrders = parseInt(ordersResult.rows[0].total_orders, 10) || 0;
  const totalRevenue = parseFloat(ordersResult.rows[0].total_revenue) || 0;
  const avgOrderValue = parseFloat(ordersResult.rows[0].avg_order_value) || 0;

  const prepTimeResult = await query(
    `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (mt.completed_at - mt.assigned_at)) / 60) as avg_prep_minutes
     FROM meal_tasks mt
     JOIN orders o ON mt.order_id = o.id
     WHERE mt.completed_at IS NOT NULL
       AND mt.assigned_at IS NOT NULL
       AND o.created_at BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  const avgPrepTime = parseFloat(prepTimeResult.rows[0].avg_prep_minutes) || 0;

  const wasteResult = await query(
    `SELECT 
       COALESCE(SUM(CASE WHEN isr.type = 'waste' THEN isr.quantity ELSE 0 END) as total_waste,
       COALESCE(SUM(CASE WHEN isr.type = 'out' THEN isr.quantity ELSE 0 END)) as total_out
     FROM ingredient_stock_records isr
     WHERE isr.created_at BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  const totalWaste = parseFloat(wasteResult.rows[0].total_waste) || 0;
  const totalOut = parseFloat(wasteResult.rows[0].total_out) || 0;
  const wasteRate = totalOut > 0 ? totalWaste / (totalWaste + totalOut) : 0;

  const topDishesResult = await query(
    `SELECT d.id as dish_id, d.name as dish_name,
            SUM(oi.quantity) as count
     FROM order_items oi
     JOIN dishes d ON oi.dish_id = d.id
     JOIN orders o ON oi.order_id = o.id
     WHERE o.status IN ('completed', 'ready')
       AND o.created_at BETWEEN $1 AND $2
     GROUP BY d.id, d.name
     ORDER BY count DESC
     LIMIT 10`,
    [startDate, endDate]
  );
  const topSellingDishes = topDishesResult.rows.map(r => ({
    dish_id: r.dish_id,
    dish_name: r.dish_name,
    count: parseInt(r.count, 10),
  }));

  const result = await query(
    `INSERT INTO operations_reports
      (report_month, total_orders, total_revenue, avg_order_value,
       avg_prep_time_minutes, ingredient_waste_rate, top_selling_dishes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (report_month) DO UPDATE SET
       total_orders = EXCLUDED.total_orders,
       total_revenue = EXCLUDED.total_revenue,
       avg_order_value = EXCLUDED.avg_order_value,
       avg_prep_time_minutes = EXCLUDED.avg_prep_time_minutes,
       ingredient_waste_rate = EXCLUDED.ingredient_waste_rate,
       top_selling_dishes = EXCLUDED.top_selling_dishes
     RETURNING *`,
    [
      reportMonth,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      avgPrepTime,
      wasteRate,
      JSON.stringify(topSellingDishes),
    ]
  );

  const report = result.rows[0];

  const admins = await getAllAdmins();
  const adminIds = admins.map(a => a.id);
  await notifyOperationsReport(adminIds, reportMonth);

  return report;
}

export async function getOperationsReports(limit: number = 12) {
  const result = await query(
    'SELECT * FROM operations_reports ORDER BY report_month DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

export async function getOperationsReportByMonth(month: string) {
  const result = await query(
    'SELECT * FROM operations_reports WHERE report_month = $1',
    [month]
  );
  if (result.rows.length === 0) {
    return generateMonthlyOperationsReport(month);
  }
  return result.rows[0];
}

export async function exportOperationsReport(month: string): Promise<string> {
  const report = await getOperationsReportByMonth(month);

  const csvLines = [
    `智慧校园食堂运营报表 - ${month}`,
    '',
    `统计月份,${report.report_month}`,
    `总订单数,${report.total_orders}`,
    `总营收(元),${report.total_revenue}`,
    `客单价(元),${report.avg_order_value}`,
    `平均备餐时间(分钟),${report.avg_prep_time_minutes}`,
    `食材损耗率,${(report.ingredient_waste_rate * 100).toFixed(2)}%`,
    '',
    '热销菜品排行:',
    '排名,菜品名称,销售数量',
  ];

  const dishes = Array.isArray(report.top_selling_dishes) ? report.top_selling_dishes : [];
  dishes.forEach((dish, index) => {
    csvLines.push(`${index + 1},${dish.dish_name},${dish.count}`);
  });

  return csvLines.join('\n');
}
