import { NextResponse } from 'next/server';
import { mcpConnector } from '@/utils/mcpConnector';

export async function POST() {
  try {
    await mcpConnector.refreshTools();
    const connectionState = mcpConnector.getConnectionState();
    return NextResponse.json({ 
      success: true, 
      connectionState 
    });
  } catch (error) {
    console.error('刷新MCP连接失败:', error);
    return NextResponse.json(
      { error: '刷新MCP连接失败' },
      { status: 500 }
    );
  }
}