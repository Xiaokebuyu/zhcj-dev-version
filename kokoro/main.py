import os
import sys
import time
import asyncio
import io
import re
import numpy as np
from typing import AsyncGenerator, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger
import torch

# 配置日志
logger.remove()
logger.add(
    sink=sys.stdout,
    level="INFO",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | <level>{message}</level>",
    colorize=True
)

# 环境配置优化
os.environ['HF_ENDPOINT'] = os.getenv('HF_ENDPOINT', 'https://hf-mirror.com')
os.environ['HUGGINGFACE_HUB_CACHE'] = os.getenv('HUGGINGFACE_HUB_CACHE', './cache/huggingface')

class TTSRequest(BaseModel):
    text: str
    voice: str = "zf_001"
    speed: float = 1.0
    stream: bool = True
    chunk_size: int = 50  # 增加chunk_size以减少不必要的分割

class KokoroTTSService:
    """Kokoro TTS 核心服务类 - 完全修复版本"""
    
    def __init__(self):
        self.model = None
        self.zh_pipeline = None
        self.en_pipeline = None
        
        # ✅ 使用官方标准配置
        self.sample_rate = 24000  # 官方标准采样率
        self.channels = 1
        self.sample_width = 2
        self.chunk_delay = 0.003  # 优化延迟
        
        # 设备配置
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        logger.info(f"🔧 使用设备: {self.device}")
        
        self._initialize_pipeline()
    
    def _initialize_pipeline(self):
        """完整初始化Kokoro管道 - 实用健壮版本"""
        try:
            logger.info("🚀 正在初始化Kokoro TTS管道...")
            
            # 导入Kokoro组件
            from kokoro import KModel, KPipeline
            
            # 模型配置
            repo_id = 'hexgrad/Kokoro-82M-v1.1-zh'
            
            # ✅ 完整的模型初始化（按官方方式）
            logger.info("📦 加载模型...")
            self.model = KModel(repo_id=repo_id).to(self.device).eval()
            
            # ✅ 尝试初始化英文管道（可选，失败不影响主功能）
            logger.info("🔤 初始化英文管道...")
            try:
                self.en_pipeline = KPipeline(lang_code='a', repo_id=repo_id, model=False)
                logger.info("✅ 英文管道初始化成功")
                has_en_pipeline = True
            except Exception as e:
                logger.warning(f"⚠️ 英文管道初始化失败: {e}")
                logger.info("💡 将使用简化的英文处理，不影响主要功能")
                self.en_pipeline = None
                has_en_pipeline = False
            
            # ✅ 初始化中文管道（适应性版本）
            logger.info("🈳 初始化中文管道...")
            if has_en_pipeline:
                # 使用完整版本（包含英文处理）
                self.zh_pipeline = KPipeline(
                    lang_code='z', 
                    repo_id=repo_id, 
                    model=self.model, 
                    en_callable=self._en_callable
                )
                logger.info("✅ 中文管道初始化完成（包含英文支持）")
            else:
                # 使用简化版本（纯中文）
                self.zh_pipeline = KPipeline(
                    lang_code='z', 
                    repo_id=repo_id, 
                    model=self.model
                )
                logger.info("✅ 中文管道初始化完成（纯中文模式）")
            
            logger.info("✅ Kokoro TTS 管道初始化完成")
            
        except ImportError as e:
            logger.error("❌ Kokoro 库未安装")
            logger.error("💡 请运行安装命令:")
            logger.error("   pip install kokoro>=0.8.2 \"misaki[zh]>=0.8.2\"")
            raise
        except Exception as e:
            logger.error(f"❌ Kokoro TTS 初始化失败: {e}")
            raise
    
    def _en_callable(self, text: str) -> str:
        """处理中英文混合的英文部分 - 适应性版本"""
        try:
            # 特殊词汇处理
            special_words = {
                'Kokoro': 'kˈOkəɹO',
                'AI': 'ˌeɪˈaɪ',
                'ai': 'ˌeɪˈaɪ',
                'TTS': 'tˌiːtˌiːˈɛs',
                'API': 'ˌeɪpˌiːˈaɪ',
                'GPU': 'dʒˌiːpˌiːˈuː',
                'CPU': 'sˌiːpˌiːˈuː',
                'HTTP': 'ˌeɪtʃtˌiːtˌiːˈpiː',
                'JSON': 'dʒˈeɪsən',
                'OK': 'oʊˈkeɪ',
                'USB': 'jˌuːɛsˈbiː'
            }
            
            if text in special_words:
                return special_words[text]
            
            # 如果有英文管道，使用它
            if self.en_pipeline is not None:
                return next(self.en_pipeline(text)).phonemes
            else:
                # 简化处理：对于简单英文，直接返回
                # 这不是完美的，但对于大多数场景足够了
                logger.debug(f"简化英文处理: '{text}'")
                return text.lower()
                
        except Exception as e:
            logger.warning(f"英文处理失败 '{text}': {e}")
            return text
    
    def _speed_callable(self, len_ps: int) -> float:
        """动态语速控制 - 解决长文本rushing问题"""
        # 基础语速
        base_speed = 1.0
        
        # 根据音素长度动态调整
        if len_ps <= 50:
            speed = base_speed
        elif len_ps <= 100:
            # 短句保持正常语速
            speed = base_speed * 0.95
        elif len_ps <= 150:
            # 中等长度稍微减速
            speed = base_speed * 0.9
        else:
            # 长句显著减速以提高清晰度
            speed = base_speed * 0.8
        
        # 对话场景优化：稍微加速以显得更自然
        return speed * 1.1
    
    def _clean_text(self, text: str) -> str:
        """优化文本清理，保持对话自然性"""
        if not text:
            return ""
        
        # 清理多余空白
        text = re.sub(r'\s+', ' ', text.strip())
        
        # 处理表情符号（转换为语调提示）
        emoji_patterns = {
            '😊': '，',  # 微笑转为短暂停顿
            '😄': '！',  # 开心转为感叹
            '😢': '...',  # 难过转为省略
            '❤️': '，',  # 爱心转为温柔停顿
            '👍': '，很好，',  # 点赞转为肯定语气
            '🤔': '，嗯，',  # 思考转为思考语气
        }
        
        for emoji, replacement in emoji_patterns.items():
            text = text.replace(emoji, replacement)
        
        # 移除剩余的emoji
        text = re.sub(r'[^\w\s\u4e00-\u9fff，。！？：；""''（）【】《》、.!?:;"\'()\-\[\]<>]', '', text)
        
        return text
    
    def _smart_split_text(self, text: str, max_chunk_size: int = 50) -> list:
        """智能文本分割 - 保持语义完整性"""
        if len(text) <= max_chunk_size:
            return [text]
        
        chunks = []
        
        # 首先按段落分割
        paragraphs = re.split(r'\n\s*\n', text)
        
        for paragraph in paragraphs:
            if not paragraph.strip():
                continue
            
            # 按句子分割
            sentences = re.split(r'([。！？.!?]+)', paragraph)
            current_chunk = ""
            
            i = 0
            while i < len(sentences):
                sentence = sentences[i]
                punct = sentences[i + 1] if i + 1 < len(sentences) else ""
                full_sentence = sentence + punct
                
                # 如果当前句子太长，按逗号分割
                if len(full_sentence) > max_chunk_size:
                    sub_parts = re.split(r'([，,、])', full_sentence)
                    current_sub_chunk = ""
                    
                    for j in range(0, len(sub_parts), 2):
                        part = sub_parts[j]
                        delimiter = sub_parts[j + 1] if j + 1 < len(sub_parts) else ""
                        full_part = part + delimiter
                        
                        if len(current_sub_chunk + full_part) <= max_chunk_size:
                            current_sub_chunk += full_part
                        else:
                            if current_sub_chunk.strip():
                                chunks.append(current_sub_chunk.strip())
                            current_sub_chunk = full_part
                    
                    if current_sub_chunk.strip():
                        chunks.append(current_sub_chunk.strip())
                
                # 正常长度的句子
                elif len(current_chunk + full_sentence) <= max_chunk_size:
                    current_chunk += full_sentence
                else:
                    if current_chunk.strip():
                        chunks.append(current_chunk.strip())
                    current_chunk = full_sentence
                
                i += 2
            
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
        
        return [chunk for chunk in chunks if chunk.strip()]
    
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
        speed: Optional[float] = None,
        chunk_size: int = 50
    ) -> AsyncGenerator[bytes, None]:
        """生成流式音频数据 - 完全优化版本"""
        if not self.zh_pipeline:
            logger.warning("⚠️ 管道未初始化，尝试重新初始化...")
            self._initialize_pipeline()
        
        start_time = time.time()
        
        try:
            # 清理文本
            clean_text = self._clean_text(text)
            
            if not clean_text.strip():
                logger.warning("⚠️ 清理后文本为空")
                return
            
            logger.info(f"🎙️ 开始生成语音 [voice: {voice}]: {clean_text[:50]}...")
            
            # ✅ 智能分块处理
            chunks = self._smart_split_text(clean_text, chunk_size)
            logger.debug(f"📦 文本智能分为 {len(chunks)} 块")
            
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
                    # 使用动态语速或指定语速
                    chunk_speed = speed if speed is not None else self._speed_callable
                    
                    # ✅ 使用完整的管道生成音频
                    generator = self.zh_pipeline(
                        chunk, 
                        voice=voice, 
                        speed=chunk_speed
                    )
                    
                    for result in generator:
                        if result.audio is None:
                            continue
                        
                        # 转换为16位PCM格式
                        audio_data = (result.audio.cpu().numpy() * 32767).astype(np.int16)
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

