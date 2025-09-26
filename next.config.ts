import type { NextConfig } from "next";

// 读取端口配置
const { readPortFromConfig } = require('./scripts/read-config.js');
const config = readPortFromConfig();

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false, // 禁用开发工具指示器
  env: {
    FRONTEND_PORT: config.frontendPort.toString(),
    BACKEND_PORT: config.backendPort.toString(),
    WEBSOCKET_PORT: config.websocketPort.toString(),
  },
  // 如果需要在构建时使用端口配置
  publicRuntimeConfig: {
    frontendPort: config.frontendPort,
    backendPort: config.backendPort,
    websocketPort: config.websocketPort,
  },
};

export default nextConfig;
