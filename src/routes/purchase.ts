import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAllPurchaseRequests,
  getPurchaseById,
  approvePurchaseRequest,
  confirmDelivery,
  createPurchaseRequest,
} from '../services/purchase';
import { validate, approvePurchaseSchema } from '../utils/validators';
import { UserRole, PurchaseStatus } from '../types';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as PurchaseStatus | undefined;
    const purchases = await getAllPurchaseRequests(status);
    return success(res, purchases);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response, next) => {
  try {
    const purchase = await getPurchaseById(req.params.id);
    return success(res, purchase);
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { ingredient_id, quantity, supplier_id, estimated_price, remark } = req.body;
    const purchase = await createPurchaseRequest(
      ingredient_id,
      quantity,
      req.user!.userId,
      supplier_id,
      estimated_price,
      remark
    );
    return success(res, purchase, '采购申请已创建', 201);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/approve', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const data = validate(approvePurchaseSchema, req.body);
    const result = await approvePurchaseRequest(
      req.params.id,
      req.user!.userId,
      data.approved,
      data.remark
    );
    return success(res, result, data.approved ? '采购已批准' : '采购已拒绝');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/deliver', authenticate, requireRoles(UserRole.ADMIN, UserRole.SUPPLIER), async (req: Request, res: Response, next) => {
  try {
    const result = await confirmDelivery(req.params.id);
    return success(res, result, '已确认收货入库');
  } catch (error) {
    next(error);
  }
});

export default router;
