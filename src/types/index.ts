export enum UserRole {
  STUDENT = 'student',
  CHEF = 'chef',
  ADMIN = 'admin',
  PARENT = 'parent',
  SUPPLIER = 'supplier',
}

export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  PREPARING = 'preparing',
  READY = 'ready',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum MealTaskStatus {
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export enum IngredientStatus {
  NORMAL = 'normal',
  NEAR_EXPIRY = 'near_expiry',
  EXPIRED = 'expired',
}

export enum PurchaseStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ORDERED = 'ordered',
  DELIVERED = 'delivered',
}

export enum DishType {
  RICE = 'rice',
  NOODLE = 'noodle',
  SOUP = 'soup',
  STIR_FRY = 'stir_fry',
  STEAMED = 'steamed',
  DESSERT = 'dessert',
  DRINK = 'drink',
}

export enum ChefSkill {
  CHINESE_CUISINE = 'chinese_cuisine',
  WESTERN_CUISINE = 'western_cuisine',
  PASTRY = 'pastry',
  NOODLE_MAKING = 'noodle_making',
  SOUP_MAKING = 'soup_making',
  STIR_FRY = 'stir_fry',
  STEAMING = 'steaming',
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  phone?: string;
  email?: string;
  created_at: Date;
}

export interface StudentAccount {
  id: string;
  student_id: string;
  balance: number;
  parent_id?: string;
  grade: string;
  student_no: string;
}

export interface ChefInfo {
  id: string;
  user_id: string;
  skills: ChefSkill[];
  station: string;
}

export interface Dish {
  id: string;
  name: string;
  type: DishType;
  price: number;
  stock: number;
  description?: string;
  nutrition_info: NutritionInfo;
  image_url?: string;
  is_available: boolean;
}

export interface NutritionInfo {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sodium: number;
  fiber?: number;
}

export interface Order {
  id: string;
  student_id: string;
  total_amount: number;
  status: OrderStatus;
  pickup_window_start?: Date;
  pickup_window_end?: Date;
  created_at: Date;
  completed_at?: Date;
}

export interface OrderItem {
  id: string;
  order_id: string;
  dish_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface MealTask {
  id: string;
  order_id: string;
  order_item_id: string;
  dish_id: string;
  chef_id?: string;
  status: MealTaskStatus;
  quantity: number;
  assigned_at?: Date;
  started_at?: Date;
  completed_at?: Date;
}

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  safety_stock: number;
  expiry_date?: Date;
  status: IngredientStatus;
  supplier_id?: string;
}

export interface IngredientStockRecord {
  id: string;
  ingredient_id: string;
  quantity: number;
  type: 'in' | 'out' | 'waste';
  expiry_date?: Date;
  batch_no?: string;
  created_at: Date;
  remark?: string;
}

export interface PurchaseRequest {
  id: string;
  ingredient_id: string;
  quantity: number;
  requested_by: string;
  approved_by?: string;
  status: PurchaseStatus;
  estimated_price?: number;
  supplier_id?: string;
  created_at: Date;
  approved_at?: Date;
  delivered_at?: Date;
  remark?: string;
}

export interface ChefSchedule {
  id: string;
  chef_id: string;
  date: Date;
  shift_start: string;
  shift_end: string;
  is_on_duty: boolean;
}

export interface NutritionReport {
  id: string;
  student_id: string;
  report_date: Date;
  total_calories: number;
  total_protein: number;
  total_fat: number;
  total_carbs: number;
  total_sodium: number;
  recommendations: string[];
  sent_to_parent: boolean;
  created_at: Date;
}

export interface OperationsReport {
  id: string;
  report_month: string;
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  avg_prep_time_minutes: number;
  ingredient_waste_rate: number;
  top_selling_dishes: { dish_id: string; dish_name: string; count: number }[];
  created_at: Date;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: Date;
}
