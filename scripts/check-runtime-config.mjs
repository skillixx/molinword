import { validateProductionConfiguration } from "../server/index.js";

const requireProduction = process.argv.includes("--require-production");
const errors = validateProductionConfiguration(process.env);

// 中文注解：生产托管必须显式要求 production，避免环境文件缺失时退回开发模式并让预检假阳性通过。
if (requireProduction && String(process.env.APP_ENV || "").trim().toLowerCase() !== "production") {
  errors.unshift("APP_ENV 必须设置为 production");
}
if (errors.length) {
  // 中文注解：只输出变量名和规则，不输出环境变量值，避免配置预检把密钥写入 journal。
  console.error(`生产运行配置检查失败：\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("生产运行配置检查通过。", {
    appEnvironment: process.env.APP_ENV || process.env.NODE_ENV,
    appName: process.env.APP_NAME || "moling_word"
  });
}
