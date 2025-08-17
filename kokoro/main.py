"""
Kokoro TTS 独立流式服务 - 修复版本
解决huggingface_hub新版本兼容问题
"""

import asyncio
import io
import wave
import re
import os
import time
from typing import AsyncGenerator, Optional, List, Dict, Any
from pathlib import Path
import numpy as np
from loguru import logger
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid

# ============ 国内镜像站配置 ============
# 直接设置环境变量，避免API兼容问题
def setup_china_mirrors():
    """设置国内镜像站环境变量"""
    mirror_config = {
        # HuggingFace镜像 - 使用阿里云镜像
        'HF_ENDPOINT': 'https://hf-mirror.com',
        'HUGGINGFACE_HUB_CACHE': os.path.abspath('./cache/huggingface'),
        'HF_HOME': os.path.abspath('./cache/huggingface'),
        
        # PyTorch镜像
        'TORCH_HOME': os.path.abspath('./cache/torch'),
        
        # 禁用遥测
        'HF_HUB_DISABLE_TELEMETRY': '1',
        'DISABLE_TELEMETRY': '1',
        
        # 性能配置
        'OMP_NUM_THREADS': '4',
        'MKL_NUM_THREADS': '4',
        'NUMEXPR_NUM_THREADS': '4',
    }
    
    for key, value in mirror_config.items():
        os.environ[key] = value
        logger.info(f"🔧 设置环境变量: {key}={value}")

# 在模块加载时立即设置
setup_china_mirrors()

# 确保缓存目录存在
os.makedirs('./cache/huggingface', exist_ok=True)
os.makedirs('./cache/torch', exist_ok=True)
os.makedirs('./logs', exist_ok=True)

# 配置日志
logger.add("logs/kokoro_tts.log", rotation="10 MB", level="INFO")

class TTSRequest(BaseModel):
    text: str
    voice: str = "zf_001"  # 默认使用指定的语音
    speed: float = 1.2     # 默认稍微加快语速
    stream: bool = True    # 是否流式返回
    chunk_size: int = 30   # 文本分块大小

class TTSStatusResponse(BaseModel):
    success: bool
    message: str
    audio_length: Optional[float] = None
    processing_time: Optional[float] = None

