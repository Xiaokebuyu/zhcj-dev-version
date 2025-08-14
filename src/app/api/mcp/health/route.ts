import { NextResponse } from 'next/server';
import { ToolRouter } from '@/utils/toolRouter';

export async function GET() {
  try {
    const healthCheck = await ToolRouter.healthCheck();
    
    const overall = {
      healthy: healthCheck.local.healthy && healthCheck.mcp.healthy && healthCheck.router.healthy,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      overall,
      components: healthCheck
    });
  } catch (error) {
    console.error('MCP健康检查失败:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : '健康检查失败',
        overall: {
          healthy: false,
          timestamp: new Date().toISOString()
        }
      },
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}