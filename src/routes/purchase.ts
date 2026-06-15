import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAllPurchaseRequests,
  getPurchaseById,
  approvePurchaseRequest,
  confirmDelivery,
  createPurchaseRequest,
  getSupplierPurchases,
  supplierAcceptOrder,
  supplierRejectOrder,
  startShipping,
} from '../services/purchase';
import { validate, approvePurchaseSchema } from '../utils/validators';
import { UserRole, PurchaseStatus } from '../types';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as PurchaseStatus | undefined;
    const userId = req.user!.userId;
    const role = req.user!.role as UserRole;

    let purchases: any[];
    if (role === UserRole.SUPPLIER) {
      purchases = await getSupplierPurchases(userId, status);
    } else {
      purchases = await getAllPurchaseRequests(status);
    }
    return success(res, purchases);
  } catch (error) {
    next(error);
  }
});

router.get('/status-flow', authenticate, (_req: Request, res: Response) => {
  const flow: Record<string, { label: string; next: string[] }> = {
    pending: { label: '待审批', next: ['approved', 'rejected'] },
    approved: { label: '已批准待下单', next: ['ordered'] },
    ordered: { label: '已下单给供应商', next: ['supplier_accepted', 'supplier_rejected'] },
    supplier_accepted: { label: '供应商已接单', next: ['shipping'] },
    supplier_rejected: { label: '供应商已拒绝', next: [] },
    shipping: { label: '配送中', next: ['delivered'] },
    delivered: { label: '已送达', next: [] },
    rejected: { label: '已拒绝', next: [] },
  };
  return success(res, flow);
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
    const result = await confirmDelivery(req.params.id, req.user!.userId);
    return success(res, result, '已确认收货入库');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/supplier-accept', authenticate, requireRoles(UserRole.SUPPLIER), async (req: Request, res: Response, next) => {
  try {
    const { expected_delivery_time, remark } = req.body;
    const result = await supplierAcceptOrder(
      req.params.id,
      req.user!.userId,
      expected_delivery_time,
      remark
    );
    return success(res, result, '已确认接单');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/supplier-reject', authenticate, requireRoles(UserRole.SUPPLIER), async (req: Request, res: Response, next) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return success(res, null, '请填写拒绝原因', 400);
    }
    const result = await supplierRejectOrder(req.params.id, req.user!.userId, reason);
    return success(res, result, '已拒绝订单');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/ship', authenticate, requireRoles(UserRole.SUPPLIER), async (req: Request, res: Response, next) => {
  try {
    const { tracking_no, expected_delivery_time } = req.body;
    const result = await startShipping(
      req.params.id,
      req.user!.userId,
      tracking_no,
      expected_delivery_time
    );
    return success(res, result, '已发货');
  } catch (error) {
    next(error);
  }
});

export default router;
