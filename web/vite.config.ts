import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * AutoDevelopment 平台前端 · 构建配置
 * 形态约束（App-Spec §2）：SPA + 客户端路由；单条 SSE；本地草稿栈；自研画布渲染器。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      // 后端就绪后：把 /api 代理到真实服务；未就绪时前端走内置 mock（见 src/api/client.ts）
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
