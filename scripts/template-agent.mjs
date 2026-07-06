import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const registryPath = path.join(rootDir, ".agents", "template", "registry.json");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readRegistry() {
  return readJson(registryPath);
}

function usage() {
  return `模板 Agent 本地调用工具

用法：
  npm run template-agent -- list
  npm run template-agent -- show <agent_code>
  npm run template-agent -- prompt <agent_code> [--input input.json]
  npm run template-agent -- workflow

示例：
  npm run template-agent -- show template_planner_agent
  npm run template-agent -- prompt template_visual_qa_agent --input tmp/template-qa-input.json
`;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const result = { command, agentCode: args.shift(), inputPath: "" };

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--input") {
      result.inputPath = args[index + 1] || "";
      index += 1;
    }
  }

  return result;
}

function findAgent(registry, agentCode) {
  const agent = registry.agents.find((item) => item.code === agentCode);
  if (!agent) {
    throw new Error(`未找到 Agent：${agentCode}`);
  }
  return agent;
}

async function listAgents() {
  const registry = await readRegistry();
  console.log(`模板 Agent 数量：${registry.agents.length}`);
  for (const agent of registry.agents) {
    console.log(`- ${agent.code}：${agent.name}，network=${agent.network}，browser=${agent.browser}`);
  }
}

async function showAgent(agentCode) {
  const registry = await readRegistry();
  const agent = findAgent(registry, agentCode);
  const content = await fs.readFile(path.join(rootDir, agent.file), "utf8");
  console.log(content);
}

async function buildPrompt(agentCode, inputPath) {
  const registry = await readRegistry();
  const agent = findAgent(registry, agentCode);
  const agentContent = await fs.readFile(path.join(rootDir, agent.file), "utf8");
  const inputContent = inputPath ? await fs.readFile(path.resolve(rootDir, inputPath), "utf8") : "{}";

  // 中文注解：本工具只组装 Agent 调用提示词，不直接联网、不写库、不上传文件，真实执行由调用方决定。
  console.log(`# 调用 Agent：${agent.name}

下面是 Agent 定义：

${agentContent}

下面是本次输入：

\`\`\`json
${inputContent.trim()}
\`\`\`

请严格按照该 Agent 的职责、禁止事项、输出格式执行。`);
}

async function showWorkflow() {
  const registry = await readRegistry();
  console.log("推荐模板添加工作流：");
  for (const [index, agent] of registry.agents.entries()) {
    const arrow = index === registry.agents.length - 1 ? "" : " ->";
    console.log(`${index + 1}. ${agent.code}（${agent.name}）${arrow}`);
  }
}

async function main() {
  const { command, agentCode, inputPath } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  if (command === "list") {
    await listAgents();
    return;
  }

  if (command === "workflow") {
    await showWorkflow();
    return;
  }

  if (!agentCode) {
    throw new Error(`命令 ${command} 需要传入 agent_code`);
  }

  if (command === "show") {
    await showAgent(agentCode);
    return;
  }

  if (command === "prompt") {
    await buildPrompt(agentCode, inputPath);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
});
