import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import { thirdPartyLicenseDevPlugin } from "../vite.config.ts";
import { buildThirdPartyLicenseBundle } from "./third-party-license-bundle.mjs";

async function listen(server) {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === "object", "Vite 开发服务必须监听随机本地端口");
  return `http://127.0.0.1:${address.port}/THIRD_PARTY_LICENSES.txt`;
}

const server = await createServer({
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0, strictPort: true }
});

try {
  const url = await listen(server);
  const expectedBundle = await buildThirdPartyLicenseBundle({ rootDir: process.cwd() });
  assert.deepEqual(expectedBundle.missing, [], "受控许可证生成器不得存在缺失项");

  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const content = Buffer.from(await response.arrayBuffer());
  assert.ok(content.byteLength > 100_000 && content.byteLength <= 16 * 1024 * 1024, "开发态许可证正文体积必须处于发布门禁范围");
  assert.ok(content.equals(Buffer.from(expectedBundle.content, "utf8")), "开发态 HTTP 正文必须与受控生成器结果逐字节一致，不能只保留头部片段");
  const text = content.toString("utf8");
  assert.match(text, /^MOLINWORD THIRD-PARTY LICENSE BUNDLE\n/);
  assert.match(text, /Package: react@\d+\.\d+\.\d+[\s\S]*?License: MIT/);
  assert.doesNotMatch(text, /<!doctype html>|<script|release-manifest|artifactSha256/i, "开发态许可证入口不能回退到 SPA 或混入内部发布清单");

  const headResponse = await fetch(url, { method: "HEAD" });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get("content-length"), String(content.byteLength));
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0);

  const postResponse = await fetch(url, { method: "POST" });
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");

  // 中文注解：请求路径不做 URL 解码，畸形百分号编码只能落入普通路由，不能抛异常击穿开发服务。
  const malformedResponse = await fetch(new URL("/%E0%A4%A", url));
  assert.notEqual(malformedResponse.status, 500);
  await malformedResponse.arrayBuffer();
  assert.equal((await fetch(url)).status, 200, "畸形路径后许可证入口必须继续可用");
  console.log("Vite 开发态开源许可证入口检查通过。", { bytes: content.byteLength, contentType: response.headers.get("content-type") });
} finally {
  await server.close();
}

let buildAttempts = 0;
let generationFails = true;
const lifecycleServer = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: "silent",
  plugins: [thirdPartyLicenseDevPlugin({
    buildBundle: async () => {
      buildAttempts += 1;
      if (generationFails) throw new Error("不应返回给浏览器的内部失败细节");
      return { content: `MOLINWORD TEST LICENSE BUNDLE ${buildAttempts}\n`, missing: [] };
    }
  })],
  server: { host: "127.0.0.1", port: 0, strictPort: true }
});

try {
  const url = await listen(lifecycleServer);
  const failedResponse = await fetch(url);
  assert.equal(failedResponse.status, 503);
  assert.equal(failedResponse.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(failedResponse.headers.get("cache-control"), "no-store");
  assert.equal(failedResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await failedResponse.text(), "开源许可证声明暂不可用。\n");

  // 中文注解：失败 Promise 不能留在缓存中；修复依赖后，同一开发进程下一次请求必须立即恢复。
  generationFails = false;
  const recoveredText = await (await fetch(url)).text();
  assert.equal(recoveredText, "MOLINWORD TEST LICENSE BUNDLE 2\n");
  assert.equal(await (await fetch(url)).text(), recoveredText, "未变化时应复用同一份许可证正文");
  assert.equal(buildAttempts, 2);

  // 中文注解：直接触发 Vite 文件监视事件，隔离验证两个生成输入变化都会淘汰正文缓存，不改写真实锁文件。
  lifecycleServer.watcher.emit("change", path.resolve(process.cwd(), "package-lock.json"));
  assert.equal(await (await fetch(url)).text(), "MOLINWORD TEST LICENSE BUNDLE 3\n");
  lifecycleServer.watcher.emit("unlink", path.resolve(process.cwd(), "ops", "release-target.json"));
  assert.equal(await (await fetch(url)).text(), "MOLINWORD TEST LICENSE BUNDLE 4\n");
} finally {
  await lifecycleServer.close();
}
