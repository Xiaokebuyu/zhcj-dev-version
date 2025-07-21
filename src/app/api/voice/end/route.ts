import { NextRequest, NextResponse } from 'next/server';

interface EndVoiceCallRequest {
  sessionId: string;
  reason?: 'user_hangup' | 'timeout' | 'error' | 'silence_timeout';
  duration?: number;
}

interface EndVoiceCallResponse {
  success: boolean;
  message?: string;
  error?: string;
  sessionSummary?: {
    sessionId: string;
    duration: number;
    endReason: string;
    timestamp: string;
  };
}

/**
 * 结束语音通话接口
 * 清理会话资源并返回通话摘要
 */
export async function POST(request: NextRequest): Promise<NextResponse<EndVoiceCallResponse>> {
  try {
    const body: EndVoiceCallRequest = await request.json();
    const { sessionId, reason = 'user_hangup', duration = 0 } = body;

    // 验证会话ID
    if (!sessionId) {
      return NextResponse.json({
        success: false,
        error: '会话ID不能为空'
      }, { status: 400 });
    }

    // 根据结束原因生成不同的消息
    const getEndMessage = (reason: string): string => {
      switch (reason) {
        case 'user_hangup':
          return '通话已正常结束';
        case 'timeout':
          return '通话已超时结束';
        case 'silence_timeout':
          return '通话因静音超时而结束';
        case 'error':
          return '通话因错误而结束';
        default:
          return '通话已结束';
      }
    };

    const response: EndVoiceCallResponse = {
      success: true,
      message: getEndMessage(reason),
      sessionSummary: {
        sessionId,
        duration,
        endReason: reason,
        timestamp: new Date().toISOString()
      }
    };

    // 记录通话结束日志
    console.log(`语音通话会话结束: ${sessionId}, 原因: ${reason}, 时长: ${duration}ms`);

    // 这里可以添加会话数据的持久化逻辑
    // 例如保存到数据库或日志文件

    return NextResponse.json(response);

  } catch (error) {
    console.error('结束语音通话会话失败:', error);
    return NextResponse.json({
      success: false,
      error: '结束语音通话会话失败'
    }, { status: 500 });
  }
}

// 支持CORS预检请求
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // 简化CORS配置
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}