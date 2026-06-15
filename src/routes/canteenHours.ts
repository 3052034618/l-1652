import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAllCanteenHours,
  getCanteenHoursByDay,
  upsertCanteenHour,
  deleteCanteenHour,
  checkPickupTimeValidation,
  validatePickupTimeWithDB,
  initDefaultHours,
} from '../services/canteenHours';
import { UserRole } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response, next) => {
  try {
    const activeOnly = req.query.active === 'true';
    const hours = await getAllCanteenHours(activeOnly);
    return success(res, hours);
  } catch (error) {
    next(error);
  }
});

router.get('/today', async (req: Request, res: Response, next) => {
  try {
    const dayOfWeek = req.query.day !== undefined ? parseInt(req.query.day as string, 10) : undefined;
    const hours = await getCanteenHoursByDay(dayOfWeek);
    return success(res, hours);
  } catch (error) {
    next(error);
  }
});

router.get('/validate', async (req: Request, res: Response, next) => {
  try {
    const pickupTime = req.query.time as string;
    if (!pickupTime) {
      return success(res, { valid: false, message: '请提供取餐时间参数' });
    }
    const result = await validatePickupTimeWithDB(pickupTime);
    return success(res, result);
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const result = await upsertCanteenHour(req.body);
    return success(res, result, '营业时段已更新', 201);
  } catch (error) {
    next(error);
  }
});

router.post('/init-default', authenticate, requireRoles(UserRole.ADMIN), async (_req: Request, res: Response, next) => {
  try {
    await initDefaultHours();
    const hours = await getAllCanteenHours();
    return success(res, hours, '默认营业时段已初始化');
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const result = await deleteCanteenHour(req.params.id);
    return success(res, result, '营业时段已删除');
  } catch (error) {
    next(error);
  }
});

export default router;
