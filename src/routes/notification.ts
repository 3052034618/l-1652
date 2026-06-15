import { Router, Request, Response } from 'express';
import { success } from '../utils/response';
import { authenticate } from '../middleware/auth';
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNotificationTypes,
  NotificationQueryParams,
} from '../services/notification';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response, next) => {
  try {
    const params: NotificationQueryParams = {};

    if (req.query.read !== undefined) {
      params.read = req.query.read === 'true';
    }
    if (req.query.unread !== undefined) {
      params.read = !(req.query.unread === 'true');
    }
    if (req.query.type !== undefined) {
      const typeStr = req.query.type as string;
      params.type = typeStr.includes(',') ? typeStr.split(',').map(t => t.trim()) : typeStr;
    }
    if (req.query.from_date !== undefined) {
      params.fromDate = req.query.from_date as string;
    }
    if (req.query.to_date !== undefined) {
      params.toDate = req.query.to_date as string;
    }
    if (req.query.limit !== undefined) {
      params.limit = parseInt(req.query.limit as string, 10) || 50;
    }
    if (req.query.offset !== undefined) {
      params.offset = parseInt(req.query.offset as string, 10) || 0;
    }

    const result = await getUserNotifications(req.user!.userId, params);
    return success(res, {
      role: req.user!.role,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/types', authenticate, async (req: Request, res: Response, next) => {
  try {
    const types = await getNotificationTypes(req.user!.userId);
    return success(res, types);
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
