import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  createOrder,
  getOrderById,
  getStudentOrders,
  getAllOrders,
  updateOrderStatus,
  markOrderReady,
} from '../services/order';
import { validate, createOrderSchema } from '../utils/validators';
import { OrderStatus, UserRole } from '../types';

const router = Router();

router.post('/', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const data = validate(createOrderSchema, req.body);
    const { pickup_scheduled_time, clear_cart } = req.body;
    const result = await createOrder(req.user!.userId, data.items, {
      pickup_scheduled_time,
      clear_cart: clear_cart === true || clear_cart === 'true',
    });
    return success(res, result, '下单成功', 201);
  } catch (error) {
    next(error);
  }
});

router.get('/my', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const orders = await getStudentOrders(req.user!.userId, limit);
    return success(res, orders);
  } catch (error) {
    next(error);
  }
});

router.get('/', authenticate, requireRoles(UserRole.ADMIN, UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as OrderStatus | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const orders = await getAllOrders(status, limit);
    return success(res, orders);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response, next) => {
  try {
    const order = await getOrderById(req.params.id);
    
    if (req.user!.role === UserRole.STUDENT && order.student_id !== req.user!.userId) {
      return success(res, null, '无权查看该订单', 403);
    }
    
    return success(res, order);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authenticate, requireRoles(UserRole.ADMIN, UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const { status } = req.body;
    const order = await updateOrderStatus(req.params.id, status as OrderStatus, req.user!.userId);
    return success(res, order, '订单状态已更新');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/ready', authenticate, requireRoles(UserRole.ADMIN, UserRole.CHEF), async (req: Request, res: Response, next) => {
  try {
    const order = await markOrderReady(req.params.id);
    return success(res, order, '订单已标记为待取餐');
  } catch (error) {
    next(error);
  }
});

export default router;
