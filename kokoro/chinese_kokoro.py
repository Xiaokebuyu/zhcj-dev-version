#!/usr/bin/env python3
"""
中文版Kokoro流式语音合成 - 完整音色测试版本
支持测试 Kokoro-82M-v1.1-zh 的所有中文音色（约100个）

使用前请确保安装了中文支持：
pip install "misaki[zh]"
"""

import os
import subprocess
import sys
from pathlib import Path
import wave
import numpy as np
from loguru import logger
import time

# 检查并安装中文支持
try:
    import misaki
    from misaki.langs.zh import preprocess
    logger.info("中文支持已安装")
except ImportError:
    logger.warning("未检测到中文支持，正在安装 misaki[zh]...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "misaki[zh]"])
    logger.info("中文支持安装完成")

# 设置镜像站
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

def generate_voice_sample(voice_id: str, text: str, output_dir: Path, speed: float = 1.0):
    """
    为指定声音生成语音样本
    
    Args:
        voice_id: 声音ID (如 'zf_001', 'zm_010')
        text: 要合成的文本
        output_dir: 输出目录
        speed: 语速
    
    Returns:
        bool: 是否成功生成
    """
    try:
        from kokoro import KPipeline
        
        # 使用中文增强版本
        pipeline = KPipeline(
            lang_code='z',  # 中文
            repo_id='hexgrad/Kokoro-82M-v1.1-zh'  # 中文增强版本
        )
        
        output_file = output_dir / f"{voice_id}_sample.wav"
        
        with wave.open(str(output_file), "wb") as wav_file:
            wav_file.setnchannels(1)  # 单声道
            wav_file.setsampwidth(2)  # 16位音频
            wav_file.setframerate(24000)  # 采样率
            
            chunk_count = 0
            for result in pipeline(text, voice=voice_id, speed=speed, split_pattern=r'[。！？\n]+'):
                chunk_count += 1
                
                if result.audio is not None:
                    audio_bytes = (result.audio.numpy() * 32767).astype(np.int16).tobytes()
                    wav_file.writeframes(audio_bytes)
        
        logger.success(f"✅ {voice_id}: 生成成功 ({chunk_count} 段) -> {output_file.name}")
        return True
        
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg or "Entry Not Found" in error_msg:
            logger.debug(f"⚪ {voice_id}: 不存在 (跳过)")
        else:
            logger.warning(f"⚠️ {voice_id}: 生成失败 - {error_msg}")
        return False

def test_all_chinese_female_voices():
    """测试所有中文女声"""
    
    test_text = "你好，我是小雅，很高兴为您提供语音服务。这是一个测试音频。"
    
    # 创建输出目录
    output_dir = Path("chinese_voices_samples")
    output_dir.mkdir(exist_ok=True)
    
    logger.info("🎵 开始测试所有中文女声...")
    logger.info(f"📁 音频文件将保存到: {output_dir}")
    logger.info(f"📝 测试文本: {test_text}")
    logger.info("=" * 60)
    
    successful_voices = []
    failed_voices = []
    
    # 测试女声范围 zf_001 到 zf_099
    total_tested = 0
    for i in range(1, 100):  # 1到99
        voice_id = f"zf_{i:03d}"  # 格式化为 zf_001, zf_002, ...
        total_tested += 1
        
        logger.info(f"🔄 测试第 {total_tested}/99 个: {voice_id}")
        
        if generate_voice_sample(voice_id, test_text, output_dir):
            successful_voices.append(voice_id)
        else:
            failed_voices.append(voice_id)
        
        # 小延迟，避免请求过于频繁
        time.sleep(0.5)
    
    # 输出统计结果
    logger.info("=" * 60)
    logger.success(f"🎉 测试完成！")
    logger.info(f"📊 总测试数量: {total_tested}")
    logger.info(f"✅ 成功生成: {len(successful_voices)} 个")
    logger.info(f"❌ 失败/不存在: {len(failed_voices)} 个")
    
    if successful_voices:
        logger.info(f"\n🎤 可用的中文女声:")
        for i, voice in enumerate(successful_voices, 1):
            logger.info(f"  {i}. {voice}")
    
    return successful_voices, failed_voices

def test_sample_male_voices():
    """测试部分中文男声样本"""
    
    test_text = "你好，我是云帆，很高兴为您提供语音服务。这是一个测试音频。"
    
    output_dir = Path("chinese_voices_samples")
    output_dir.mkdir(exist_ok=True)
    
    logger.info("\n🎵 开始测试部分中文男声...")
    
    successful_male_voices = []
    
    # 测试男声样本 zm_001 到 zm_020
    for i in range(1, 21):  # 测试前20个
        voice_id = f"zm_{i:03d}"
        
        logger.info(f"🔄 测试男声: {voice_id}")
        
        if generate_voice_sample(voice_id, test_text, output_dir):
            successful_male_voices.append(voice_id)
        
        time.sleep(0.5)
    
    logger.info(f"\n🎤 可用的中文男声样本:")
    for voice in successful_male_voices:
        logger.info(f"  - {voice}")
    
    return successful_male_voices

def create_voice_demo():
    """创建语音演示文件"""
    
    demo_text = """
    欢迎使用Kokoro中文语音合成系统！
    这是一个功能强大的开源语音合成模型。
    它支持流式处理，可以实现边生成边播放的效果。
    现在您听到的是中文增强版本，包含约一百个中文音色。
    感谢龙猫数据公司提供的专业中文数据集。
    """
    
    output_dir = Path("chinese_voices_samples")
    output_dir.mkdir(exist_ok=True)
    
    logger.info("\n🎭 创建语音演示...")
    
    # 使用一个已知存在的声音创建演示
    demo_voices = ["zf_001", "zm_001"]
    
    for voice_id in demo_voices:
        demo_file = output_dir / f"demo_{voice_id}.wav"
        logger.info(f"🎬 创建演示: {voice_id}")
        
        if generate_voice_sample(voice_id, demo_text.strip(), output_dir):
            logger.success(f"演示文件已创建: {demo_file}")

def main():
    """主函数"""
    
    print("🌟 Kokoro中文语音合成 - 完整音色测试工具")
    print("=" * 60)
    
    try:
        # 测试所有女声
        female_voices, failed_female = test_all_chinese_female_voices()
        
        # 测试部分男声
        male_voices = test_sample_male_voices()
        
        # 创建演示
        create_voice_demo()
        
        print("\n🎉 所有测试完成！")
        print(f"📁 所有音频文件保存在: chinese_voices_samples/")
        print(f"🎤 发现 {len(female_voices)} 个女声，{len(male_voices)} 个男声样本")
        print("\n💡 使用建议:")
        print("1. 播放 chinese_voices_samples/ 目录中的音频文件")
        print("2. 选择你喜欢的音色编号（如 zf_003, zm_010）")
        print("3. 在你的项目中使用这些音色ID")
        
        return True
        
    except Exception as e:
        logger.error(f"测试过程中出现严重错误: {e}")
        return False

if __name__ == "__main__":
    success = main()
    
    if not success:
        print("\n❌ 测试失败，请检查:")
        print("1. 网络连接是否正常")
        print("2. 是否正确设置了镜像站")
        print("3. 依赖包是否正确安装")
        sys.exit(1)