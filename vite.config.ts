import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5188,
    proxy: {
      // 中文注解：前端请求 /api 时转发到本地后端，避免把墨灵 sk 密钥暴露到浏览器。
      "/api": "http://127.0.0.1:3001"
    }
  }
});
