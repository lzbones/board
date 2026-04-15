#!/bin/bash
# 自动通过您的虚拟环境启动 QingBoard 服务
# 脚本内部已自动使用 0.0.0.0 及 16968 端口

echo "正在启动 QingBoard 服务..."
echo "访问地址: http://127.0.0.1:16968"
echo "---"

/home/qingxu/.ai-env/bin/python main.py
