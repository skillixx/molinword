import path from "node:path";
import { Buffer } from "node:buffer";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildThirdPartyLicenseBundle } from "./scripts/third-party-license-bundle.mjs";

type LicenseBundleBuilder = (options: { rootDir: string }) => Promise<{ content: string; missing: unknown[] }>;

export function thirdPartyLicenseDevPlugin({
  buildBundle = buildThirdPartyLicenseBundle
}: { buildBundle?: LicenseBundleBuilder } = {}): Plugin {
  let bundlePromise: Promise<string> | null = null;
  const loadBundle = (rootDir: string) => {
    if (!bundlePromise) {
      bundlePromise = buildBundle({ rootDir }).then((result) => {
        if (result.missing.length) throw new Error(`第三方许可证缺失 ${result.missing.length} 项`);
        return result.content;
      }).catch((error) => {
        // 中文注解：失败结果不缓存，依赖补齐后无需重启开发服务即可再次生成。
        bundlePromise = null;
        throw error;
      });
    }
    return bundlePromise;
  };

  return {
    name: "molinword-dev-third-party-licenses",
    apply: "serve",
    configureServer(server) {
      const rootDir = server.config.root;
      const watchedFiles = new Set([
        path.resolve(rootDir, "package-lock.json"),
        path.resolve(rootDir, "ops", "release-target.json")
      ]);
      server.watcher.add([...watchedFiles]);
      const invalidateBundle = (filePath: string) => {
        if (watchedFiles.has(path.resolve(filePath))) bundlePromise = null;
      };
      server.watcher.on("change", invalidateBundle);
      server.watcher.on("add", invalidateBundle);
      server.watcher.on("unlink", invalidateBundle);

      // 中文注解：开发态必须在 SPA 回退前精确拦截许可证路径，否则点击入口会得到 index.html 的假 200。
      server.middlewares.use(async (request, response, next) => {
        const requestPath = String(request.url || "/").split("?", 1)[0];
        if (requestPath !== "/THIRD_PARTY_LICENSES.txt") return next();
        const method = String(request.method || "GET").toUpperCase();
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (method !== "GET" && method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end("仅支持 GET 和 HEAD。\n");
          return;
        }
        try {
          const content = await loadBundle(rootDir);
          response.statusCode = 200;
          response.setHeader("Content-Length", String(Buffer.byteLength(content)));
          response.end(method === "HEAD" ? undefined : content);
        } catch (error) {
          server.config.logger.error(`开发态许可证生成失败：${error instanceof Error ? error.message : "未知错误"}`);
          response.statusCode = 503;
          response.end(method === "HEAD" ? undefined : "开源许可证声明暂不可用。\n");
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), thirdPartyLicenseDevPlugin()],
  // 中文注解：前端生产制品不得从构建机 .env 注入未受 Git 绑定的值；浏览器端当前没有 VITE_* 配置，运行凭据只由后端在启动时读取。
  envDir: false,
  build: {
    // 中文注解：生成构建清单供商业性能门禁计算真正的初始静态依赖闭包，而不是只看文件名。
    manifest: true,
    rollupOptions: {
      output: {
        // 中文注解：只移动显式匹配模块，避免 Rollup 将共享依赖隐式卷入错误的业务分块并形成反向依赖。
        onlyExplicitManualChunks: true,
        manualChunks(moduleId) {
          const id = moduleId.replace(/\\/g, "/");
          if (!id.includes("/node_modules/")) return undefined;
          // 中文注解：稳定框架、图标与编辑器运行时独立缓存，业务迭代不再让浏览器重复下载整套 Tiptap/ProseMirror。
          if (id.includes("/@tiptap/")) return "editor-tiptap";
          if (/\/node_modules\/(?:react|react-dom|scheduler|use-sync-external-store)\//.test(id)) return "vendor-react";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (/\/node_modules\/(?:prosemirror-[^/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs|fast-equals)\//.test(id)) return "editor-prosemirror";
          return undefined;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5188,
    proxy: {
      // 中文注解：前端请求 /api 时转发到本地后端，避免把墨灵 sk 密钥暴露到浏览器。
      "/api": "http://127.0.0.1:3001"
    }
  }
});
