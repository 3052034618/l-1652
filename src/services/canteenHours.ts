import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';
import { MealType } from '../types';

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface HourInput {
  day_of_week: number;
  meal_type: MealType;
  open_time: string;
  last_order_time: string;
  close_time: string;
  is_active?: boolean;
}

export async function getAllCanteenHours(activeOnly: boolean = false) {
  let sql = 'SELECT * FROM canteen_hours WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (activeOnly) {
    sql += ' AND is_active = true';
  }
  sql += ' ORDER BY day_of_week, meal_type';

  const result = await query(sql, params);
  return result.rows;
}

export async function getCanteenHoursByDay(dayOfWeek?: number) {
  const day = dayOfWeek !== undefined ? dayOfWeek : new Date().getDay();
  const result = await query(
    `SELECT * FROM canteen_hours WHERE day_of_week = $1 AND is_active = true ORDER BY meal_type`,
    [day]
  );
  return result.rows;
}

export async function upsertCanteenHour(input: HourInput) {
  const { day_of_week, meal_type, open_time, last_order_time, close_time, is_active = true } = input;
  
  if (day_of_week < 0 || day_of_week > 6) {
    throw new AppError('星期必须在 0-6 之间', 400);
  }

  const openMin = toMinutes(open_time);
  const lastOrderMin = toMinutes(last_order_time);
  const closeMin = toMinutes(close_time);

  if (openMin >= lastOrderMin) {
    throw new AppError('开餐时间必须早于最后点单时间', 400);
  }
  if (lastOrderMin >= closeMin) {
    throw new AppError('最后点单时间必须早于闭餐时间', 400);
  }

  const result = await query(
    `INSERT INTO canteen_hours 
      (day_of_week, meal_type, open_time, last_order_time, close_time, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (day_of_week, meal_type) DO UPDATE SET
       open_time = EXCLUDED.open_time,
       last_order_time = EXCLUDED.last_order_time,
       close_time = EXCLUDED.close_time,
       is_active = EXCLUDED.is_active
     RETURNING *`,
    [day_of_week, meal_type, open_time, last_order_time, close_time, is_active]
  );
  return result.rows[0];
}

export async function deleteCanteenHour(id: string) {
  const result = await query('DELETE FROM canteen_hours WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    throw new AppError('营业时段不存在', 404);
  }
  return { success: true };
}

export function checkPickupTimeValidation(pickupTimeStr: string): {
  valid: boolean;
  message: string;
  mealType?: MealType;
} {
  const pickupTime = new Date(pickupTimeStr);
  const now = new Date();

  if (pickupTime < now) {
    return { valid: false, message: '取餐时间不能早于当前时间' };
  }

  const dayOfWeek = pickupTime.getDay();
  const hours = pickupTime.getHours();
  const minutes = pickupTime.getMinutes();
  const pickupMinutes = hours * 60 + minutes;

  const breakfastOpen = 6 * 60;
  const breakfastLastOrder = 9 * 60 + 30;
  const breakfastClose = 10 * 60;

  const lunchOpen = 11 * 60;
  const lunchLastOrder = 13 * 60;
  const lunchClose = 14 * 60;

  const dinnerOpen = 17 * 60;
  const dinnerLastOrder = 19 * 60 + 30;
  const dinnerClose = 20 * 60 + 30;

  let mealType: MealType | undefined;

  if (pickupMinutes >= breakfastOpen && pickupMinutes <= breakfastClose) {
    mealType = MealType.BREAKFAST;
    if (pickupMinutes > breakfastLastOrder) {
      return { valid: false, message: '早餐最后点单时间为 09:30，请调整取餐时间' };
    }
  } else if (pickupMinutes >= lunchOpen && pickupMinutes <= lunchClose) {
    mealType = MealType.LUNCH;
    if (pickupMinutes > lunchLastOrder) {
      return { valid: false, message: '午餐最后点单时间为 13:00，请调整取餐时间' };
    }
  } else if (pickupMinutes >= dinnerOpen && pickupMinutes <= dinnerClose) {
    mealType = MealType.DINNER;
    if (pickupMinutes > dinnerLastOrder) {
      return { valid: false, message: '晚餐最后点单时间为 19:30，请调整取餐时间' };
    }
  } else {
    return { 
      valid: false, 
      message: '取餐时间不在营业时段内，营业时间：早餐 06:00-10:00、午餐 11:00-14:00、晚餐 17:00-20:30'
    };
  }

  return { valid: true, message: '取餐时间有效', mealType };
}