# 全局TTS服务实例
tts_service = None

async def startup_event():
    """应用启动时初始化TTS服务"""
    global tts_service
    try:
        logger.info("🚀 正在启动Kokoro TTS服务...")
        tts_service = KokoroTTSService()
        logger.info("✅ 服务启动成功")
    except Exception as e:
        logger.error(f"❌ 服务启动失败: {e}")
        tts_service = None

# 创建FastAPI应用
app = FastAPI(
    title="Kokoro TTS Service",
    description="专为虚拟主播AI设计的高质量流式语音合成服务 (完全优化版)",
    version="2.0.0"
)

# 添加启动事件
@app.on_event("startup")
async def on_startup():
    await startup_event()

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """服务根路径"""
    return {
        "service": "Kokoro TTS",
        "version": "2.0.0 (完全优化版)",
        "status": "running" if tts_service else "degraded",
        "optimizations": [
            "24kHz 采样率",
            "完整模型初始化",
            "动态语速控制",
            "智能文本分割",
            "中英文混合处理",
            "对话语调优化"
        ]
    }

@app.get("/health")
async def health_check():
    """健康检查接口"""
    try:
        service_working = tts_service is not None and tts_service.zh_pipeline is not None
        
        health_status = {
            "status": "healthy" if service_working else "unhealthy",
            "initialization": "success" if service_working else "failed",
            "model_loaded": tts_service.model is not None if tts_service else False,
            "device": tts_service.device if tts_service else "unknown",
            "sample_rate": tts_service.sample_rate if tts_service else 0,
            "timestamp": time.time()
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
                "description": "中文女声 (官方优化版)",
                "language": "zh-CN",
                "optimized": True,
                "available": tts_service is not None
            },
            {
                "id": "zf_002", 
                "name": "zf_002",
                "description": "中文女声 (备选)",
                "language": "zh-CN",
                "optimized": True,
                "available": tts_service is not None
            }
        ],
        "default_voice": "zf_001",
        "supported_languages": ["zh-CN", "en-US (混合)"],
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
                "X-TTS-Speed": str(request.speed),
                "X-TTS-Optimized": "true"
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
                "X-TTS-Speed": str(request.speed),
                "X-TTS-Optimized": "true"
            }
        )
        
    except Exception as e:
        logger.error(f"文件TTS失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 启动参数
if __name__ == "__main__":
    logger.info("🚀 启动 Kokoro TTS 服务 (完全优化版)")
    logger.info(f"📁 HuggingFace缓存: {os.getenv('HUGGINGFACE_HUB_CACHE')}")
    logger.info(f"🌐 HuggingFace镜像: {os.getenv('HF_ENDPOINT')}")
    
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,
        reload=False,
        log_level="info"
    )