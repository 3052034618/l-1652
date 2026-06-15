import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  socketPort: parseInt(process.env.SOCKET_PORT || '3001', 10),
  env: process.env.NODE_ENV || 'development',
  
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'smart_canteen',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  
  nutritionReportHour: parseInt(process.env.NUTRITION_REPORT_HOUR || '20', 10),
  operationsReportDay: parseInt(process.env.OPERATIONS_REPORT_DAY || '1', 10),
  
  nearExpiryDays: 3,
  orderPickupWaitMinutes: 15,
};
