import { NextResponse } from 'next/server';
import { mcpConnector } from '@/utils/mcpConnector';

export async function GET() {
  try {
    const connectionState = mcpConnector.getConnectionState();
    return NextResponse.json(connectionState);
  } catch (error) {
    console.error('获取MCP状态失败:', error);
    return NextResponse.json(
      { error: '获取MCP状态失败' },
      { status: 500 }
    );
  }
}