import { pool } from './pool';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('开始初始化数据库...');
    
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'chef', 'admin', 'parent', 'supplier')),
        phone VARCHAR(20),
        email VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_accounts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        parent_id UUID REFERENCES users(id),
        grade VARCHAR(50) NOT NULL,
        student_no VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chef_info (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skills VARCHAR(50)[] NOT NULL DEFAULT '{}',
        station VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_info (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_name VARCHAR(200) NOT NULL,
        contact_person VARCHAR(100),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dishes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        type VARCHAR(30) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        nutrition_info JSONB NOT NULL DEFAULT '{}',
        image_url VARCHAR(500),
        is_available BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS canteen_hours (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
        open_time TIME NOT NULL,
        last_order_time TIME NOT NULL,
        close_time TIME NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(day_of_week, meal_type)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES users(id),
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' 
          CHECK (status IN ('pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled')),
        pickup_scheduled_time TIMESTAMP,
        pickup_window_start TIMESTAMP,
        pickup_window_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        cancelled_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_cart (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dish_id UUID NOT NULL REFERENCES dishes(id),
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, dish_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        dish_id UUID NOT NULL REFERENCES dishes(id),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS meal_tasks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID NOT NULL REFERENCES orders(id),
        order_item_id UUID NOT NULL REFERENCES order_items(id),
        dish_id UUID NOT NULL REFERENCES dishes(id),
        chef_id UUID REFERENCES users(id),
        status VARCHAR(20) NOT NULL DEFAULT 'assigned'
          CHECK (status IN ('assigned', 'in_progress', 'completed')),
        quantity INTEGER NOT NULL,
        assigned_at TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chef_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        chef_id UUID NOT NULL REFERENCES users(id),
        date DATE NOT NULL,
        shift_start TIME NOT NULL,
        shift_end TIME NOT NULL,
        is_on_duty BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chef_id, date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100) NOT NULL,
        unit VARCHAR(20) NOT NULL,
        current_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
        safety_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
        expiry_date DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'normal'
          CHECK (status IN ('normal', 'near_expiry', 'expired')),
        supplier_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ingredient_stock_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ingredient_id UUID NOT NULL REFERENCES ingredients(id),
        quantity DECIMAL(10,2) NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('in', 'out', 'waste')),
        expiry_date DATE,
        batch_no VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        remark TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dish_ingredient_relations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
        ingredient_id UUID NOT NULL REFERENCES ingredients(id),
        quantity DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(dish_id, ingredient_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ingredient_id UUID NOT NULL REFERENCES ingredients(id),
        quantity DECIMAL(10,2) NOT NULL,
        requested_by UUID NOT NULL REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        status VARCHAR(25) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected', 'ordered', 'supplier_accepted', 'supplier_rejected', 'shipping', 'delivered')),
        estimated_price DECIMAL(10,2),
        supplier_id UUID REFERENCES users(id),
        supplier_accepted_at TIMESTAMP,
        expected_delivery_time TIMESTAMP,
        actual_delivery_time TIMESTAMP,
        tracking_no VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP,
        delivered_at TIMESTAMP,
        remark TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES users(id),
        order_id UUID REFERENCES orders(id),
        amount DECIMAL(10,2) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('recharge', 'deduction', 'refund')),
        balance_after DECIMAL(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS nutrition_reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES users(id),
        report_date DATE NOT NULL,
        total_calories DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_protein DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_fat DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_carbs DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_sodium DECIMAL(10,2) NOT NULL DEFAULT 0,
        recommendations TEXT[] NOT NULL DEFAULT '{}',
        sent_to_parent BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, report_date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS operations_reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_month VARCHAR(7) NOT NULL,
        total_orders INTEGER NOT NULL DEFAULT 0,
        total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
        avg_order_value DECIMAL(10,2) NOT NULL DEFAULT 0,
        avg_prep_time_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
        ingredient_waste_rate DECIMAL(5,4) NOT NULL DEFAULT 0,
        top_selling_dishes JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(report_month)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);');

    console.log('执行数据库升级迁移，兼容老数据...');

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'pickup_scheduled_time') THEN
          ALTER TABLE orders ADD COLUMN pickup_scheduled_time TIMESTAMP;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'remark') THEN
          ALTER TABLE orders ADD COLUMN remark TEXT;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'purchase_requests' AND constraint_name LIKE '%purchase_requests_status_check%') THEN
          ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE purchase_requests 
      ALTER COLUMN status TYPE VARCHAR(25);
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_requests' AND column_name = 'supplier_accepted_at') THEN
          ALTER TABLE purchase_requests ADD COLUMN supplier_accepted_at TIMESTAMP;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_requests' AND column_name = 'expected_delivery_time') THEN
          ALTER TABLE purchase_requests ADD COLUMN expected_delivery_time TIMESTAMP;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_requests' AND column_name = 'actual_delivery_time') THEN
          ALTER TABLE purchase_requests ADD COLUMN actual_delivery_time TIMESTAMP;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_requests' AND column_name = 'tracking_no') THEN
          ALTER TABLE purchase_requests ADD COLUMN tracking_no VARCHAR(100);
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE purchase_requests
      DROP CONSTRAINT IF EXISTS purchase_requests_status_check2;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'purchase_requests_status_check' 
          AND conrelid = 'purchase_requests'::regclass
        ) THEN
          ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
          CHECK (status IN (
            'pending', 'approved', 'rejected', 'ordered', 
            'supplier_accepted', 'supplier_rejected', 'shipping', 'delivered'
          ));
        END IF;
      END $$;
    `);

    console.log('数据库升级迁移完成，所有新字段已就绪。');

    await client.query('COMMIT');
    console.log('数据库初始化完成！');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('数据库初始化失败:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
