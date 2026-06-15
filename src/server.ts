import { startServer } from './app';
import { initDatabase } from './database/init';

async function bootstrap() {
  try {
    await initDatabase();
    await startServer();
    console.log('🚀 系统启动成功！');
  } catch (error) {
    console.error('❌ 系统启动失败:', error);
    process.exit(1);
  }
}

bootstrap();

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
