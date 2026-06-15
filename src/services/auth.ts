import { query } from '../database/pool';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { AppError } from '../utils/response';
import { UserRole, User } from '../types';

export async function register(
  username: string,
  password: string,
  name: string,
  role: UserRole,
  phone?: string,
  email?: string,
  extra?: Record<string, any>
) {
  const existing = await query(
    'SELECT id FROM users WHERE username = $1',
    [username]
  );
  if (existing.rows.length > 0) {
    throw new AppError('用户名已存在', 400);
  }

  const passwordHash = await hashPassword(password);

  const result = await query(
    `INSERT INTO users (username, password_hash, name, role, phone, email)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, name, role, phone, email, created_at`,
    [username, passwordHash, name, role, phone || null, email || null]
  );

  const user = result.rows[0];

  if (role === UserRole.STUDENT && extra) {
    await query(
      `INSERT INTO student_accounts (student_id, balance, parent_id, grade, student_no)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, extra.initialBalance || 0, extra.parentId || null, extra.grade, extra.studentNo]
    );
  } else if (role === UserRole.CHEF && extra) {
    await query(
      `INSERT INTO chef_info (user_id, skills, station)
       VALUES ($1, $2, $3)`,
      [user.id, extra.skills || [], extra.station || null]
    );
  } else if (role === UserRole.SUPPLIER && extra) {
    await query(
      `INSERT INTO supplier_info (user_id, company_name, contact_person, address)
       VALUES ($1, $2, $3, $4)`,
      [user.id, extra.companyName, extra.contactPerson || null, extra.address || null]
    );
  }

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return { user, token };
}

export async function login(username: string, password: string) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );

  if (result.rows.length === 0) {
    throw new AppError('用户名或密码错误', 401);
  }

  const user = result.rows[0];
  const valid = await comparePassword(password, user.password_hash);

  if (!valid) {
    throw new AppError('用户名或密码错误', 401);
  }

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const { password_hash: _, ...userWithoutPassword } = user;

  let profile = null;
  if (user.role === UserRole.STUDENT) {
    const accountRes = await query(
      'SELECT * FROM student_accounts WHERE student_id = $1',
      [user.id]
    );
    profile = accountRes.rows[0] || null;
  } else if (user.role === UserRole.CHEF) {
    const chefRes = await query(
      'SELECT * FROM chef_info WHERE user_id = $1',
      [user.id]
    );
    profile = chefRes.rows[0] || null;
  } else if (user.role === UserRole.SUPPLIER) {
    const supplierRes = await query(
      'SELECT * FROM supplier_info WHERE user_id = $1',
      [user.id]
    );
    profile = supplierRes.rows[0] || null;
  }

  return { user: userWithoutPassword, profile, token };
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await query(
    'SELECT id, username, name, role, phone, email, created_at FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

export async function getUsersByRole(role: UserRole) {
  const result = await query(
    'SELECT id, username, name, role, phone, email, created_at FROM users WHERE role = $1',
    [role]
  );
  return result.rows;
}

export async function getAllAdmins() {
  return getUsersByRole(UserRole.ADMIN);
}
