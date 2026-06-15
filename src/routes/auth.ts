import { Router, Request, Response } from 'express';
import { success, fail } from '../utils/response';
import { login, register, getUserById } from '../services/auth';
import { authenticate } from '../middleware/auth';
import { validate, loginSchema, registerSchema } from '../utils/validators';
import { UserRole } from '../types';

const router = Router();

router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const data = validate(registerSchema, req.body);
    const result = await register(
      data.username,
      data.password,
      data.name,
      data.role as UserRole,
      data.phone,
      data.email,
      req.body.extra
    );
    return success(res, result, '注册成功', 201);
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const data = validate(loginSchema, req.body);
    const result = await login(data.username, data.password);
    return success(res, result, '登录成功');
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, async (req: Request, res: Response, next) => {
  try {
    if (!req.user) {
      return fail(res, '未登录', 401);
    }
    const user = await getUserById(req.user.userId);
    return success(res, { user, auth: req.user });
  } catch (error) {
    next(error);
  }
});

export default router;
