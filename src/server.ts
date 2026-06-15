import { startServer } from './app';
import { initDatabase } from './database/init';

async function bootstrap() {
  try {
    const server = await startServer();
    console.log('✅ HTTP 服务器已启动，健康检查可用');

    try {
      await initDatabase();
      console.log('✅ 数据库初始化完成');
      console.log('🚀 系统启动成功！');
    } catch (dbError) {
      console.warn('⚠️  数据库初始化失败（健康检查仍可用）:', dbError instanceof Error ? dbError.message : dbError);
      console.log('ℹ️  请确保 PostgreSQL 服务已启动并正确配置 .env 中的数据库连接信息');
    }

    return server;
  } catch (error) {
    console.error('❌ HTTP 服务器启动失败:', error);
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
