#!/bin/bash

# Kokoro TTS Service 启动脚本

echo "🎤 启动 Kokoro TTS 服务..."

# 检查并创建日志目录
if [ ! -d "logs" ]; then
    mkdir -p logs
    echo "📁 创建日志目录"
fi

# 检查并激活虚拟环境
if [ -d "venv" ]; then
    echo "🔧 检测到虚拟环境，正在激活..."
    source venv/bin/activate
    PYTHON_CMD="python"
    echo "✅ 虚拟环境已激活"
elif [ -d ".venv" ]; then
    echo "🔧 检测到虚拟环境(.venv)，正在激活..."
    source .venv/bin/activate
    PYTHON_CMD="python"
    echo "✅ 虚拟环境已激活"
else
    echo "⚠️  未检测到虚拟环境，使用系统Python"
    # 检查Python环境
    if command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
    elif command -v python &> /dev/null; then
        PYTHON_CMD="python"
    else
        echo "❌ 未找到Python环境"
        exit 1
    fi
fi

echo "🐍 使用Python: $PYTHON_CMD"

# 检查是否已安装依赖
if ! $PYTHON_CMD -c "import kokoro" &> /dev/null; then
    echo "📦 安装依赖包..."
    $PYTHON_CMD -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 检查espeak-ng（kokoro的依赖）
if ! command -v espeak &> /dev/null; then
    echo "⚠️  警告: espeak-ng 未安装，可能影响某些功能"
    echo "💡 安装建议:"
    echo "   Ubuntu/Debian: sudo apt-get install espeak-ng"
    echo "   CentOS/RHEL:   sudo yum install espeak-ng"
    echo "   macOS:         brew install espeak"
fi

# 启动服务
echo "🚀 启动Kokoro TTS服务..."
echo "📍 服务地址: http://127.0.0.1:8001"
echo "📖 API文档: http://127.0.0.1:8001/docs"
echo ""

$PYTHON_CMD main.py