class KokoroTTSService:
    """Kokoro TTS 核心服务类 - 修复版本"""
    
    def __init__(self):
        self.pipeline = None
        # 🔧 优化音频参数，提高生成速度
        self.sample_rate = int(os.getenv("KOKORO_SAMPLE_RATE", "22050"))
        self.channels = 1
        self.sample_width = 2
        self.max_chunk_length = int(os.getenv("KOKORO_MAX_CHUNK_LENGTH", "30"))
        self.chunk_delay = float(os.getenv("KOKORO_CHUNK_DELAY", "0.005"))
        self._initialize_pipeline()
    
    def _initialize_pipeline(self):
        """初始化Kokoro管道 - 修复版本"""
        try:
            logger.info("🚀 正在初始化Kokoro TTS管道...")
            
            # ✅ 修复：移除过时的constants设置，直接使用环境变量
            logger.info(f"📁 缓存目录: {os.environ.get('HUGGINGFACE_HUB_CACHE')}")
            logger.info(f"🌐 HF镜像: {os.environ.get('HF_ENDPOINT')}")
            
            # 导入并初始化Kokoro
            from kokoro import KPipeline
            self.pipeline = KPipeline(lang_code="z", repo_id="hexgrad/Kokoro-82M-v1.1-zh")  # 中文管道，明确指定模型
            logger.info("✅ Kokoro TTS 管道初始化成功")
            
        except ImportError as e:
            logger.error("❌ Kokoro 库未安装")
            logger.error("💡 请运行安装命令:")
            logger.error("   pip install -i https://pypi.tuna.tsinghua.edu.cn/simple kokoro-tts")
            raise
        except Exception as e:
            logger.error(f"❌ Kokoro TTS 初始化失败: {e}")
            logger.error("💡 详细错误信息:")
            logger.error(f"   错误类型: {type(e).__name__}")
            logger.error(f"   错误描述: {str(e)}")
            
            # 🔧 添加更详细的调试信息
            logger.info("🔍 环境检查:")
            logger.info(f"   Python版本: {os.sys.version}")
            logger.info(f"   工作目录: {os.getcwd()}")
            logger.info(f"   缓存目录存在: {os.path.exists('./cache/huggingface')}")
            
            # 尝试检查网络连接
            try:
                import requests
                response = requests.get(os.environ.get('HF_ENDPOINT', 'https://hf-mirror.com'), timeout=10)
                logger.info(f"   镜像连接状态: {response.status_code}")
            except Exception as net_e:
                logger.error(f"   网络连接失败: {net_e}")
            
            raise
    
    def _clean_text(self, text: str) -> str:
        """清理文本，移除markdown格式等"""
        # 移除代码块
        text = re.sub(r'```[\s\S]*?```', '', text)
        # 移除行内代码
        text = re.sub(r'`([^`]+)`', r'\1', text)
        # 移除粗体格式
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
        text = re.sub(r'__([^_]+)__', r'\1', text)
        # 移除斜体格式
        text = re.sub(r'\*([^*]+)\*', r'\1', text)
        text = re.sub(r'_([^_]+)_', r'\1', text)
        # 移除删除线
        text = re.sub(r'~~([^~]+)~~', r'\1', text)
        # 移除标题标记
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        # 移除引用标记
        text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
        # 移除列表标记
        text = re.sub(r'^[\s]*[-*+]\s+', '', text, flags=re.MULTILINE)
        text = re.sub(r'^[\s]*\d+\.\s+', '', text, flags=re.MULTILINE)
        # 移除链接，保留文本
        text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
        # 移除图片
        text = re.sub(r'!\[[^\]]*\]\([^)]+\)', '', text)
        # 移除HTML标签
        text = re.sub(r'<[^>]+>', '', text)
        # 移除表格分隔符
        text = re.sub(r'\|', ' ', text)
        # 清理多余空白
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def _split_into_chunks(self, text: str, max_length: int = None) -> List[str]:
        """将长文本分割为更小的块，提高生成速度"""
        if max_length is None:
            max_length = self.max_chunk_length
            
        # 首先按标点分割
        sentences = re.split(r'([。！？.!?])', text)
        chunks = []
        current_chunk = ""
        
        i = 0
        while i < len(sentences):
            sentence = sentences[i]
            if i + 1 < len(sentences) and sentences[i + 1] in '。！？.!?':
                sentence += sentences[i + 1]
                i += 2
            else:
                i += 1
            
            # 如果添加这句话会超过长度限制
            if len(current_chunk + sentence) > max_length and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
            else:
                current_chunk += sentence
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        # 如果单个句子仍然太长，按词分割
        final_chunks = []
        for chunk in chunks:
            if len(chunk) <= max_length:
                final_chunks.append(chunk)
            else:
                # 按逗号进一步分割
                sub_chunks = self._split_by_comma(chunk, max_length)
                final_chunks.extend(sub_chunks)
        
        return [chunk for chunk in final_chunks if chunk.strip()]
    
    def _split_by_comma(self, text: str, max_length: int) -> List[str]:
        """按逗号分割长句"""
        parts = re.split(r'([，,])', text)
        chunks = []
        current_chunk = ""
        
        i = 0
        while i < len(parts):
            part = parts[i]
            if i + 1 < len(parts) and parts[i + 1] in '，,':
                part += parts[i + 1]
                i += 2
            else:
                i += 1
            
            if len(current_chunk + part) > max_length and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = part
            else:
                current_chunk += part
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _create_wav_header(self, data_size: int = 0) -> bytes:
        """创建WAV文件头部"""
        header = io.BytesIO()
        
        # RIFF头部
        header.write(b'RIFF')
        header.write((36 + data_size).to_bytes(4, 'little'))
        header.write(b'WAVE')
        
        # fmt子块
        header.write(b'fmt ')
        header.write((16).to_bytes(4, 'little'))
        header.write((1).to_bytes(2, 'little'))
        header.write(self.channels.to_bytes(2, 'little'))
        header.write(self.sample_rate.to_bytes(4, 'little'))
        header.write((self.sample_rate * self.channels * self.sample_width).to_bytes(4, 'little'))
        header.write((self.channels * self.sample_width).to_bytes(2, 'little'))
        header.write((self.sample_width * 8).to_bytes(2, 'little'))
        
        # data子块头部
        header.write(b'data')
        header.write(data_size.to_bytes(4, 'little'))
        
        return header.getvalue()
    
    async def generate_streaming_audio(
        self, 
        text: str, 
        voice: str = "zf_001", 
        speed: float = 1.2,
        chunk_size: int = 30
    ) -> AsyncGenerator[bytes, None]:
        """生成流式音频数据 - 性能优化版本"""
        if not self.pipeline:
            logger.warning("⚠️ 管道未初始化，尝试重新初始化...")
            self._initialize_pipeline()
        
        start_time = time.time()
        
        try:
            # 清理文本
            clean_text = self._clean_text(text)
            
            if not clean_text.strip():
                logger.warning("⚠️ 清理后文本为空")
                return
            
            logger.info(f"🎙️ 开始生成语音 [voice: {voice}, speed: {speed}]: {clean_text[:50]}...")
            
            # 🔧 智能分块处理
            if len(clean_text) > chunk_size:
                chunks = self._split_into_chunks(clean_text, chunk_size)
                logger.debug(f"📦 文本分为 {len(chunks)} 块")
            else:
                chunks = [clean_text]
            
            # 先发送WAV头部
            yield self._create_wav_header(0)
            
            # 流式生成音频
            audio_generated = False
            total_audio_bytes = 0
            
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                
                logger.debug(f"🔊 处理第 {i+1}/{len(chunks)} 块: {chunk[:30]}...")
                
                try:
                    for result in self.pipeline(
                        chunk, 
                        voice=voice, 
                        speed=speed, 
                        split_pattern=r"[。！？.!?]+"
                    ):
                        if result.audio is None:
                            continue
                        
                        # 转换为16位PCM格式
                        audio_data = (result.audio.numpy() * 32767).astype(np.int16)
                        audio_bytes = audio_data.tobytes()
                        
                        total_audio_bytes += len(audio_bytes)
                        logger.debug(f"🎵 生成音频块: {len(audio_bytes)} 字节")
                        
                        yield audio_bytes
                        audio_generated = True
                        
                        # 优化延迟
                        await asyncio.sleep(self.chunk_delay)
                        
                except Exception as chunk_error:
                    logger.error(f"❌ 处理块 {i+1} 失败: {chunk_error}")
                    continue
            
            processing_time = time.time() - start_time
            
            if audio_generated:
                logger.info(f"✅ 语音生成完成: {total_audio_bytes} 字节, 耗时: {processing_time:.2f}秒")
            else:
                logger.warning("⚠️ 没有生成任何音频数据")
                
        except Exception as e:
            logger.error(f"❌ 音频生成失败: {e}")
            raise HTTPException(status_code=500, detail=f"音频生成失败: {str(e)}")

