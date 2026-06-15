import { query, getClient } from '../database/pool';
import { AppError } from '../utils/response';

export async function getStudentAccount(studentId: string) {
  const result = await query(
    'SELECT * FROM student_accounts WHERE student_id = $1',
    [studentId]
  );
  if (result.rows.length === 0) {
    throw new AppError('学生账户不存在', 404);
  }
  return result.rows[0];
}

export async function rechargeAccount(studentId: string, amount: number, description: string = '账户充值') {
  if (amount <= 0) {
    throw new AppError('充值金额必须为正数', 400);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const accountResult = await client.query(
      'SELECT * FROM student_accounts WHERE student_id = $1 FOR UPDATE',
      [studentId]
    );
    if (accountResult.rows.length === 0) {
      throw new AppError('学生账户不存在', 404);
    }

    const account = accountResult.rows[0];
    const newBalance = parseFloat(account.balance) + amount;

    await client.query(
      'UPDATE student_accounts SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2',
      [newBalance, studentId]
    );

    await client.query(
      `INSERT INTO account_transactions (student_id, amount, type, balance_after, description)
       VALUES ($1, $2, 'recharge', $3, $4)`,
      [studentId, amount, newBalance, description]
    );

    await client.query('COMMIT');

    return {
      studentId,
      amount,
      newBalance,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deductBalance(
  client: any,
  studentId: string,
  amount: number,
  orderId: string,
  description: string = '订单扣款'
) {
  const accountResult = await client.query(
    'SELECT * FROM student_accounts WHERE student_id = $1 FOR UPDATE',
    [studentId]
  );
  if (accountResult.rows.length === 0) {
    throw new AppError('学生账户不存在', 404);
  }

  const account = accountResult.rows[0];
  if (parseFloat(account.balance) < amount) {
    throw new AppError('账户余额不足', 400);
  }

  const newBalance = parseFloat(account.balance) - amount;

  await client.query(
    'UPDATE student_accounts SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2',
    [newBalance, studentId]
  );

  await client.query(
    `INSERT INTO account_transactions (student_id, order_id, amount, type, balance_after, description)
     VALUES ($1, $2, $3, 'deduction', $4, $5)`,
    [studentId, orderId, amount, newBalance, description]
  );

  return newBalance;
}

export async function getTransactionHistory(studentId: string, limit: number = 50) {
  const result = await query(
    `SELECT * FROM account_transactions 
     WHERE student_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [studentId, limit]
  );
  return result.rows;
}

export async function getStudentBalance(studentId: string) {
  const account = await getStudentAccount(studentId);
  return parseFloat(account.balance);
}
