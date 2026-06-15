import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, fail } from '../utils/response';

export function errorHandler(
  error: Error | AppError | ZodError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('Error:', error);

  if (error instanceof ZodError) {
    const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    return fail(res, `数据验证失败: ${messages}`, 400);
  }

  if (error instanceof AppError) {
    return fail(res, error.message, error.statusCode);
  }

  return fail(res, '服务器内部错误', 500);
}

export function notFoundHandler(req: Request, res: Response, _next: NextFunction) {
  return fail(res, `找不到路径: ${req.method} ${req.originalUrl}`, 404);
}
