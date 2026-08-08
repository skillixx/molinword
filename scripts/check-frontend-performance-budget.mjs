import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const manifestPath = "dist/.vite/manifest.json";
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  assert.fail(`缺少生产构建清单 ${manifestPath}：${error.message}`);
}

const entryPair = Object.entries(manifest).find(([, item]) => item.isEntry);
assert.ok(entryPair, "生产构建清单缺少前端入口");

const initialKeys = new Set();
// 中文注解：只递归入口的静态 imports，动态导入不会被误计为首屏传输成本。
function collectInitialImports(key) {
  if (initialKeys.has(key)) return;
  const item = manifest[key];
  assert.ok(item, `生产构建清单引用了不存在的模块：${key}`);
  initialKeys.add(key);
  for (const importedKey of item.imports || []) collectInitialImports(importedKey);
}
collectInitialImports(entryPair[0]);

const chunkMetrics = [];
const initialCssFiles = new Set();
for (const key of initialKeys) {
  const item = manifest[key];
  for (const cssFile of item.css || []) initialCssFiles.add(cssFile);
  if (!item.file?.endsWith(".js")) continue;
  assert.match(item.file, /-[A-Za-z0-9_-]{8}\.js$/, `初始脚本必须使用内容哈希文件名以支持 immutable 缓存：${item.file}`);
  const content = await readFile(`dist/${item.file}`);
  chunkMetrics.push({
    file: item.file,
    rawBytes: content.length,
    gzipBytes: gzipSync(content, { level: 9 }).length
  });
}

const cssMetrics = [];
for (const cssFile of initialCssFiles) {
  const content = await readFile(`dist/${cssFile}`);
  cssMetrics.push({
    file: cssFile,
    rawBytes: content.length,
    gzipBytes: gzipSync(content, { level: 9 }).length
  });
}

// 中文注解：同时约束单块解析成本、首屏传输总量和请求数量，避免仅靠拆碎文件绕过门禁。
const maximumChunkBytes = 450 * 1024;
const maximumInitialGzipBytes = 300 * 1024;
const maximumInitialRequestCount = 8;
const maximumInitialCssGzipBytes = 32 * 1024;
const oversizedChunks = chunkMetrics.filter((item) => item.rawBytes > maximumChunkBytes);
const initialGzipBytes = chunkMetrics.reduce((total, item) => total + item.gzipBytes, 0);
const initialCssGzipBytes = cssMetrics.reduce((total, item) => total + item.gzipBytes, 0);
const initialRequestCount = chunkMetrics.length + cssMetrics.length;

assert.deepEqual(
  oversizedChunks,
  [],
  `初始 JavaScript 单块不得超过 ${maximumChunkBytes} 字节：${JSON.stringify(oversizedChunks)}`
);
assert.ok(
  initialGzipBytes <= maximumInitialGzipBytes,
  `初始 JavaScript gzip 总量 ${initialGzipBytes} 超过预算 ${maximumInitialGzipBytes}`
);
assert.ok(
  initialRequestCount <= maximumInitialRequestCount,
  `初始 JavaScript/CSS 请求 ${initialRequestCount} 个，超过预算 ${maximumInitialRequestCount}`
);
assert.ok(
  initialCssGzipBytes <= maximumInitialCssGzipBytes,
  `初始 CSS gzip 总量 ${initialCssGzipBytes} 超过预算 ${maximumInitialCssGzipBytes}`
);

console.log("前端生产性能预算检查通过。", {
  initialChunks: chunkMetrics,
  initialGzipBytes,
  maximumInitialGzipBytes,
  initialRequestCount,
  maximumInitialRequestCount,
  initialCss: cssMetrics,
  initialCssGzipBytes,
  maximumInitialCssGzipBytes
});
