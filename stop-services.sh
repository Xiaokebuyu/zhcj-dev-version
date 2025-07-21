#!/bin/bash

# 停止服务脚本：停止Next.js应用和OpenManus API服务

echo "🛑 停止悬浮框助手 + OpenManus集成服务"
echo "================================================"

# 停止OpenManus API服务
if [ -f "logs/openmanus-api.pid" ]; then
    OPENMANUS_PID=$(cat logs/openmanus-api.pid)
    if ps -p $OPENMANUS_PID > /dev/null; then
        echo "🤖 停止OpenManus API服务 (PID: $OPENMANUS_PID)..."
        kill $OPENMANUS_PID
        sleep 2
        
        # 强制杀死进程（如果还在运行）
        if ps -p $OPENMANUS_PID > /dev/null; then
            echo "🔧 强制停止OpenManus API服务..."
            kill -9 $OPENMANUS_PID
        fi
        
        echo "✅ OpenManus API服务已停止"
    else
        echo "ℹ️  OpenManus API服务未运行"
    fi
    
    rm -f logs/openmanus-api.pid
else
    echo "ℹ️  未找到OpenManus API服务PID文件"
fi

# 停止可能的Python进程
echo "🧹 清理相关Python进程..."
pkill -f "openmanus-api-service/main.py" 2>/dev/null

# 停止可能的端口占用
echo "🔌 检查端口占用..."
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  端口8001仍被占用，尝试释放..."
    lsof -ti:8001 | xargs kill -9 2>/dev/null
fi

if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  端口3000仍被占用，尝试释放..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null
fi

echo "✅ 所有服务已停止"
echo "================================================"