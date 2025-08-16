import asyncio
import io
import wave
import re
from typing import AsyncGenerator, Optional, List
from pathlib import Path
import numpy as np
from loguru import logger
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid
import time
import os
import requests
import urllib3
from config import config  # 🔧 导入配置

# 禁用SSL警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 配置多个镜像站备选方案
HF_ENDPOINTS = [
    'https://hf-mirror.com',
    'https://huggingface.co',
    'https://hf-mirror.com.cn'
]

def setup_hf_endpoint():
    """设置可用的Hugging Face镜像站"""
    for endpoint in HF_ENDPOINTS:
        try:
            # 测试连接
            response = requests.get(f"{endpoint}/api/models", timeout=10, verify=False)
            if response.status_code == 200:
                os.environ['HF_ENDPOINT'] = endpoint
                logger.info(f"✅ 使用镜像站: {endpoint}")
                return endpoint
        except Exception as e:
            logger.warning(f"⚠️ 镜像站 {endpoint} 连接失败: {e}")
            continue
    
    # 如果所有镜像站都失败，使用默认的
    os.environ['HF_ENDPOINT'] = 'https://huggingface.co'
    logger.warning("⚠️ 所有镜像站连接失败，使用默认站点")
    return 'https://huggingface.co'

# 初始化镜像站
setup_hf_endpoint()

# 配置日志
logger.add("logs/kokoro_tts.log", rotation="10 MB", level="INFO")

class TTSRequest(BaseModel):
    text: str
    voice: str = config.DEFAULT_VOICE  # 🔧 使用配置文件中的默认语音
    speed: float = config.DEFAULT_SPEED  # 🔧 使用配置文件中的默认语速
    stream: bool = True    # 是否流式返回
    
class TTSStatusResponse(BaseModel):
    success: bool
    message: str
    audio_length: Optional[float] = None
    processing_time: Optional[float] = None

class KokoroTTSService:
    """Kokoro TTS 核心服务类"""
    
    def __init__(self):
        self.pipeline = None
        # 🔧 使用配置文件中的优化参数
        self.sample_rate = config.SAMPLE_RATE
        self.channels = config.CHANNELS
        self.sample_width = config.SAMPLE_WIDTH
        self._initialize_pipeline()
    
    def _initialize_pipeline(self, max_retries: int = 3):
        """初始化Kokoro管道，支持重试和镜像站切换"""
        for attempt in range(max_retries):
            try:
                from kokoro import KPipeline
                
                # 尝试不同的模型配置
                pipeline_configs = [
                    {"lang_code": "z", "repo_id": "hexgrad/Kokoro-82M-v1.1-zh"},  # 默认版本
                ]
                
                for config in pipeline_configs:
                    try:
                        logger.info(f"🔄 尝试初始化管道 (尝试 {attempt + 1}/{max_retries}): {config}")
                        self.pipeline = KPipeline(**config)
                        logger.info("✅ Kokoro TTS 管道初始化成功")
                        return
                    except Exception as config_error:
                        logger.warning(f"⚠️ 配置 {config} 失败: {config_error}")
                        continue
                
                # 如果所有配置都失败，抛出异常
                raise Exception("所有管道配置都失败")
                
            except ImportError as e:
                logger.error("❌ Kokoro 库未安装，请运行: pip install kokoro-tts")
                logger.error(f"详细错误: {e}")
                raise
            except Exception as e:
                logger.error(f"❌ Kokoro TTS 初始化失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                
                if attempt < max_retries - 1:
                    # 尝试切换镜像站
                    logger.info("🔄 尝试切换镜像站...")
                    setup_hf_endpoint()
                    time.sleep(2)  # 等待2秒后重试
                else:
                    logger.error("❌ 所有重试都失败，请检查网络连接")
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
    
    def _create_wav_header(self, data_size: int = 0) -> bytes:
        """创建WAV文件头部"""
        header = io.BytesIO()
        
        # RIFF头部
        header.write(b'RIFF')
        header.write((36 + data_size).to_bytes(4, 'little'))  # 文件大小
        header.write(b'WAVE')
        
        # fmt子块
        header.write(b'fmt ')
        header.write((16).to_bytes(4, 'little'))  # fmt子块大小
        header.write((1).to_bytes(2, 'little'))   # 音频格式（PCM）
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
        speed: float = None  # 🔧 使用配置文件中的默认值
    ) -> AsyncGenerator[bytes, None]:
        # 🔧 使用配置文件中的默认语速
        if speed is None:
            speed = config.DEFAULT_SPEED
        """生成流式音频数据"""
        if not self.pipeline:
            self._initialize_pipeline()
        
        start_time = time.time()
        
        try:
            # 清理文本
            clean_text = self._clean_text(text)
            
            if not clean_text.strip():
                logger.warning("⚠️ 清理后文本为空")
                return
            
            logger.info(f"🎙️ 开始生成语音 [voice: {voice}, speed: {speed}]: {clean_text[:50]}...")
            
            # 🔧 分块处理策略：使用配置文件中的参数
            if len(clean_text) > 50:
                chunks = self._split_into_chunks(clean_text, max_length=config.MAX_CHUNK_LENGTH)
            else:
                chunks = [clean_text]
            
            # 先发送WAV头部
            yield self._create_wav_header(0)
            
            # 流式生成音频
            audio_generated = False
            total_audio_bytes = 0
            
            for chunk in chunks:
                if not chunk.strip():
                    continue
                    
                # 🔧 单个chunk的快速生成
                for result in self.pipeline(
                    chunk, 
                    voice=voice, 
                    speed=speed, 
                    split_pattern=r"[。！？.!?]"  # 更简单的分割
                ):
                    if result.audio is None:
                        continue
                    
                    # 转换为16位PCM格式
                    audio_data = (result.audio.numpy() * 32767).astype(np.int16)
                    audio_bytes = audio_data.tobytes()
                    
                    total_audio_bytes += len(audio_bytes)
                    logger.debug(f"🔊 生成音频块: {len(audio_bytes)} 字节")
                    
                    yield audio_bytes
                    audio_generated = True
                    
                    # 🔧 使用配置文件中的延迟参数
                    await asyncio.sleep(config.STREAMING_CHUNK_DELAY)
            
            processing_time = time.time() - start_time
            
            if audio_generated:
                logger.info(f"✅ 语音生成完成: {total_audio_bytes} 字节, 耗时: {processing_time:.2f}秒")
            else:
                logger.warning("⚠️ 没有生成任何音频数据")
                
        except Exception as e:
            logger.error(f"❌ 音频生成失败: {e}")
            raise HTTPException(status_code=500, detail=f"音频生成失败: {str(e)}")
    
    def _split_into_chunks(self, text: str, max_length: int = 30) -> List[str]:
        """将长文本分割为更小的块"""
        words = text.split()
        chunks = []
        current_chunk = []
        current_length = 0
        
        for word in words:
            if current_length + len(word) > max_length and current_chunk:
                chunks.append(' '.join(current_chunk))
                current_chunk = [word]
                current_length = len(word)
            else:
                current_chunk.append(word)
                current_length += len(word) + 1
        
        if current_chunk:
            chunks.append(' '.join(current_chunk))
            
        return chunks

