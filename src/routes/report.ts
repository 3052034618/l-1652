import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getOperationsReports,
  getOperationsReportByMonth,
  generateMonthlyOperationsReport,
  exportOperationsReport,
} from '../services/report';
import { UserRole } from '../types';

const router = Router();

router.get('/', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 12;
    const reports = await getOperationsReports(limit);
    return success(res, reports);
  } catch (error) {
    next(error);
  }
});

router.get('/:month', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const report = await getOperationsReportByMonth(req.params.month);
    return success(res, report);
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const month = req.body.month;
    const report = await generateMonthlyOperationsReport(month);
    return success(res, report, '运营报表已生成');
  } catch (error) {
    next(error);
  }
});

router.get('/:month/export', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const csv = await exportOperationsReport(req.params.month);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="operations-report-${req.params.month}.csv"`);
    return res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
});

export default router;