# 创建FastAPI应用
app = FastAPI(
    title="Kokoro TTS Service",
    description="专为虚拟主播AI设计的高性能流式语音合成服务 (修复版)",
    version="1.1.1"
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局TTS服务实例
tts_service = None

@app.on_event("startup")
async def startup_event():
    """应用启动时初始化TTS服务"""
    global tts_service
    try:
        logger.info("🚀 正在启动Kokoro TTS服务...")
        tts_service = KokoroTTSService()
        logger.info("✅ 服务启动成功")
    except Exception as e:
        logger.error(f"❌ 服务启动失败: {e}")
        # 不立即退出，允许服务启动但标记为不健康
        tts_service = None

@app.get("/")
async def root():
    """服务根路径"""
    return {
        "service": "Kokoro TTS",
        "version": "1.1.1 (修复版)",
        "status": "running" if tts_service else "degraded",
        "fixes": [
            "修复huggingface_hub兼容问题",
            "改进错误处理",
            "优化环境变量设置",
            "增强调试信息"
        ],
        "endpoints": {
            "tts_stream": "/tts/stream",
            "tts_file": "/tts/file",
            "health": "/health",
            "voices": "/voices",
            "config": "/config",
            "debug": "/debug"
        }
    }

@app.get("/debug")
async def debug_info():
    """调试信息接口"""
    import sys
    return {
        "python_version": sys.version,
        "working_directory": os.getcwd(),
        "environment_variables": {
            "HF_ENDPOINT": os.environ.get('HF_ENDPOINT'),
            "HUGGINGFACE_HUB_CACHE": os.environ.get('HUGGINGFACE_HUB_CACHE'),
            "HF_HOME": os.environ.get('HF_HOME'),
        },
        "cache_directories": {
            "huggingface_exists": os.path.exists('./cache/huggingface'),
            "torch_exists": os.path.exists('./cache/torch'),
            "logs_exists": os.path.exists('./logs'),
        },
        "service_status": {
            "pipeline_initialized": tts_service is not None and tts_service.pipeline is not None,
            "service_instance": tts_service is not None,
        }
    }

@app.get("/config")
async def get_config():
    """获取当前配置"""
    return {
        "sample_rate": tts_service.sample_rate if tts_service else "N/A",
        "max_chunk_length": tts_service.max_chunk_length if tts_service else "N/A",
        "chunk_delay": tts_service.chunk_delay if tts_service else "N/A",
        "mirror_sites": {
            "huggingface": os.getenv('HF_ENDPOINT'),
            "cache_dir": os.getenv('HUGGINGFACE_HUB_CACHE'),
        },
        "fixes_applied": [
            "huggingface_hub constants API修复",
            "环境变量直接设置",
            "启动时延迟初始化",
            "详细错误信息"
        ]
    }

@app.get("/health")
async def health_check():
    """健康检查"""
    try:
        service_working = tts_service is not None and tts_service.pipeline is not None
        
        health_status = {
            "status": "healthy" if service_working else "degraded",
            "tts_service": "available" if service_working else "unavailable",
            "initialization": "success" if service_working else "failed",
            "cache_dirs": {
                "huggingface": os.path.exists("./cache/huggingface"),
                "torch": os.path.exists("./cache/torch"),
                "logs": os.path.exists("./logs")
            },
            "environment": {
                "hf_endpoint": os.environ.get('HF_ENDPOINT'),
                "cache_configured": bool(os.environ.get('HUGGINGFACE_HUB_CACHE')),
            },
            "timestamp": time.time()
        }
        
        if service_working:
            health_status["performance"] = {
                "sample_rate": tts_service.sample_rate,
                "chunk_delay": tts_service.chunk_delay
            }
        
        return health_status
        
    except Exception as e:
        logger.error(f"健康检查失败: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": time.time()
        }

@app.get("/voices")
async def get_voices():
    """获取可用语音列表"""
    return {
        "voices": [
            {
                "id": "zf_001",
                "name": "zf_001",
                "description": "中文女声 (优化版)",
                "language": "zh-CN",
                "optimized": True,
                "available": tts_service is not None
            }
        ],
        "default_voice": "zf_001",
        "supported_languages": ["zh-CN"],
        "service_status": "available" if tts_service else "unavailable"
    }

@app.post("/tts/stream")
async def tts_stream(request: TTSRequest):
    """流式TTS接口"""
    if not tts_service:
        raise HTTPException(status_code=503, detail="TTS服务未就绪，请稍后重试")
    
    logger.info(f"收到流式TTS请求: voice={request.voice}, speed={request.speed}")
    
    try:
        audio_stream = tts_service.generate_streaming_audio(
            text=request.text,
            voice=request.voice,
            speed=request.speed,
            chunk_size=request.chunk_size
        )
        
        return StreamingResponse(
            audio_stream,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=speech.wav",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
                "X-TTS-Mode": "stream",
                "X-TTS-Voice": request.voice,
                "X-TTS-Speed": str(request.speed)
            }
        )
        
    except Exception as e:
        logger.error(f"流式TTS失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts/file")