export async function validatePickupTimeWithDB(pickupTimeStr: string): Promise<{
  valid: boolean;
  message: string;
  mealType?: MealType;
}> {
  const quickResult = checkPickupTimeValidation(pickupTimeStr);
  if (!quickResult.valid) {
    return quickResult;
  }

  const pickupTime = new Date(pickupTimeStr);
  const dayOfWeek = pickupTime.getDay();
  const hours = pickupTime.getHours();
  const minutes = pickupTime.getMinutes();
  const pickupMinutes = hours * 60 + minutes;

  const dbHours = await getCanteenHoursByDay(dayOfWeek);

  if (dbHours.length === 0) {
    return quickResult;
  }

  for (const hour of dbHours) {
    const openMin = toMinutes(hour.open_time);
    const lastOrderMin = toMinutes(hour.last_order_time);
    const closeMin = toMinutes(hour.close_time);

    if (pickupMinutes >= openMin && pickupMinutes <= closeMin) {
      if (pickupMinutes > lastOrderMin) {
        return { 
          valid: false, 
          message: `${DAY_NAMES[dayOfWeek]} ${hour.meal_type} 最后点单时间为 ${hour.last_order_time}，已截止`
        };
      }
      return { valid: true, message: '取餐时间有效', mealType: hour.meal_type as MealType };
    }
  }

  const mealInfo = dbHours.map((h: any) => 
    `${DAY_NAMES[h.day_of_week]} ${h.meal_type}: ${h.open_time}-${h.close_time}（最后点单 ${h.last_order_time}）`
  ).join('；');

  return { 
    valid: false, 
    message: `取餐时间不在当日营业时段内，今日营业时段：${mealInfo}`
  };
}

function toMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

export function getDefaultHours(): HourInput[] {
  return [
    { day_of_week: 1, meal_type: MealType.BREAKFAST, open_time: '06:00', last_order_time: '09:30', close_time: '10:00' },
    { day_of_week: 1, meal_type: MealType.LUNCH, open_time: '11:00', last_order_time: '13:00', close_time: '14:00' },
    { day_of_week: 1, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 2, meal_type: MealType.BREAKFAST, open_time: '06:00', last_order_time: '09:30', close_time: '10:00' },
    { day_of_week: 2, meal_type: MealType.LUNCH, open_time: '11:00', last_order_time: '13:00', close_time: '14:00' },
    { day_of_week: 2, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 3, meal_type: MealType.BREAKFAST, open_time: '06:00', last_order_time: '09:30', close_time: '10:00' },
    { day_of_week: 3, meal_type: MealType.LUNCH, open_time: '11:00', last_order_time: '13:00', close_time: '14:00' },
    { day_of_week: 3, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 4, meal_type: MealType.BREAKFAST, open_time: '06:00', last_order_time: '09:30', close_time: '10:00' },
    { day_of_week: 4, meal_type: MealType.LUNCH, open_time: '11:00', last_order_time: '13:00', close_time: '14:00' },
    { day_of_week: 4, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 5, meal_type: MealType.BREAKFAST, open_time: '06:00', last_order_time: '09:30', close_time: '10:00' },
    { day_of_week: 5, meal_type: MealType.LUNCH, open_time: '11:00', last_order_time: '13:00', close_time: '14:00' },
    { day_of_week: 5, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 6, meal_type: MealType.BREAKFAST, open_time: '07:00', last_order_time: '10:00', close_time: '10:30' },
    { day_of_week: 6, meal_type: MealType.LUNCH, open_time: '11:30', last_order_time: '13:30', close_time: '14:30' },
    { day_of_week: 6, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
    { day_of_week: 0, meal_type: MealType.BREAKFAST, open_time: '07:00', last_order_time: '10:00', close_time: '10:30' },
    { day_of_week: 0, meal_type: MealType.LUNCH, open_time: '11:30', last_order_time: '13:30', close_time: '14:30' },
    { day_of_week: 0, meal_type: MealType.DINNER, open_time: '17:00', last_order_time: '19:30', close_time: '20:30' },
  ];
}

export async function initDefaultHours() {
  const existing = await getAllCanteenHours();
  if (existing.length > 0) return;
  
  const defaults = getDefaultHours();
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const h of defaults) {
      await client.query(
        `INSERT INTO canteen_hours (day_of_week, meal_type, open_time, last_order_time, close_time, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT DO NOTHING`,
        [h.day_of_week, h.meal_type, h.open_time, h.last_order_time, h.close_time]
      );
    }
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}
