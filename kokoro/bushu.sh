#!/bin/bash

# Kokoro TTS 一键部署脚本 (国内优化版)
# 自动配置国内镜像，优化网络访问

set -e  # 遇到错误立即退出

# ============ 配置变量 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="kokoro-tts-china"

# ============ 显示欢迎信息 ============
clear
echo -e "${PURPLE}=================================${NC}"
echo -e "${PURPLE}🇨🇳 Kokoro TTS 国内优化版部署脚本${NC}"
echo -e "${PURPLE}=================================${NC}"
echo ""
echo -e "${BLUE}✨ 特性:${NC}"
echo "   🌐 国内镜像站支持"
echo "   ⚡ 性能优化配置"
echo "   🎭 zf_001 专用语音"
echo "   🔧 自动环境配置"
echo ""

# ============ 检查系统 ============
echo -e "${BLUE}🔍 检查系统环境...${NC}"

# 检查操作系统
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="Linux"
    echo -e "${GREEN}✅ 操作系统: $OS${NC}"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
    echo -e "${GREEN}✅ 操作系统: $OS${NC}"
else
    echo -e "${RED}❌ 不支持的操作系统: $OSTYPE${NC}"
    exit 1
fi

# 检查Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python: $PYTHON_VERSION${NC}"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    PYTHON_VERSION=$(python --version | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python: $PYTHON_VERSION${NC}"
else
    echo -e "${RED}❌ 未找到Python环境${NC}"
    echo -e "${YELLOW}💡 请先安装Python 3.8+${NC}"
    exit 1
fi

# 检查Python版本
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)
if [[ $PYTHON_MAJOR -lt 3 ]] || [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -lt 8 ]]; then
    echo -e "${RED}❌ Python版本太低 (需要3.8+): $PYTHON_VERSION${NC}"
    exit 1
fi

# 检查网络连接
echo -e "${BLUE}🔌 测试网络连接...${NC}"
if curl -s --connect-timeout 5 https://hf-mirror.com > /dev/null; then
    echo -e "${GREEN}✅ 网络连接正常${NC}"
else
    echo -e "${YELLOW}⚠️ 网络连接可能有问题，但将继续安装${NC}"
fi

# ============ 选择部署方式 ============
echo ""
echo -e "${BLUE}🚀 选择部署方式:${NC}"
echo "1) 本地部署 (推荐)"
echo "2) Docker部署"
echo "3) 仅配置环境"
echo ""
read -p "请选择 (1-3): " DEPLOY_METHOD

case $DEPLOY_METHOD in
    1)
        echo -e "${GREEN}✅ 选择本地部署${NC}"
        DEPLOY_TYPE="local"
        ;;
    2)
        echo -e "${GREEN}✅ 选择Docker部署${NC}"
        DEPLOY_TYPE="docker"
        ;;
    3)
        echo -e "${GREEN}✅ 选择环境配置${NC}"
        DEPLOY_TYPE="config"
        ;;
    *)
        echo -e "${YELLOW}使用默认方式: 本地部署${NC}"
        DEPLOY_TYPE="local"
        ;;
esac

# ============ 创建项目目录 ============
echo ""
echo -e "${BLUE}📁 创建项目目录...${NC}"

# 如果不在kokoro-tts-service目录中，创建它
if [[ ! -f "main.py" ]]; then
    mkdir -p kokoro-tts-service
    cd kokoro-tts-service
    echo -e "${GREEN}✅ 创建目录: $(pwd)${NC}"
fi

# 创建子目录
mkdir -p cache/huggingface cache/torch logs

# ============ 配置国内镜像 ============
echo -e "${BLUE}🌐 配置国内镜像站...${NC}"

# 配置pip
mkdir -p ~/.pip
cat > ~/.pip/pip.conf << EOF
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
timeout = 120

[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
EOF

# 配置环境变量
cat > .env << EOF
# Kokoro TTS 国内优化环境配置
HF_ENDPOINT=https://hf-mirror.com
HUGGINGFACE_HUB_CACHE=$(pwd)/cache/huggingface
HF_HOME=$(pwd)/cache/huggingface
TORCH_HOME=$(pwd)/cache/torch
HF_HUB_DISABLE_TELEMETRY=1

# 性能优化
OMP_NUM_THREADS=4
MKL_NUM_THREADS=4
NUMEXPR_NUM_THREADS=4

# Kokoro配置
KOKORO_SAMPLE_RATE=22050
KOKORO_DEFAULT_SPEED=1.2
KOKORO_CHUNK_DELAY=0.005
KOKORO_MAX_CHUNK_LENGTH=30
KOKORO_USE_CHINA_MIRRORS=true
EOF

echo -e "${GREEN}✅ 镜像配置完成${NC}"

# ============ 根据部署方式执行 ============
case $DEPLOY_TYPE in
    "local")
        echo -e "${BLUE}📦 本地部署...${NC}"
        
        # 创建requirements.txt (如果不存在)
        if [[ ! -f "requirements.txt" ]]; then
            cat > requirements.txt << EOF
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
pydantic>=2.5.0
kokoro-tts>=0.1.0
numpy>=1.24.0
scipy>=1.10.0
torch>=2.0.0
torchaudio>=2.0.0
transformers>=4.30.0
huggingface-hub>=0.15.0
loguru>=0.7.0
python-multipart>=0.0.6
aiofiles>=23.0.0
psutil>=5.9.0
requests>=2.31.0
httpx>=0.24.0
EOF
        fi
        
        # 升级pip
        $PYTHON_CMD -m pip install --upgrade pip
        
        # 安装依赖
        echo -e "${BLUE}📥 安装Python依赖...${NC}"
        if $PYTHON_CMD -m pip install -r requirements.txt; then
            echo -e "${GREEN}✅ 依赖安装完成${NC}"
        else
            echo -e "${RED}❌ 依赖安装失败${NC}"
            exit 1
        fi
        
        # 安装系统依赖
        echo -e "${BLUE}🔧 检查系统依赖...${NC}"
        if [[ "$OS" == "Linux" ]]; then
            if command -v apt-get &> /dev/null; then
                sudo apt-get update && sudo apt-get install -y espeak-ng
            elif command -v yum &> /dev/null; then
                sudo yum install -y espeak-ng
            fi
        elif [[ "$OS" == "macOS" ]]; then
            if command -v brew &> /dev/null; then
                brew install espeak
            else
                echo -e "${YELLOW}⚠️ 请手动安装 Homebrew 后运行: brew install espeak${NC}"
            fi
        fi
        ;;
        
    "docker")
        echo -e "${BLUE}🐳 Docker部署...${NC}"
        
        # 检查Docker
        if ! command -v docker &> /dev/null; then
            echo -e "${RED}❌ 未找到Docker${NC}"
            echo -e "${YELLOW}💡 请先安装Docker${NC}"
            exit 1
        fi
        
        # 构建Docker镜像
        echo -e "${BLUE}🔨 构建Docker镜像...${NC}"
        if docker build -f Dockerfile.china -t $SERVICE_NAME:latest .; then
            echo -e "${GREEN}✅ Docker镜像构建完成${NC}"
        else
            echo -e "${RED}❌ Docker镜像构建失败${NC}"
            exit 1
        fi
        ;;
        
    "config")
        echo -e "${GREEN}✅ 环境配置完成${NC}"
        echo -e "${BLUE}💡 请手动安装依赖: pip install -r requirements.txt${NC}"
        ;;
