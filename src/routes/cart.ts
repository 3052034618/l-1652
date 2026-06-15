import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  batchUpdateCart,
  checkoutFromCart,
  submitOrderFromCart,
} from '../services/cart';
import { UserRole } from '../types';

const router = Router();

router.get('/', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const cart = await getCart(req.user!.userId);
    return success(res, cart);
  } catch (error) {
    next(error);
  }
});

router.post('/add', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const { dish_id, quantity = 1 } = req.body;
    const result = await addToCart(req.user!.userId, dish_id, parseInt(quantity, 10) || 1);
    return success(res, result, '已加入购物车', 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:itemId', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const { quantity } = req.body;
    const result = await updateCartItem(req.user!.userId, req.params.itemId, parseInt(quantity, 10) || 0);
    return success(res, result, '购物车已更新');
  } catch (error) {
    next(error);
  }
});

router.delete('/:itemId', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const result = await removeFromCart(req.user!.userId, req.params.itemId);
    return success(res, result, '已从购物车移除');
  } catch (error) {
    next(error);
  }
});

router.delete('/', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const result = await clearCart(req.user!.userId);
    return success(res, result, '购物车已清空');
  } catch (error) {
    next(error);
  }
});

router.put('/batch', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const { updates } = req.body;
    const result = await batchUpdateCart(req.user!.userId, updates || []);
    return success(res, result, '购物车已批量更新');
  } catch (error) {
    next(error);
  }
});

router.get('/checkout', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const pickupScheduledTime = req.query.pickup_scheduled_time as string | undefined;
    const result = await checkoutFromCart(req.user!.userId, pickupScheduledTime);
    return success(res, result);
  } catch (error) {
    next(error);
  }
});

router.post('/checkout', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const { pickup_scheduled_time } = req.body;
    const result = await submitOrderFromCart(req.user!.userId, pickup_scheduled_time);
    return success(res, result, '下单成功，购物车已清空', 201);
  } catch (error) {
    next(error);
  }
});

export default router;
