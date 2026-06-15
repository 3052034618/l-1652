import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

export const registerSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符').max(50),
  password: z.string().min(6, '密码至少6个字符'),
  name: z.string().min(1, '姓名不能为空'),
  role: z.enum(['student', 'chef', 'admin', 'parent', 'supplier']),
  phone: z.string().optional(),
  email: z.string().email('邮箱格式不正确').optional(),
});

export const orderItemSchema = z.object({
  dish_id: z.string().uuid('无效的餐品ID'),
  quantity: z.number().int().min(1, '数量至少为1'),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, '至少选择一个餐品'),
});

export const ingredientInboundSchema = z.object({
  ingredient_id: z.string().uuid('无效的食材ID'),
  quantity: z.number().positive('数量必须为正数'),
  expiry_date: z.string().optional(),
  batch_no: z.string().optional(),
  remark: z.string().optional(),
});

export const approvePurchaseSchema = z.object({
  approved: z.boolean(),
  remark: z.string().optional(),
});

export function validate<T>(schema: z.ZodSchema<T>, data: any): T {
  return schema.parse(data);
}
