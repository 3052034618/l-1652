import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getStudentAccount,
  rechargeAccount,
  getTransactionHistory,
  getStudentBalance,
} from '../services/account';
import { UserRole } from '../types';

const router = Router();

router.get('/balance', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const balance = await getStudentBalance(req.user!.userId);
    return success(res, { balance });
  } catch (error) {
    next(error);
  }
});

router.get('/account', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const account = await getStudentAccount(req.user!.userId);
    return success(res, account);
  } catch (error) {
    next(error);
  }
});

router.post('/recharge', authenticate, requireRoles(UserRole.STUDENT, UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { amount, student_id } = req.body;
    const targetStudentId = req.user!.role === UserRole.ADMIN ? student_id : req.user!.userId;
    const result = await rechargeAccount(targetStudentId, parseFloat(amount));
    return success(res, result, '充值成功');
  } catch (error) {
    next(error);
  }
});

router.get('/transactions', authenticate, requireRoles(UserRole.STUDENT), async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await getTransactionHistory(req.user!.userId, limit);
    return success(res, history);
  } catch (error) {
    next(error);
  }
});

export default router;
