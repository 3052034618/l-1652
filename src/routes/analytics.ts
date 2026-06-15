import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getRevenueTrend,
  getOrderTrend,
  getHotDishesRanking,
  getDishCategoryDistribution,
  getTimeSlotDistribution,
  getPeriodComparison,
} from '../services/analytics';
import { UserRole } from '../types';

const router = Router();

router.get('/revenue-trend', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { start_date, end_date, group_by } = req.query;
    const startDate = start_date as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date as string || new Date().toISOString().split('T')[0];
    const groupBy = (group_by as 'day' | 'week' | 'month') || 'day';

    const data = await getRevenueTrend(startDate, endDate, groupBy);
    return success(res, { ...data, query_params: { start_date: startDate, end_date: endDate, group_by: groupBy } });
  } catch (error) {
    next(error);
  }
});

router.get('/order-trend', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { start_date, end_date } = req.query;
    const startDate = start_date as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date as string || new Date().toISOString().split('T')[0];

    const data = await getOrderTrend(startDate, endDate);
    return success(res, data);
  } catch (error) {
    next(error);
  }
});

router.get('/hot-dishes', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { start_date, end_date, limit, category } = req.query;
    const startDate = start_date as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date as string || new Date().toISOString().split('T')[0];
    const limitNum = parseInt(limit as string, 10) || 10;
    const categoryVal = category as string | undefined;

    const dishes = await getHotDishesRanking(startDate, endDate, limitNum, categoryVal);
    const chartData = {
      labels: dishes.map(d => d.dish_name),
      values: dishes.map(d => d.count),
      revenues: dishes.map(d => d.revenue),
    };
    return success(res, { list: dishes, chart_data: chartData });
  } catch (error) {
    next(error);
  }
});

router.get('/category-distribution', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { start_date, end_date } = req.query;
    const startDate = start_date as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date as string || new Date().toISOString().split('T')[0];

    const data = await getDishCategoryDistribution(startDate, endDate);
    return success(res, data);
  } catch (error) {
    next(error);
  }
});

router.get('/timeslot', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const data = await getTimeSlotDistribution(date);
    return success(res, { date, ...data });
  } catch (error) {
    next(error);
  }
});

router.get('/comparison', authenticate, requireRoles(UserRole.ADMIN), async (req: Request, res: Response, next) => {
  try {
    const { current_start, current_end, previous_start, previous_end } = req.query;

    const now = new Date();
    const currentEnd = (current_end as string) || now.toISOString().split('T')[0];
    const currentStart = (current_start as string) || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const prevStartObj = new Date(currentStart);
    prevStartObj.setDate(prevStartObj.getDate() - 7);
    const prevEndObj = new Date(currentEnd);
    prevEndObj.setDate(prevEndObj.getDate() - 7);
    const previousStart = (previous_start as string) || prevStartObj.toISOString().split('T')[0];
    const previousEnd = (previous_end as string) || prevEndObj.toISOString().split('T')[0];

    const data = await getPeriodComparison(currentStart, currentEnd, previousStart, previousEnd);
    return success(res, {
      ...data,
      periods: {
        current: { start: currentStart, end: currentEnd },
        previous: { start: previousStart, end: previousEnd },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
