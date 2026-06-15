import { pool } from './pool';
import { hashPassword } from '../utils/auth';
import { UserRole, DishType, ChefSkill } from '../types';

async function seed() {
  const client = await pool.connect();
  try {
    console.log('开始填充测试数据...');
    
    await client.query('BEGIN');

    const adminPass = await hashPassword('admin123');
    await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone, email)
       VALUES ('admin', $1, '系统管理员', 'admin', '13800000000', 'admin@school.edu')
       ON CONFLICT (username) DO NOTHING`,
      [adminPass]
    );
    const adminRes = await client.query("SELECT id FROM users WHERE username = 'admin'");
    const adminId = adminRes.rows[0].id;

    const chefPass = await hashPassword('chef123');
    const chef1Res = await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone)
       VALUES ('chef01', $1, '张师傅', 'chef', '13800000001')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [chefPass]
    );
    const chef1Id = chef1Res.rows.length > 0 ? chef1Res.rows[0].id : 
      (await client.query("SELECT id FROM users WHERE username = 'chef01'")).rows[0].id;

    const chef2Res = await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone)
       VALUES ('chef02', $1, '李师傅', 'chef', '13800000002')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [chefPass]
    );
    const chef2Id = chef2Res.rows.length > 0 ? chef2Res.rows[0].id :
      (await client.query("SELECT id FROM users WHERE username = 'chef02'")).rows[0].id;

    await client.query(
      `INSERT INTO chef_info (user_id, skills, station)
       VALUES ($1, ARRAY['chinese_cuisine', 'stir_fry', 'steaming']::VARCHAR[], '中餐台')
       ON CONFLICT (user_id) DO UPDATE SET skills = EXCLUDED.skills`,
      [chef1Id]
    );
    await client.query(
      `INSERT INTO chef_info (user_id, skills, station)
       VALUES ($1, ARRAY['noodle_making', 'soup_making', 'pastry']::VARCHAR[], '面点台')
       ON CONFLICT (user_id) DO UPDATE SET skills = EXCLUDED.skills`,
      [chef2Id]
    );

    const today = new Date().toISOString().split('T')[0];
    await client.query(
      `INSERT INTO chef_schedules (chef_id, date, shift_start, shift_end, is_on_duty)
       VALUES ($1, $2, '08:00', '14:00', true)
       ON CONFLICT (chef_id, date) DO NOTHING`,
      [chef1Id, today]
    );
    await client.query(
      `INSERT INTO chef_schedules (chef_id, date, shift_start, shift_end, is_on_duty)
       VALUES ($2, $1, '10:00', '18:00', true)
       ON CONFLICT (chef_id, date) DO NOTHING`,
      [today, chef2Id]
    );

    const parentPass = await hashPassword('parent123');
    const parentRes = await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone)
       VALUES ('parent01', $1, '王家长', 'parent', '13800000003')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [parentPass]
    );
    const parentId = parentRes.rows.length > 0 ? parentRes.rows[0].id :
      (await client.query("SELECT id FROM users WHERE username = 'parent01'")).rows[0].id;

    const studentPass = await hashPassword('student123');
    const studentRes = await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone)
       VALUES ('student01', $1, '王小明', 'student', '13800000004')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [studentPass]
    );
    const studentId = studentRes.rows.length > 0 ? studentRes.rows[0].id :
      (await client.query("SELECT id FROM users WHERE username = 'student01'")).rows[0].id;

    await client.query(
      `INSERT INTO student_accounts (student_id, balance, parent_id, grade, student_no)
       VALUES ($1, 500.00, $2, '三年级二班', '2024001')
       ON CONFLICT (student_id) DO UPDATE SET balance = 500.00, parent_id = $2`,
      [studentId, parentId]
    );

    const supplierPass = await hashPassword('supplier123');
    const supplierRes = await client.query(
      `INSERT INTO users (username, password_hash, name, role, phone)
       VALUES ('supplier01', $1, '绿源食材供应', 'supplier', '13800000005')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [supplierPass]
    );
    const supplierId = supplierRes.rows.length > 0 ? supplierRes.rows[0].id :
      (await client.query("SELECT id FROM users WHERE username = 'supplier01'")).rows[0].id;

    await client.query(
      `INSERT INTO supplier_info (user_id, company_name, contact_person, address)
       VALUES ($1, '绿源农业科技有限公司', '刘经理', '本市农产品批发市场A区12号')
       ON CONFLICT (user_id) DO NOTHING`,
      [supplierId]
    );

    const dishes = [
      { name: '红烧排骨饭', type: DishType.RICE, price: 18.00, stock: 50, nutrition: { calories: 650, protein: 35, fat: 25, carbs: 65, sodium: 850, fiber: 3 } },
      { name: '宫保鸡丁饭', type: DishType.RICE, price: 16.00, stock: 50, nutrition: { calories: 580, protein: 30, fat: 20, carbs: 60, sodium: 780, fiber: 2.5 } },
      { name: '番茄鸡蛋面', type: DishType.NOODLE, price: 12.00, stock: 40, nutrition: { calories: 480, protein: 18, fat: 12, carbs: 75, sodium: 650, fiber: 3 } },
      { name: '牛肉拉面', type: DishType.NOODLE, price: 18.00, stock: 30, nutrition: { calories: 560, protein: 28, fat: 18, carbs: 68, sodium: 900, fiber: 2 } },
      { name: '紫菜蛋花汤', type: DishType.SOUP, price: 5.00, stock: 100, nutrition: { calories: 80, protein: 6, fat: 4, carbs: 6, sodium: 500, fiber: 0.5 } },
      { name: '酸辣土豆丝', type: DishType.STIR_FRY, price: 8.00, stock: 60, nutrition: { calories: 180, protein: 3, fat: 8, carbs: 25, sodium: 400, fiber: 3 } },
      { name: '清蒸鲈鱼', type: DishType.STEAMED, price: 28.00, stock: 20, nutrition: { calories: 220, protein: 38, fat: 8, carbs: 0, sodium: 350, fiber: 0 } },
      { name: '巧克力蛋糕', type: DishType.DESSERT, price: 10.00, stock: 30, nutrition: { calories: 380, protein: 5, fat: 22, carbs: 42, sodium: 200, fiber: 1.5 } },
      { name: '鲜榨橙汁', type: DishType.DRINK, price: 8.00, stock: 50, nutrition: { calories: 120, protein: 1, fat: 0, carbs: 28, sodium: 10, fiber: 0.5 } },
    ];

    for (const dish of dishes) {
      await client.query(
        `INSERT INTO dishes (name, type, price, stock, nutrition_info, is_available)
         VALUES ($1, $2, $3, $4, $5::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [dish.name, dish.type, dish.price, dish.stock, JSON.stringify(dish.nutrition)]
      );
    }

    const ingredients = [
      { name: '猪排骨', category: '肉类', unit: 'kg', safety: 10, supplier: supplierId, expiry: addDays(7) },
      { name: '鸡胸肉', category: '肉类', unit: 'kg', safety: 15, supplier: supplierId, expiry: addDays(5) },
      { name: '牛肉', category: '肉类', unit: 'kg', safety: 8, supplier: supplierId, expiry: addDays(6) },
      { name: '鸡蛋', category: '蛋禽类', unit: '个', safety: 100, supplier: supplierId, expiry: addDays(20) },
      { name: '番茄', category: '蔬菜', unit: 'kg', safety: 15, supplier: supplierId, expiry: addDays(3) },
      { name: '土豆', category: '蔬菜', unit: 'kg', safety: 20, supplier: supplierId, expiry: addDays(30) },
      { name: '面条', category: '主食', unit: 'kg', safety: 25, supplier: supplierId, expiry: addDays(60) },
      { name: '大米', category: '主食', unit: 'kg', safety: 50, supplier: supplierId, expiry: addDays(90) },
      { name: '鲈鱼', category: '水产', unit: 'kg', safety: 5, supplier: supplierId, expiry: addDays(2) },
      { name: '面粉', category: '主食', unit: 'kg', safety: 30, supplier: supplierId, expiry: addDays(120) },
    ];

    for (const ing of ingredients) {
      await client.query(
        `INSERT INTO ingredients (name, category, unit, current_stock, safety_stock, supplier_id, expiry_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'normal')
         ON CONFLICT DO NOTHING`,
        [ing.name, ing.category, ing.unit, ing.safety * 2, ing.safety, ing.supplier, ing.expiry]
      );
    }

    await client.query('COMMIT');
    console.log('✅ 测试数据填充完成！');
    console.log('');
    console.log('📋 测试账号:');
    console.log('  管理员:   admin      / admin123');
    console.log('  厨师1:    chef01     / chef123  (中餐、炒菜、蒸菜)');
    console.log('  厨师2:    chef02     / chef123  (面点、汤品、西点)');
    console.log('  学生:     student01  / student123 (余额500元)');
    console.log('  家长:     parent01   / parent123');
    console.log('  供应商:   supplier01 / supplier123');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 数据填充失败:', error);
    throw error;
  } finally {
    client.release();
  }
}

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { seed };
