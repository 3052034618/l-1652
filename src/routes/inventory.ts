import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAllIngredients,
  getIngredientById,
  createIngredient,
  inboundIngredient,
  recordWaste,
  getStockRecords,
  checkExpiryStatus,
  checkLowStock,
} from '../services/inventory';
import { validate, ingredientInboundSchema } from '../utils/validators';
import { UserRole, IngredientStatus } from '../types';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response, next) => {
  try {
    const category = req.query.category as string | undefined;
    const status = req.query.status as IngredientStatus | undefined;
    const ingredients = await getAllIngredients(category, status);
    return success(res, ingredients);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response, next) => {
  try {
    const ingredient = await getIngredientById(req.params.id);
    return success(res, ingredient);
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { name, category, unit, safety_stock, supplier_id } = req.body;
    const ingredient = await createIngredient(name, category, unit, safety_stock, supplier_id);
    return success(res, ingredient, '食材创建成功', 201);
  } catch (error) {
    next(error);
  }
});

router.post('/inbound', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const data = validate(ingredientInboundSchema, req.body);
    const result = await inboundIngredient(req.user!.userId, data);
    return success(res, result, '入库成功');
  } catch (error) {
    next(error);
  }
});

router.post('/waste', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { ingredient_id, quantity, remark } = req.body;
    const result = await recordWaste(ingredient_id, quantity, remark);
    return success(res, result, '损耗记录已保存');
  } catch (error) {
    next(error);
  }
});

router.get('/:id/records', authenticate, async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const records = await getStockRecords(req.params.id, limit);
    return success(res, records);
  } catch (error) {
    next(error);
  }
});

router.post('/check-expiry', authenticate, requireRoles(UserRole.ADMIN), async (_req: Request, res: Response, next) => {
  try {
    const result = await checkExpiryStatus();
    return success(res, result, '保质期检查完成');
  } catch (error) {
    next(error);
  }
});

router.post('/check-stock', authenticate, requireRoles(UserRole.ADMIN), async (_req: Request, res: Response, next) => {
  try {
    const result = await checkLowStock();
    return success(res, result, '库存检查完成');
  } catch (error) {
    next(error);
  }
});

export default router;
