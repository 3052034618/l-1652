import cron from 'node-cron';
import { config } from '../config';
import { checkExpiryStatus, checkLowStock } from './inventory';
import { generateDailyNutritionReports } from './nutrition';
import { generateMonthlyOperationsReport } from './report';

const jobs: Map<string, cron.ScheduledTask> = new Map();

export function startScheduledJobs() {
  console.log('启动定时任务调度器...');

  const expiryJob = cron.schedule('0 */6 * * *', async () => {
    console.log('[定时任务] 检查食材保质期...');
    try {
      const result = await checkExpiryStatus();
      console.log(`[定时任务] 保质期检查完成，检查了 ${result.checked} 项食材`);
    } catch (error) {
      console.error('[定时任务] 保质期检查失败:', error);
    }
  });
  jobs.set('expiryCheck', expiryJob);

  const stockJob = cron.schedule('0 */8 * * *', async () => {
    console.log('[定时任务] 检查库存安全水位...');
    try {
      const result = await checkLowStock();
      console.log(`[定时任务] 库存检查完成，${result.lowStockItems} 项食材低于安全库存`);
    } catch (error) {
      console.error('[定时任务] 库存检查失败:', error);
    }
  });
  jobs.set('stockCheck', stockJob);

  const nutritionCron = `0 ${config.nutritionReportHour} * * *`;
  const nutritionJob = cron.schedule(nutritionCron, async () => {
    console.log('[定时任务] 生成每日营养报告...');
    try {
      const result = await generateDailyNutritionReports();
      console.log(`[定时任务] 营养报告生成完成，共生成 ${result.generated} 份`);
    } catch (error) {
      console.error('[定时任务] 营养报告生成失败:', error);
    }
  });
  jobs.set('nutritionReport', nutritionJob);

  const operationsCron = `0 2 ${config.operationsReportDay} * *`;
  const operationsJob = cron.schedule(operationsCron, async () => {
    console.log('[定时任务] 生成月度运营报表...');
    try {
      const report = await generateMonthlyOperationsReport();
      console.log(`[定时任务] 运营报表生成完成: ${report.report_month}`);
    } catch (error) {
      console.error('[定时任务] 运营报表生成失败:', error);
    }
  });
  jobs.set('operationsReport', operationsJob);

  console.log(`已注册 ${jobs.size} 个定时任务`);
}

export function stopScheduledJobs() {
  for (const [name, job] of jobs) {
    job.stop();
    console.log(`已停止定时任务: ${name}`);
  }
  jobs.clear();
}

export function listJobs() {
  return Array.from(jobs.keys());
}

export async function runJobManually(jobName: string) {
  switch (jobName) {
    case 'expiryCheck':
      return checkExpiryStatus();
    case 'stockCheck':
      return checkLowStock();
    case 'nutritionReport':
      return generateDailyNutritionReports();
    case 'operationsReport':
      return generateMonthlyOperationsReport();
    default:
      throw new Error(`未知的任务: ${jobName}`);
  }
}