# 创建FastAPI应用
app = FastAPI(
    title="Kokoro TTS Service",
    description="专为虚拟主播AI设计的高性能流式语音合成服务",
    version="1.0.0"
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局TTS服务实例
tts_service = KokoroTTSService()

@app.get("/")
async def root():
    """服务根路径"""
    return {
        "service": "Kokoro TTS",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "tts_stream": "/tts/stream",
            "tts_file": "/tts/file",
            "health": "/health",
            "voices": "/voices"
        }
    }

@app.get("/health")
async def health_check():
    """健康检查"""
    try:
        # 简单测试TTS服务
        test_working = tts_service.pipeline is not None
        
        return {
            "status": "healthy" if test_working else "degraded",
            "tts_service": "available" if test_working else "unavailable",
            "timestamp": time.time()
        }
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
                "description": "中文女声",
                "language": "zh-CN"
            }
            # 可以根据需要添加更多语音
        ]
    }

@app.post("/tts/stream")
async def tts_stream(request: TTSRequest):
    """流式TTS接口 - 实时返回音频流"""
    logger.info(f"收到流式TTS请求: voice={request.voice}, speed={request.speed}")
    
    try:
        audio_stream = tts_service.generate_streaming_audio(
            text=request.text,
            voice=request.voice,
            speed=request.speed
        )
        
        return StreamingResponse(
            audio_stream,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=speech.wav",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"流式TTS失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts/file")
async def tts_file(request: TTSRequest):
    """文件TTS接口 - 生成完整的音频文件后返回"""
    logger.info(f"收到文件TTS请求: voice={request.voice}, speed={request.speed}")
    
    try:
        # 收集所有音频数据
        audio_chunks = []
        async for chunk in tts_service.generate_streaming_audio(
            text=request.text,
            voice=request.voice,
            speed=request.speed
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
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"文件TTS失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 启动参数
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,  # 避免与现有服务冲突
        reload=True,
        log_level="info"
    )