import { query } from '../database/pool';
import { DishType, ChefSkill, MealTaskStatus } from '../types';
import { AppError } from '../utils/response';
import { broadcastTaskUpdate } from './socket';
import { notifyMealTask } from './notification';

const dishTypeToSkills: Record<DishType, ChefSkill[]> = {
  [DishType.RICE]: [ChefSkill.CHINESE_CUISINE, ChefSkill.STIR_FRY],
  [DishType.NOODLE]: [ChefSkill.NOODLE_MAKING, ChefSkill.CHINESE_CUISINE],
  [DishType.SOUP]: [ChefSkill.SOUP_MAKING, ChefSkill.CHINESE_CUISINE],
  [DishType.STIR_FRY]: [ChefSkill.STIR_FRY, ChefSkill.CHINESE_CUISINE],
  [DishType.STEAMED]: [ChefSkill.STEAMING, ChefSkill.CHINESE_CUISINE],
  [DishType.DESSERT]: [ChefSkill.PASTRY, ChefSkill.WESTERN_CUISINE],
  [DishType.DRINK]: [ChefSkill.WESTERN_CUISINE, ChefSkill.PASTRY],
};

async function getAvailableChefs(client: any): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

  const result = await client.query(
    `SELECT 
      u.id as user_id,
      u.name as chef_name,
      ci.skills,
      ci.station,
      cs.shift_start,
      cs.shift_end
    FROM chef_schedules cs
    JOIN users u ON cs.chef_id = u.id
    JOIN chef_info ci ON u.id = ci.user_id
    WHERE cs.date = $1 
      AND cs.is_on_duty = true
      AND cs.shift_start <= $2::time
      AND cs.shift_end >= $2::time`,
    [today, currentTime]
  );

  return result.rows;
}

async function getChefTaskLoad(client: any, chefId: string): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM meal_tasks 
     WHERE chef_id = $1 AND status IN ('assigned', 'in_progress')`,
    [chefId]
  );
  return parseInt(result.rows[0].count, 10);
}

function findMatchingChefs(chefs: any[], dishType: DishType): any[] {
  const requiredSkills = dishTypeToSkills[dishType] || [ChefSkill.CHINESE_CUISINE];
  return chefs.filter(chef => 
    chef.skills && chef.skills.some((s: string) => requiredSkills.includes(s as ChefSkill))
  );
}

async function selectBestChef(client: any, chefs: any[], dishType: DishType): Promise<string | null> {
  const matchingChefs = findMatchingChefs(chefs, dishType);
  
  if (matchingChefs.length === 0 && chefs.length > 0) {
    const allWithLoad = await Promise.all(
      chefs.map(async (chef) => ({
        ...chef,
        load: await getChefTaskLoad(client, chef.user_id),
      }))
    );
    allWithLoad.sort((a, b) => a.load - b.load);
    return allWithLoad[0].user_id;
  }

  const chefsWithLoad = await Promise.all(
    matchingChefs.map(async (chef) => ({
      ...chef,
      load: await getChefTaskLoad(client, chef.user_id),
    }))
  );

  chefsWithLoad.sort((a, b) => a.load - b.load);

  return chefsWithLoad.length > 0 ? chefsWithLoad[0].user_id : null;
}

export async function createAndAssignMealTasks(
  client: any,
  orderId: string,
  orderItems: any[]
): Promise<any[]> {
  const chefs = await getAvailableChefs(client);
  const tasks: any[] = [];

  for (const item of orderItems) {
    const dishResult = await client.query(
      'SELECT * FROM dishes WHERE id = $1',
      [item.dish_id]
    );
    const dish = dishResult.rows[0];

    const chefId = await selectBestChef(client, chefs, dish.type);

    const taskResult = await client.query(
      `INSERT INTO meal_tasks 
        (order_id, order_item_id, dish_id, chef_id, status, quantity, assigned_at)
       VALUES ($1, $2, $3, $4, 'assigned', $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [orderId, item.id, item.dish_id, chefId, item.quantity]
    );

    const task = taskResult.rows[0];
    tasks.push(task);

    if (chefId) {
      const chefIndex = chefs.findIndex(c => c.user_id === chefId);
      if (chefIndex >= 0) {
        chefs[chefIndex] = {
          ...chefs[chefIndex],
          _load: (chefs[chefIndex]._load || 0) + 1,
        };
      }
    }
  }

  for (const task of tasks) {
    if (task.chef_id) {
      const dishResult = await client.query(
        'SELECT name FROM dishes WHERE id = $1',
        [task.dish_id]
      );
      const dishName = dishResult.rows[0]?.name || '餐品';
      await notifyMealTask(task.chef_id, task.id, dishName, task.quantity);
    }
  }

  return tasks;
}

