#!/usr/bin/env python3
"""
Manosaba AI 项目配置脚本
"""

# ===========================================
# 🔧 主要配置 - 可直接修改
# ===========================================

# 端口配置
FRONTEND_PORT = 3002
BACKEND_PORT = 8000
WEBSOCKET_PORT = 8000

# 项目信息
PROJECT_NAME = "manosaba_ai"
DISPLAY_NAME = "Manosaba AI"
PROJECT_TYPE = "nextjs"

# 运行命令
INSTALL_COMMAND = "pnpm install"
DEV_COMMAND = "pnpm run dev"
BUILD_COMMAND = "pnpm run build"

# ===========================================
# 📋 详细配置 - 一般不需要修改
# ===========================================

import json
import subprocess
import os


class ManosabaAIConfig:
    """Manosaba AI 项目配置"""
    
    def get_project_info(self):
        return {
            "name": PROJECT_NAME,
            "display_name": DISPLAY_NAME,
            "version": "1.0.0",
            "description": "基于Next.js的AI智能助手应用",
            "type": PROJECT_TYPE,
            "author": "Manosaba Team",
            "license": "MIT"
        }
    
    def get_runtime_config(self):
        return {
            "port": FRONTEND_PORT,
            "install_command": INSTALL_COMMAND,
            "dev_command": DEV_COMMAND,
            "build_command": BUILD_COMMAND,
            "test_command": "pnpm test",
            "lint_command": "pnpm run lint"
        }
    
    def get_dependencies(self):
        return {
            "required_tools": ["node", "pnpm"],
            "optional_tools": ["yarn", "npm"],
            "node_version": ">=18.0.0",
            "pnpm_version": ">=8.0.0"
        }
    
    def get_api_config(self):
        return {
            "api_endpoint": f"http://localhost:{BACKEND_PORT}/api/v1",
            "websocket_url": f"ws://localhost:{WEBSOCKET_PORT}/ws",
            "cors_origins": [f"http://localhost:{FRONTEND_PORT}"]
        }
    
    def get_env_config(self):
        return {
            "development": {
                "NODE_ENV": "development",
                "NEXT_PUBLIC_API_URL": f"http://localhost:{BACKEND_PORT}",
                "NEXT_PUBLIC_WS_URL": f"ws://localhost:{WEBSOCKET_PORT}/ws"
            },
            "production": {
                "NODE_ENV": "production",
                "NEXT_PUBLIC_API_URL": "https://api.manosaba.com",
                "NEXT_PUBLIC_WS_URL": "wss://api.manosaba.com/ws"
            }
        }
    
    def install(self):
        """执行项目安装"""
        print(f"🚀 安装 {DISPLAY_NAME}...")
        try:
            subprocess.run(INSTALL_COMMAND.split(), cwd=os.getcwd(), check=True)
            print("✅ 安装完成")
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ 安装失败: {e}")
            return False


# 主函数
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description=f"{DISPLAY_NAME} 配置脚本")
    parser.add_argument("--get-config", action="store_true", help="获取配置信息")
    parser.add_argument("--install", action="store_true", help="安装项目")
    parser.add_argument("--info", action="store_true", help="显示项目信息")
    
    args = parser.parse_args()
    config = ManosabaAIConfig()
    
    if args.get_config:
        print(json.dumps({
            "project": config.get_project_info(),
            "runtime": config.get_runtime_config(),
            "dependencies": config.get_dependencies(),
            "api": config.get_api_config(),
            "environment": config.get_env_config()
        }, indent=2, ensure_ascii=False))
    elif args.install:
        config.install()
    elif args.info:
        info = config.get_project_info()
        print(f"项目: {info['display_name']} ({info['name']})")
        print(f"类型: {info['type']}")
        print(f"端口: {FRONTEND_PORT}")
    else:
        parser.print_help()