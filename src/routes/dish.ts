import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAllDishes,
  getDishById,
  createDish,
  updateDish,
  CreateDishInput,
} from '../services/dish';
import { UserRole, DishType } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response, next) => {
  try {
    const availableOnly = req.query.available === 'true';
    const dishes = await getAllDishes(availableOnly);
    return success(res, dishes);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const dish = await getDishById(req.params.id);
    return success(res, dish);
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const dish = await createDish(req.body as CreateDishInput);
    return success(res, dish, '餐品创建成功', 201);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const dish = await updateDish(req.params.id, req.body);
    return success(res, dish, '餐品更新成功');
  } catch (error) {
    next(error);
  }
});

export default router;
