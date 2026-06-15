import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/error';
import { initSocketServer } from './services/socket';
import { startScheduledJobs } from './services/scheduler';

import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import dishRoutes from './routes/dish';
import orderRoutes from './routes/order';
import taskRoutes from './routes/mealTask';
import inventoryRoutes from './routes/inventory';
import purchaseRoutes from './routes/purchase';
import nutritionRoutes from './routes/nutrition';
import reportRoutes from './routes/report';
import notificationRoutes from './routes/notification';
import cartRoutes from './routes/cart';
import canteenHoursRoutes from './routes/canteenHours';
import analyticsRoutes from './routes/analytics';

export function createApp(): Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/dishes', dishRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/nutrition', nutritionRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/canteen-hours', canteenHoursRoutes);
  app.use('/api/analytics', analyticsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export async function startServer() {
  const app = createApp();
  const httpServer = createServer(app);

  initSocketServer(httpServer);

  const server = httpServer.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║     智慧校园食堂管理系统 API Server                      ║
╠══════════════════════════════════════════════════════════╣
║  环境: ${config.env.padEnd(45)}║
║  HTTP 端口: ${String(config.port).padEnd(42)}║
║  Socket 端口: ${String(config.socketPort).padEnd(39)}║
║  健康检查: http://localhost:${config.port}/api/health${" ".repeat(11)}║
╚══════════════════════════════════════════════════════════╝
    `);
  });

  startScheduledJobs();

  return server;
}
