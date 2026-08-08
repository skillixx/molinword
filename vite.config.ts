import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