export async function getChefTasks(chefId: string, status?: MealTaskStatus) {
  let sql = `SELECT mt.*, d.name as dish_name, d.image_url as dish_image, 
             o.student_id, o.pickup_window_start, o.pickup_window_end
             FROM meal_tasks mt
             JOIN dishes d ON mt.dish_id = d.id
             JOIN orders o ON mt.order_id = o.id
             WHERE mt.chef_id = $1`;
  const params: any[] = [chefId];
  let idx = 2;

  if (status) {
    sql += ` AND mt.status = $${idx}`;
    params.push(status);
    idx++;
  }

  sql += ' ORDER BY mt.created_at ASC';

  const result = await query(sql, params);
  return result.rows;
}

export async function getAllTasks(status?: MealTaskStatus, limit: number = 100) {
  let sql = `SELECT mt.*, d.name as dish_name, u.name as chef_name
             FROM meal_tasks mt
             JOIN dishes d ON mt.dish_id = d.id
             LEFT JOIN users u ON mt.chef_id = u.id
             WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;

  if (status) {
    sql += ` AND mt.status = $${idx}`;
    params.push(status);
    idx++;
  }

  sql += ` ORDER BY mt.created_at DESC LIMIT $${idx}`;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

export async function updateTaskStatus(taskId: string, chefId: string, newStatus: MealTaskStatus) {
  const client = await (await import('../database/pool')).getClient();
  try {
    await client.query('BEGIN');

    const taskResult = await client.query(
      'SELECT * FROM meal_tasks WHERE id = $1 AND chef_id = $2',
      [taskId, chefId]
    );
    if (taskResult.rows.length === 0) {
      throw new AppError('任务不存在或不属于您', 404);
    }

    let updateSql = 'UPDATE meal_tasks SET status = $1';
    const params: any[] = [newStatus];

    if (newStatus === MealTaskStatus.IN_PROGRESS) {
      updateSql += ', started_at = CURRENT_TIMESTAMP';
    } else if (newStatus === MealTaskStatus.COMPLETED) {
      updateSql += ', completed_at = CURRENT_TIMESTAMP';
    }

    updateSql += ' WHERE id = $' + (params.length + 1) + ' RETURNING *';
    params.push(taskId);

    const result = await client.query(updateSql, params);
    const updatedTask = result.rows[0];

    await client.query('COMMIT');

    broadcastTaskUpdate(updatedTask);

    return updatedTask;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reassignTask(taskId: string, newChefId: string) {
  const result = await query(
    `UPDATE meal_tasks 
     SET chef_id = $1, assigned_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [newChefId, taskId]
  );

  if (result.rows.length === 0) {
    throw new AppError('任务不存在', 404);
  }

  const task = result.rows[0];
  broadcastTaskUpdate(task);

  const dishResult = await query(
    'SELECT name FROM dishes WHERE id = $1',
    [task.dish_id]
  );
  await notifyMealTask(newChefId, task.id, dishResult.rows[0]?.name || '餐品', task.quantity);

  return task;
}

export async function createChefSchedule(chefId: string, date: string, shiftStart: string, shiftEnd: string) {
  const result = await query(
    `INSERT INTO chef_schedules (chef_id, date, shift_start, shift_end, is_on_duty)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (chef_id, date) DO UPDATE SET
       shift_start = EXCLUDED.shift_start,
       shift_end = EXCLUDED.shift_end,
       is_on_duty = true
     RETURNING *`,
    [chefId, date, shiftStart, shiftEnd]
  );
  return result.rows[0];
}

export async function getChefSchedules(date?: string) {
  let sql = `SELECT cs.*, u.name as chef_name 
             FROM chef_schedules cs 
             JOIN users u ON cs.chef_id = u.id`;
  const params: any[] = [];

  if (date) {
    sql += ' WHERE cs.date = $1';
    params.push(date);
  }

  sql += ' ORDER BY cs.date, cs.shift_start';

  const result = await query(sql, params);
  return result.rows;
}
