import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { notifyNutritionReport } from './notification';

const DAILY_RECOMMENDED = {
  calories: 2000,
  protein: 60,
  fat: 65,
  carbs: 300,
  sodium: 2000,
};

export async function generateDailyNutritionReports(date?: string) {
  const reportDate = date || new Date().toISOString().split('T')[0];

  const ordersResult = await query(
    `SELECT DISTINCT o.student_id
     FROM orders o
     WHERE o.status IN ('completed', 'ready')
       AND DATE(o.created_at) = $1`,
    [reportDate]
  );

  const studentIds = ordersResult.rows.map(r => r.student_id);
  const reports: any[] = [];

  for (const studentId of studentIds) {
    const report = await generateStudentNutritionReport(studentId, reportDate);
    if (report) {
      reports.push(report);
    }
  }

  return { generated: reports.length, date: reportDate };
}

export async function generateStudentNutritionReport(studentId: string, date?: string) {
  const reportDate = date || new Date().toISOString().split('T')[0];

  const reportResult = await query(
    'SELECT * FROM nutrition_reports WHERE student_id = $1 AND report_date = $2',
    [studentId, reportDate]
  );

  if (reportResult.rows.length > 0) {
    return reportResult.rows[0];
  }

  const orderItemsResult = await query(
    `SELECT oi.dish_id, oi.quantity, d.nutrition_info
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN dishes d ON oi.dish_id = d.id
     WHERE o.student_id = $1
       AND o.status IN ('completed', 'ready', 'preparing')
       AND DATE(o.created_at) = $2`,
    [studentId, reportDate]
  );

  const totals = {
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    sodium: 0,
  };

  for (const item of orderItemsResult.rows) {
    const nutrition = item.nutrition_info || {};
    totals.calories += (nutrition.calories || 0) * item.quantity;
    totals.protein += (nutrition.protein || 0) * item.quantity;
    totals.fat += (nutrition.fat || 0) * item.quantity;
    totals.carbs += (nutrition.carbs || 0) * item.quantity;
    totals.sodium += (nutrition.sodium || 0) * item.quantity;
  }

  const recommendations = generateRecommendations(totals);

  const result = await query(
    `INSERT INTO nutrition_reports 
      (student_id, report_date, total_calories, total_protein, total_fat, total_carbs, total_sodium, recommendations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
     ON CONFLICT (student_id, report_date) DO UPDATE SET
       total_calories = EXCLUDED.total_calories,
       total_protein = EXCLUDED.total_protein,
       total_fat = EXCLUDED.total_fat,
       total_carbs = EXCLUDED.total_carbs,
       total_sodium = EXCLUDED.total_sodium,
       recommendations = EXCLUDED.recommendations
     RETURNING *`,
    [
      studentId,
      reportDate,
      totals.calories,
      totals.protein,
      totals.fat,
      totals.carbs,
      totals.sodium,
      recommendations,
    ]
  );

  const report = result.rows[0];

  const parentResult = await query(
    'SELECT parent_id FROM student_accounts WHERE student_id = $1',
    [studentId]
  );
  const parentId = parentResult.rows[0]?.parent_id;

  if (parentId) {
    const userResult = await query(
      'SELECT name FROM users WHERE id = $1',
      [studentId]
    );
    const studentName = userResult.rows[0]?.name || '学生';
    
    const summary = `摄入热量${totals.calories.toFixed(0)}千卡，蛋白质${totals.protein.toFixed(1)}克，脂肪${totals.fat.toFixed(1)}克`;
    
    await notifyNutritionReport(parentId, studentName, reportDate, summary);

    await query(
      'UPDATE nutrition_reports SET sent_to_parent = true WHERE id = $1',
      [report.id]
    );
  }

  return report;
}

function generateRecommendations(totals: typeof DAILY_RECOMMENDED): string[] {
  const recommendations: string[] = [];

  if (totals.calories < DAILY_RECOMMENDED.calories * 0.8) {
    recommendations.push('今日热量摄入偏低，建议适当增加主食或优质蛋白摄入');
  } else if (totals.calories > DAILY_RECOMMENDED.calories * 1.2) {
    recommendations.push('今日热量摄入偏高，建议控制高热量食物');
  }

  if (totals.protein < DAILY_RECOMMENDED.protein * 0.8) {
    recommendations.push('蛋白质摄入不足，建议增加蛋奶、肉类或豆制品');
  }

  if (totals.fat > DAILY_RECOMMENDED.fat * 1.2) {
    recommendations.push('脂肪摄入偏高，建议减少油炸食品');
  }

  if (totals.sodium > DAILY_RECOMMENDED.sodium) {
    recommendations.push('钠摄入偏高，建议选择清淡菜品');
  }

  if (totals.calories >= DAILY_RECOMMENDED.calories * 0.9
    && totals.calories <= DAILY_RECOMMENDED.calories * 1.1
    && totals.protein >= DAILY_RECOMMENDED.protein * 0.9) {
    recommendations.push('今日饮食营养搭配均衡，继续保持！');
  }

  if (recommendations.length === 0) {
    recommendations.push('今日饮食情况良好');
  }

  return recommendations;
}

export async function getStudentNutritionReports(studentId: string, limit: number = 30) {
  const result = await query(
    `SELECT * FROM nutrition_reports
     WHERE student_id = $1
     ORDER BY report_date DESC
     LIMIT $2`,
    [studentId, limit]
  );
  return result.rows;
}

export async function getNutritionReportByDate(studentId: string, date: string) {
  const result = await query(
    'SELECT * FROM nutrition_reports WHERE student_id = $1 AND report_date = $2',
    [studentId, date]
  );
  if (result.rows.length === 0) {
    return generateStudentNutritionReport(studentId, date);
  }
  return result.rows[0];
}
