#!/bin/bash

# 启动脚本：同时启动Next.js应用和OpenManus API服务

echo "🚀 启动悬浮框助手 + OpenManus集成服务"
echo "================================================"

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在ai-assistant目录下运行此脚本"
    exit 1
fi

# 检查OpenManus目录是否存在
if [ ! -d "OpenManus" ]; then
    echo "❌ 错误：未找到OpenManus目录"
    exit 1
fi

# 检查Python环境
PYTHON_PATH="OpenManus/.venv/bin/python"
if [ ! -f "$PYTHON_PATH" ]; then
    echo "⚠️  警告：未找到OpenManus Python虚拟环境，使用系统Python"
    PYTHON_PATH="python3"
fi

# 创建日志目录
mkdir -p logs

echo "📦 检查依赖..."

# 检查Node.js依赖
if [ ! -d "node_modules" ]; then
    echo "📥 安装Node.js依赖..."
    npm install
fi

# 检查OpenManus API服务依赖
if [ ! -d "openmanus-api-service/venv" ]; then
    echo "📥 创建OpenManus API服务Python环境..."
    cd openmanus-api-service
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
fi

echo "🔧 配置环境变量..."

# 检查必要的环境变量
if [ -z "$DEEPSEEK_API_KEY" ]; then
    echo "⚠️  警告：DEEPSEEK_API_KEY 环境变量未设置"
fi

if [ -z "$QWEATHER_API_KEY" ]; then
    echo "⚠️  警告：QWEATHER_API_KEY 环境变量未设置"
fi

if [ -z "$BOCHA_API_KEY" ]; then
    echo "⚠️  警告：BOCHA_API_KEY 环境变量未设置"
fi

# 设置OpenManus API URL
export OPENMANUS_API_URL="http://127.0.0.1:8001"

echo "🌟 启动服务..."

# 启动OpenManus API服务（后台运行）
echo "🤖 启动OpenManus API服务..."
cd openmanus-api-service
source venv/bin/activate
nohup uvicorn main:app --host 127.0.0.1 --port 8001 --reload > ../logs/openmanus-api.log 2>&1 &
OPENMANUS_PID=$!
cd ..

# 等待OpenManus API服务启动
echo "⏳ 等待OpenManus API服务启动..."
sleep 5

# 检查OpenManus API服务是否启动成功
if curl -s http://127.0.0.1:8001/api/health > /dev/null; then
    echo "✅ OpenManus API服务启动成功"
else
    echo "❌ OpenManus API服务启动失败"
    echo "📋 查看日志：tail -f logs/openmanus-api.log"
fi

# 保存PID
echo $OPENMANUS_PID > logs/openmanus-api.pid

echo "🌐 启动Next.js开发服务器..."
echo "================================================================"
echo "🎯 应用将在以下地址运行："
echo "   - 主应用: http://localhost:3000"
echo "   - 嵌入页面: http://localhost:3000/embed"
echo "   - OpenManus API: http://localhost:8001"
echo ""
echo "📋 服务状态："
echo "   - Next.js: 启动中..."
echo "   - OpenManus API: ✅ 运行中 (PID: $OPENMANUS_PID)"
echo ""
echo "🔧 使用说明："
echo "   - 直接在浏览器中访问主应用进行测试"
echo "   - 使用embed.js SDK集成到其他网站"
echo "   - OpenManus工具支持复杂任务处理"
echo ""
echo "🛑 停止服务："
echo "   - Ctrl+C 停止Next.js"
echo "   - kill $OPENMANUS_PID 停止OpenManus API"
echo "   - 或运行: ./stop-services.sh"
echo "================================================================"

# 启动Next.js开发服务器
npm run dev