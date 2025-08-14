import { NextResponse } from 'next/server';
import { ToolRouter } from '@/utils/toolRouter';

export async function POST() {
  try {
    console.log('🔄 开始刷新MCP连接...');
    
    // 重新初始化工具路由器
    await ToolRouter.initialize();
    
    // 执行健康检查确保连接正常
    const healthCheck = await ToolRouter.healthCheck();
    
    console.log('✅ MCP连接刷新完成');
    
    return NextResponse.json({
      success: true,
      message: 'MCP连接已刷新',
      health: healthCheck,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ MCP连接刷新失败:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'MCP连接刷新失败',
        timestamp: new Date().toISOString()
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}