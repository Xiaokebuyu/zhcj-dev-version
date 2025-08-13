import { NextResponse } from 'next/server';
import { mcpConnector } from '@/utils/mcpConnector';

export async function POST() {
  try {
    console.log('🚀 手动初始化MCP连接器...');
    
    await mcpConnector.initialize();
    
    const connectionState = mcpConnector.getConnectionState();
    
    return NextResponse.json({
      success: true,
      message: 'MCP连接器初始化完成',
      connectionState
    });
    
  } catch (error) {
    console.error('❌ MCP初始化失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}

export async function GET() {
  const connectionState = mcpConnector.getConnectionState();
  
  return NextResponse.json({
    success: true,
    initialized: connectionState.isInitialized,
    connectionState
  });
}