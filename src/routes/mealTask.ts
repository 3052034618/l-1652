import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getChefTasks,
  getAllTasks,
  updateTaskStatus,
  reassignTask,
  createChefSchedule,
  getChefSchedules,
} from '../services/mealTask';
import { UserRole, MealTaskStatus } from '../types';

const router = Router();

router.get('/my', authenticate, requireRoles(UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as MealTaskStatus | undefined;
    const tasks = await getChefTasks(req.user!.userId, status);
    return success(res, tasks);
  } catch (error) {
    next(error);
  }
});

router.get('/', authenticate, requireRoles(UserRole.ADMIN, UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as MealTaskStatus | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const tasks = await getAllTasks(status, limit);
    return success(res, tasks);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authenticate, requireRoles(UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const { status } = req.body;
    const task = await updateTaskStatus(req.params.id, req.user!.userId, status as MealTaskStatus);
    return success(res, task, '任务状态已更新');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reassign', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { chef_id } = req.body;
    const task = await reassignTask(req.params.id, chef_id);
    return success(res, task, '任务已重新分配');
  } catch (error) {
    next(error);
  }
});

router.post('/schedules', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { chef_id, date, shift_start, shift_end } = req.body;
    const schedule = await createChefSchedule(chef_id, date, shift_start, shift_end);
    return success(res, schedule, '排班已创建', 201);
  } catch (error) {
    next(error);
  }
});

router.get('/schedules', authenticate, async (req: Request, res: Response, next) => {
  try {
    const date = req.query.date as string | undefined;
    const schedules = await getChefSchedules(date);
    return success(res, schedules);
  } catch (error) {
    next(error);
  }
});

export default router;
