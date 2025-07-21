import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

interface StartVoiceCallRequest {
  audioQuality?: 'low' | 'medium' | 'high';
  silenceDetection?: boolean;
}

interface StartVoiceCallResponse {
  success: boolean;
  sessionId?: string;
  wsUrl?: string;
  error?: string;
  config?: {
    silenceThreshold: number;
    audioConfig: {
      inputSampleRate: number;
      outputSampleRate: number;
      channels: number;
      format: string;
    };
  };
}

/**
 * 开始语音通话接口
 * 创建新的语音通话会话并返回WebSocket连接信息
 */
export async function POST(request: NextRequest): Promise<NextResponse<StartVoiceCallResponse>> {
  try {
    const body: StartVoiceCallRequest = await request.json();
    const { audioQuality = 'medium', silenceDetection = true } = body;

    // 使用固定的豆包配置，简化部署
    const doubaoAppId = '2139817228';
    const doubaoAccessKey = 'LMxFTYn2mmWwQwmLfT3ZbwS4yj0JPiMt';

    // 基本的配置验证
    if (!doubaoAppId || !doubaoAccessKey) {
      console.error('豆包API配置缺失');
      return NextResponse.json({
        success: false,
        error: '语音服务配置不完整'
      }, { status: 500 });
    }

    // 生成会话ID
    const sessionId = uuidv4();

    // 使用本地WebSocket代理服务器
    const protocol = request.nextUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = request.headers.get('host') || 'localhost:3000';
    const wsUrl = `${protocol}//${host}/api/voice/realtime?sessionId=${sessionId}`;

    // 根据音频质量设置采样率
    const sampleRateMap = {
      low: { input: 8000, output: 16000 },
      medium: { input: 16000, output: 24000 },
      high: { input: 24000, output: 24000 }
    };

    const sampleRates = sampleRateMap[audioQuality];

    const response: StartVoiceCallResponse = {
      success: true,
      sessionId,
      wsUrl,
      config: {
        silenceThreshold: silenceDetection ? 0.01 : 0,
        audioConfig: {
          inputSampleRate: sampleRates.input,
          outputSampleRate: sampleRates.output,
          channels: 1,
          format: 'pcm'
        }
      }
    };

    console.log(`语音通话会话已创建: ${sessionId}, WebSocket代理URL: ${wsUrl}, 音频质量: ${audioQuality}`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('创建语音通话会话失败:', error);
    return NextResponse.json({
      success: false,
      error: '创建语音通话会话失败'
    }, { status: 500 });
  }
}

/**
 * 获取语音通话配置信息
 */
export async function GET(): Promise<NextResponse> {
  try {
    // 检查配置
    const isConfigured = true; // 使用固定配置

    return NextResponse.json({
      available: isConfigured,
      audioQualities: [
        { id: 'low', name: '低质量', description: '8kHz, 省流量' },
        { id: 'medium', name: '中等质量', description: '16kHz, 推荐' },
        { id: 'high', name: '高质量', description: '24kHz, 最佳体验' }
      ],
      features: {
        silenceDetection: true,
        realtimeTranscript: true,
        audioVisualization: true
      },
      limits: {
        maxCallDuration: 300000, // 5分钟
        maxConcurrentCalls: 1
      }
    });

  } catch (error) {
    console.error('获取语音通话配置失败:', error);
    return NextResponse.json({
      available: false,
      error: '获取配置失败'
    }, { status: 500 });
  }
}

// 支持CORS预检请求
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // 简化CORS配置
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}