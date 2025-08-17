#!/bin/bash

# Kokoro TTS Service 国内优化启动脚本
# 专为中国用户设计，包含网络优化和镜像配置

echo "🇨🇳 启动 Kokoro TTS 服务 (国内优化版)..."

# ============ 颜色定义 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============ 检查系统环境 ============
echo -e "${BLUE}🔍 检查系统环境...${NC}"

# 检查Python环境
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}❌ 未找到Python环境${NC}"
    exit 1
fi

echo -e "${GREEN}🐍 使用Python: $PYTHON_CMD${NC}"
$PYTHON_CMD --version

# ============ 创建必要目录 ============
echo -e "${BLUE}📁 创建缓存目录...${NC}"
mkdir -p cache/huggingface
mkdir -p cache/torch
mkdir -p logs

# ============ 设置国内镜像环境变量 ============
echo -e "${BLUE}🌐 配置国内镜像站...${NC}"

# HuggingFace镜像 (阿里云)
export HF_ENDPOINT="https://hf-mirror.com"
export HUGGINGFACE_HUB_CACHE="$(pwd)/cache/huggingface"
export HF_HOME="$(pwd)/cache/huggingface"
export HF_HUB_DISABLE_TELEMETRY=1

# PyTorch缓存
export TORCH_HOME="$(pwd)/cache/torch"

# 性能优化
export OMP_NUM_THREADS=4
export MKL_NUM_THREADS=4
export NUMEXPR_NUM_THREADS=4

# Kokoro优化配置
export KOKORO_SAMPLE_RATE=22050
export KOKORO_DEFAULT_SPEED=1.2
export KOKORO_CHUNK_DELAY=0.005
export KOKORO_MAX_CHUNK_LENGTH=30
export KOKORO_USE_CHINA_MIRRORS=true

echo -e "${GREEN}✅ 镜像配置完成${NC}"
echo "   HuggingFace: $HF_ENDPOINT"
echo "   缓存目录: $HUGGINGFACE_HUB_CACHE"

# ============ 网络连通性测试 ============
echo -e "${BLUE}🔌 测试网络连通性...${NC}"

test_connectivity() {
    local url=$1
    local name=$2
    
    if curl -s --connect-timeout 5 --max-time 10 "$url" > /dev/null; then
        echo -e "${GREEN}✅ $name 连接正常${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️ $name 连接失败${NC}"
        return 1
    fi
}

test_connectivity "https://hf-mirror.com" "HuggingFace镜像(阿里云)"
test_connectivity "https://pypi.tuna.tsinghua.edu.cn/simple" "PyPI镜像(清华)"

# ============ 检查并安装依赖 ============
echo -e "${BLUE}📦 检查依赖包...${NC}"

# 创建pip配置目录和文件
mkdir -p ~/.pip
cat > ~/.pip/pip.conf << EOF
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
timeout = 60

[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
EOF

echo -e "${GREEN}✅ pip配置已更新为清华镜像${NC}"

# 检查核心依赖
if ! $PYTHON_CMD -c "import kokoro" &> /dev/null; then
    echo -e "${YELLOW}📥 安装Kokoro TTS依赖包...${NC}"
    
    # 先安装基础依赖
    $PYTHON_CMD -m pip install --upgrade pip
    
    # 使用清华镜像安装依赖
    if ! $PYTHON_CMD -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt; then
        echo -e "${RED}❌ 依赖安装失败，尝试备用镜像...${NC}"
        
        # 尝试阿里云镜像
        if ! $PYTHON_CMD -m pip install -i https://mirrors.aliyun.com/pypi/simple -r requirements.txt; then
            echo -e "${RED}❌ 所有镜像安装失败${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}✅ 依赖安装完成${NC}"
else
    echo -e "${GREEN}✅ Kokoro TTS已安装${NC}"
fi

# ============ 检查系统依赖 ============
echo -e "${BLUE}🔧 检查系统依赖...${NC}"

if ! command -v espeak &> /dev/null; then
    echo -e "${YELLOW}⚠️ espeak-ng 未安装${NC}"
    echo -e "${BLUE}💡 安装建议:${NC}"
    echo "   Ubuntu/Debian: sudo apt-get install espeak-ng"
    echo "   CentOS/RHEL:   sudo yum install espeak-ng"
    echo "   macOS:         brew install espeak"
    echo ""
    echo -e "${YELLOW}📋 部分功能可能受限，建议安装后重启服务${NC}"
else
    echo -e "${GREEN}✅ espeak-ng 已安装${NC}"
    espeak --version | head -1
fi

# ============ 预下载模型 ============
echo -e "${BLUE}🤖 检查模型文件...${NC}"

if [ ! -d "cache/huggingface/models--hexgrad--Kokoro-82M-v1.1-zh" ]; then
    echo -e "${YELLOW}📥 首次运行，正在下载模型文件...${NC}"
    echo -e "${BLUE}💡 这可能需要几分钟时间，请耐心等待${NC}"
    
    # 使用Python预下载模型
    $PYTHON_CMD << EOF
import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
os.environ['HUGGINGFACE_HUB_CACHE'] = '$(pwd)/cache/huggingface'

try:
    from kokoro import KPipeline
    print("🔄 正在初始化模型...")
    pipeline = KPipeline(lang_code="z")
    print("✅ 模型下载完成")
except Exception as e:
    print(f"❌ 模型下载失败: {e}")
    exit(1)
EOF
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 模型准备完成${NC}"
    else
        echo -e "${RED}❌ 模型下载失败${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ 模型文件已存在${NC}"
fi

# ============ 启动服务 ============
echo -e "${GREEN}🚀 启动Kokoro TTS服务...${NC}"
echo -e "${BLUE}📍 服务地址: http://127.0.0.1:8001${NC}"
echo -e "${BLUE}📖 API文档: http://127.0.0.1:8001/docs${NC}"
echo -e "${BLUE}⚙️ 配置信息: http://127.0.0.1:8001/config${NC}"
echo ""
echo -e "${YELLOW}💡 提示: 按 Ctrl+C 停止服务${NC}"
echo ""

# 显示优化配置
echo -e "${BLUE}🔧 性能优化配置:${NC}"
echo "   采样率: 22050 Hz (降低延迟)"
echo "   默认语速: 1.2x (提升响应)"
echo "   块处理延迟: 5ms (平衡质量与速度)"
echo "   最大块长度: 30字符 (优化分句)"
echo ""

# 启动主服务
$PYTHON_CMD main.py

# ============ 服务退出处理 ============
echo ""
echo -e "${YELLOW}👋 Kokoro TTS服务已停止${NC}"
echo -e "${BLUE}💾 缓存文件保留在 cache/ 目录${NC}"
echo -e "${BLUE}📋 日志文件保存在 logs/ 目录${NC}"