esac

# ============ 创建启动脚本 ============
echo -e "${BLUE}📝 创建启动脚本...${NC}"

cat > start_service.sh << 'EOF'
#!/bin/bash
source .env
export $(grep -v '^#' .env | xargs)
python main.py
EOF

chmod +x start_service.sh

# 创建服务管理脚本
cat > manage.sh << 'EOF'
#!/bin/bash
case "$1" in
    start)
        echo "🚀 启动 Kokoro TTS 服务..."
        ./start_service.sh
        ;;
    stop)
        echo "🛑 停止 Kokoro TTS 服务..."
        pkill -f "python main.py" || echo "服务未运行"
        ;;
    restart)
        echo "🔄 重启 Kokoro TTS 服务..."
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if pgrep -f "python main.py" > /dev/null; then
            echo "✅ 服务正在运行"
            echo "📍 访问地址: http://127.0.0.1:8001"
        else
            echo "❌ 服务未运行"
        fi
        ;;
    *)
        echo "使用方法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
EOF

chmod +x manage.sh

# ============ 验证安装 ============
echo ""
echo -e "${BLUE}🔍 验证安装...${NC}"

if [[ "$DEPLOY_TYPE" == "local" ]]; then
    # 测试导入
    if $PYTHON_CMD -c "import fastapi, kokoro; print('✅ 核心模块导入成功')" 2>/dev/null; then
        echo -e "${GREEN}✅ 核心依赖验证通过${NC}"
    else
        echo -e "${RED}❌ 核心依赖验证失败${NC}"
    fi
fi

# ============ 完成安装 ============
echo ""
echo -e "${GREEN}🎉 安装完成！${NC}"
echo ""
echo -e "${BLUE}📋 使用说明:${NC}"

case $DEPLOY_TYPE in
    "local")
        echo "   启动服务: ./manage.sh start"
        echo "   停止服务: ./manage.sh stop"
        echo "   查看状态: ./manage.sh status"
        echo "   重启服务: ./manage.sh restart"
        ;;
    "docker")
        echo "   启动容器: docker run -d -p 8001:8001 --name kokoro-tts $SERVICE_NAME:latest"
        echo "   停止容器: docker stop kokoro-tts"
        echo "   查看日志: docker logs kokoro-tts"
        ;;
esac

echo ""
echo -e "${BLUE}🌐 服务地址:${NC}"
echo "   API服务: http://127.0.0.1:8001"
echo "   API文档: http://127.0.0.1:8001/docs"
echo "   健康检查: http://127.0.0.1:8001/health"
echo "   配置信息: http://127.0.0.1:8001/config"
echo ""
echo -e "${BLUE}💡 优化配置:${NC}"
echo "   🇨🇳 使用阿里云HuggingFace镜像"
echo "   📦 使用清华大学PyPI镜像"
echo "   ⚡ 采样率优化为22050Hz"
echo "   🎭 默认语音zf_001"
echo "   🚀 语速优化为1.2倍"
echo ""
echo -e "${YELLOW}🔔 提示: 首次启动会自动下载模型，请耐心等待${NC}"

# ============ 询问是否立即启动 ============
if [[ "$DEPLOY_TYPE" == "local" ]]; then
    echo ""
    read -p "是否立即启动服务? (y/N): " START_NOW
    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}🚀 正在启动服务...${NC}"
        ./manage.sh start
    fi
elif [[ "$DEPLOY_TYPE" == "docker" ]]; then
    echo ""
    read -p "是否立即启动Docker容器? (y/N): " START_NOW
    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}🚀 正在启动Docker容器...${NC}"
        docker run -d -p 8001:8001 --name kokoro-tts $SERVICE_NAME:latest
        echo -e "${GREEN}✅ 容器已启动${NC}"
    fi
fi

echo ""
echo -e "${PURPLE}感谢使用 Kokoro TTS 国内优化版！${NC}"