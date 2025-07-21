import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface TTSRequest {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
}

// 支持的中文语音列表
const CHINESE_VOICES = {
  'xiaoxiao': 'zh-CN-XiaoxiaoNeural',     // 温柔女声
  'xiaoyi': 'zh-CN-XiaoyiNeural',         // 活泼女声
  'yunjian': 'zh-CN-YunjianNeural',       // 成熟男声
  'yunxi': 'zh-CN-YunxiNeural',           // 年轻男声
  'xiaomo': 'zh-CN-XiaomoNeural',         // 甜美女声
  'xiaoxuan': 'zh-CN-XiaoxuanNeural',     // 知性女声
};

// 清理markdown格式，只保留纯文本内容
function cleanMarkdown(text: string): string {
  return text
    // 移除代码块 ```code```
    .replace(/```[\s\S]*?```/g, '')
    // 移除行内代码 `code`
    .replace(/`([^`]+)`/g, '$1')
    // 移除粗体 **text** 或 __text__
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // 移除斜体 *text* 或 _text_
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 移除删除线 ~~text~~
    .replace(/~~([^~]+)~~/g, '$1')
    // 移除标题标记 # ## ### 等
    .replace(/^#{1,6}\s+/gm, '')
    // 移除引用标记 >
    .replace(/^>\s*/gm, '')
    // 移除列表标记 - * +
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // 移除有序列表标记 1. 2. 等
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 移除链接 [text](url) 只保留text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除图片 ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // 移除HTML标签
    .replace(/<[^>]+>/g, '')
    // 移除水平分割线 --- 或 ***
    .replace(/^[-*]{3,}$/gm, '')
    // 移除表格分隔符 |
    .replace(/\|/g, ' ')
    // 清理多余的空白字符
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const { text, voice = 'xiaoxiao', rate = '0%', pitch = '0%', volume = '0%' }: TTSRequest = await request.json();

    // 验证请求数据
    if (!text || text.trim() === '') {
      return NextResponse.json(
        { error: '文本内容不能为空' },
        { status: 400 }
      );
    }

    // 限制文本长度（防止滥用）
    if (text.length > 2000) {
      return NextResponse.json(
        { error: '文本长度不能超过2000字符' },
        { status: 400 }
      );
    }

    // 清理markdown格式，只保留纯文本
    const cleanText = cleanMarkdown(text);

    // 获取语音名称
    const voiceName = CHINESE_VOICES[voice as keyof typeof CHINESE_VOICES] || CHINESE_VOICES.xiaoxiao;

    // 生成临时文件名
    const audioId = uuidv4();
    const tempDir = path.join(process.cwd(), 'temp');
    const audioPath = path.join(tempDir, `${audioId}.mp3`);

    // 确保临时目录存在
    try {
      await fs.access(tempDir);
    } catch {
      await fs.mkdir(tempDir, { recursive: true });
    }

    // 转换参数格式为edge-tts支持的格式
    const convertRate = (rate: string) => {
      const numericRate = parseFloat(rate.replace('%', ''));
      if (numericRate > 0) return `+${numericRate}%`;
      if (numericRate < 0) return `${numericRate}%`;
      return '+0%';
    };

    const convertPitch = (pitch: string) => {
      // pitch 参数需要Hz格式，将百分比转换为Hz
      const numericPitch = parseFloat(pitch.replace('%', ''));
      // 将百分比转换为Hz（大致的映射关系）
      const pitchHz = Math.round(numericPitch * 2); // 简单的映射：1% ≈ 2Hz
      if (pitchHz > 0) return `+${pitchHz}Hz`;
      if (pitchHz < 0) return `${pitchHz}Hz`;
      return '+0Hz';
    };

    const convertVolume = (volume: string) => {
      const numericVolume = parseFloat(volume.replace('%', ''));
      if (numericVolume > 0) return `+${numericVolume}%`;
      if (numericVolume < 0) return `${numericVolume}%`;
      return '+0%';
    };

    // 调用edge-tts生成语音（使用命令行参数控制语音属性）
    const edgeTtsPath = path.join(process.cwd(), 'venv', 'bin', 'edge-tts');
    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      // 构建命令参数
      const args = [
        '--voice', voiceName,
        '--write-media', audioPath,
        '--text', cleanText,  // 传递清理后的纯文本
        '--rate', convertRate(rate),
        '--pitch', convertPitch(pitch),
        '--volume', convertVolume(volume)
      ];

      const process = spawn(edgeTtsPath, args);

      let errorOutput = '';

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: errorOutput || '语音生成失败' });
        }
      });

      process.on('error', (error) => {
        resolve({ success: false, error: `进程错误: ${error.message}` });
      });
    });

    if (!result.success) {
      console.error('Edge-TTS 错误:', result.error);
      return NextResponse.json(
        { error: '语音生成失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 读取生成的音频文件
    const audioBuffer = await fs.readFile(audioPath);

    // 清理临时文件
    try {
      await fs.unlink(audioPath);
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }

    // 返回音频文件
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
        'Access-Control-Allow-Origin': '*', // 允许跨域访问
      },
    });

  } catch (error) {
    console.error('TTS API 错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// 支持OPTIONS请求（CORS预检）
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// 获取可用语音列表的GET接口
export async function GET() {
  return NextResponse.json({
    voices: Object.keys(CHINESE_VOICES).map(key => ({
      id: key,
      name: CHINESE_VOICES[key as keyof typeof CHINESE_VOICES],
      displayName: {
        'xiaoxiao': '晓晓（温柔女声）',
        'xiaoyi': '晓伊（活泼女声）',
        'yunjian': '云健（成熟男声）',
        'yunxi': '云希（年轻男声）',
        'xiaomo': '晓墨（甜美女声）',
        'xiaoxuan': '晓萱（知性女声）',
      }[key]
    }))
  });
}