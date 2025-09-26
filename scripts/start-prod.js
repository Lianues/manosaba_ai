#!/usr/bin/env node

const { spawn } = require('child_process');
const { readPortFromConfig } = require('./read-config.js');

// 读取端口配置
const config = readPortFromConfig();
const port = config.frontendPort;

console.log(`🚀 启动生产服务器，端口: ${port}`);

// 启动 Next.js 生产服务器，只绑定到本地接口
const child = spawn('npx', ['next', 'start', '-p', port.toString(), '--hostname', 'localhost'], {
  stdio: 'inherit',
  shell: true
});

child.on('error', (error) => {
  console.error('启动失败:', error);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code);
});