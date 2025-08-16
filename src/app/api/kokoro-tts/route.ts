// src/app/api/kokoro-tts/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Kokoro TTS服务配置
const KOKORO_SERVICE_URL = process.env.KOKORO_SERVICE_URL || 'http://127.0.0.1:8001';

interface KokoroTTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  stream?: boolean;
}

interface KokoroVoice {
  id: string;
  name: string;
  description: string;
  language: string;
}

/**
 * 流式TTS接口 - 完全流式体验
 */
export async function POST(request: NextRequest) {
  try {
    const { text, voice = 'zf_001', speed = 1.0, stream = true }: KokoroTTSRequest = await request.json();

    // 验证请求数据
    if (!text || text.trim() === '') {
      return NextResponse.json(
        { error: '文本内容不能为空' },
        { status: 400 }
      );
    }

    // 限制文本长度（防止滥用）
    if (text.length > 3000) {
      return NextResponse.json(
        { error: '文本长度不能超过3000字符' },
        { status: 400 }
      );
    }

    console.log(`🎙️ Kokoro TTS请求: voice=${voice}, speed=${speed}, stream=${stream}`);

    // 调用Kokoro TTS服务
    const kokoroResponse = await fetch(`${KOKORO_SERVICE_URL}/tts/${stream ? 'stream' : 'file'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice,
        speed,
        stream
      }),
    });

    if (!kokoroResponse.ok) {
      console.error(`Kokoro服务错误: ${kokoroResponse.status} ${kokoroResponse.statusText}`);
      
      let errorMessage = 'Kokoro TTS服务暂时不可用';
      try {
        const errorData = await kokoroResponse.json();
        errorMessage = errorData.detail || errorMessage;
      } catch {
        // 忽略JSON解析错误
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: kokoroResponse.status }
      );
    }

    // 流式响应：直接转发音频流
    if (stream) {
      const audioStream = kokoroResponse.body;
      
      if (!audioStream) {
        throw new Error('没有收到音频流数据');
      }

      return new Response(audioStream, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // 文件响应：等待完整音频后返回
    const audioBuffer = await kokoroResponse.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Kokoro TTS API错误:', error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 获取可用语音列表
 */
export async function GET() {
  try {
    const response = await fetch(`${KOKORO_SERVICE_URL}/voices`);
    
    if (!response.ok) {
      throw new Error(`获取语音列表失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    return NextResponse.json({
      voices: data.voices.map((voice: KokoroVoice) => ({
        id: voice.id,
        name: voice.name,
        displayName: voice.description || voice.name,
        language: voice.language
      }))
    });

  } catch (error) {
    console.error('获取语音列表失败:', error);
    
    // 返回默认语音作为备用
    return NextResponse.json({
      voices: [
        {
          id: 'zf_001',
          name: 'zf_001',
          displayName: '中文女声',
          language: 'zh-CN'
        }
      ]
    });
  }
}

/**
 * CORS预检支持
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}