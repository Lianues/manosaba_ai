#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 从 modularflow_config.py 文件中读取端口配置
 */
function readPortFromConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'modularflow_config.py');
    const configContent = fs.readFileSync(configPath, 'utf8');
    
    // 使用正则表达式提取端口配置
    const frontendPortMatch = configContent.match(/FRONTEND_PORT\s*=\s*(\d+)/);
    const backendPortMatch = configContent.match(/BACKEND_PORT\s*=\s*(\d+)/);
    const websocketPortMatch = configContent.match(/WEBSOCKET_PORT\s*=\s*(\d+)/);
    
    const config = {
      frontendPort: frontendPortMatch ? parseInt(frontendPortMatch[1]) : 3000,
      backendPort: backendPortMatch ? parseInt(backendPortMatch[1]) : 8000,
      websocketPort: websocketPortMatch ? parseInt(websocketPortMatch[1]) : 8000
    };
    
    return config;
  } catch (error) {
    console.error('读取配置文件失败:', error.message);
    // 返回默认端口
    return {
      frontendPort: 3000,
      backendPort: 8000,
      websocketPort: 8000
    };
  }
}

// 如果直接运行此脚本，输出端口信息
if (require.main === module) {
  const config = readPortFromConfig();
  
  // 根据命令行参数返回不同的端口
  const arg = process.argv[2];
  
  switch (arg) {
    case 'frontend':
    case 'front':
      console.log(config.frontendPort);
      break;
    case 'backend':
    case 'back':
      console.log(config.backendPort);
      break;
    case 'websocket':
    case 'ws':
      console.log(config.websocketPort);
      break;
    case 'json':
      console.log(JSON.stringify(config, null, 2));
      break;
    default:
      console.log(config.frontendPort); // 默认返回前端端口
  }
}

module.exports = { readPortFromConfig };