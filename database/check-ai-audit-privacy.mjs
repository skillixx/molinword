import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { formatAiAuditSchemaReport, inspectAiAuditSchema } from "../shared/ai-audit-schema.js";

export async function runAiAuditSchemaCheck(connection, output = console) {
  const report = await inspectAiAuditSchema(connection);
  const message = formatAiAuditSchemaReport(report);
  if (report.ready) {
    output.log(message);
    return 0;
  }
  output.error(message);
  return 1;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL，无法执行 AI 审计数据库结构只读预检。");
    return 1;
  }
  let connection;
  try {
    connection = await mysql.createConnection(process.env.DATABASE_URL);
    return await runAiAuditSchemaCheck(connection);
  } catch {
    // 中文注解：命令可能运行在共享部署日志中，只返回受控故障说明，不能把驱动错误中的主机或账号信息原样输出。
    console.error("AI 审计数据库结构只读预检失败，请检查受保护环境中的数据库连接和权限。");
    return 1;
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

// 中文注解：模块导入用于契约测试，只有直接作为 CLI 运行时才连接真实数据库。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = await main();
