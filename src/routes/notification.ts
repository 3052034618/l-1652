import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate } from '../middleware/auth';
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '../services/notification';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const notifications = await getUserNotifications(req.user!.userId, limit);
    return success(res, notifications);
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', authenticate, async (req: Request, res: Response, next) => {
  try {
    const count = await getUnreadCount(req.user!.userId);
    return success(res, { count });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/read', authenticate, async (req: Request, res: Response, next) => {
  try {
    await markAsRead(req.user!.userId, req.params.id);
    return success(res, null, '已标记为已读');
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', authenticate, async (req: Request, res: Response, next) => {
  try {
    await markAllAsRead(req.user!.userId);
    return success(res, null, '已全部标记为已读');
  } catch (error) {
    next(error);
  }
});

export default router;