async def tts_file(request: TTSRequest):
    """文件TTS接口"""
    if not tts_service:
        raise HTTPException(status_code=503, detail="TTS服务未就绪，请稍后重试")
    
    logger.info(f"收到文件TTS请求: voice={request.voice}, speed={request.speed}")
    
    try:
        # 收集所有音频数据
        audio_chunks = []
        async for chunk in tts_service.generate_streaming_audio(
            text=request.text,
            voice=request.voice,
            speed=request.speed,
            chunk_size=request.chunk_size
        ):
            audio_chunks.append(chunk)
        
        if not audio_chunks:
            raise HTTPException(status_code=500, detail="没有生成任何音频数据")
        
        # 合并所有音频数据
        complete_audio = b''.join(audio_chunks)
        
        return Response(
            content=complete_audio,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=speech.wav",
                "Content-Length": str(len(complete_audio)),
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
                "X-TTS-Mode": "file",
                "X-TTS-Voice": request.voice,
                "X-TTS-Speed": str(request.speed)
            }
        )
        
    except Exception as e:
        logger.error(f"文件TTS失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 启动参数
if __name__ == "__main__":
    logger.info("🚀 启动 Kokoro TTS 服务 (修复版)")
    logger.info(f"📁 HuggingFace缓存: {os.getenv('HUGGINGFACE_HUB_CACHE')}")
    logger.info(f"🌐 HuggingFace镜像: {os.getenv('HF_ENDPOINT')}")
    
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,
        reload=False,  # 修复版本建议禁用reload
        log_level="info"
    )