import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getStudentNutritionReports,
  getNutritionReportByDate,
  generateDailyNutritionReports,
  generateStudentNutritionReport,
} from '../services/nutrition';
import { UserRole } from '../types';

const router = Router();

router.get('/my', authenticate, requireRoles(UserRole.STUDENT, UserRole.PARENT), async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 30;
    let studentId = req.user!.userId;
    
    if (req.user!.role === UserRole.PARENT && req.query.student_id) {
      studentId = req.query.student_id as string;
    }
    
    const reports = await getStudentNutritionReports(studentId, limit);
    return success(res, reports);
  } catch (error) {
    next(error);
  }
});

router.get('/:student_id/:date', authenticate, async (req: Request, res: Response, next) => {
  try {
    const report = await getNutritionReportByDate(req.params.student_id, req.params.date);
    return success(res, report);
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const date = req.body.date;
    const result = await generateDailyNutritionReports(date);
    return success(res, result, '营养报告已生成');
  } catch (error) {
    next(error);
  }
});

router.post('/generate/:student_id', authenticate, requireRoles(UserRole.ADMIN, UserRole.PARENT), async (req: Request, res: Response, next) => {
  try {
    const date = req.body.date;
    const report = await generateStudentNutritionReport(req.params.student_id, date);
    return success(res, report, '学生营养报告已生成');
  } catch (error) {
    next(error);
  }
});

export default router;
