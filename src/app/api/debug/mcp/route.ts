import { NextResponse } from 'next/server';
import { mcpConnector } from '@/utils/mcpConnector';
import { ExtendedToolExecutor } from '@/utils/toolManagerExtended';

export async function GET() {
  try {
    console.log('🔍 Debug API: 检查MCP状态');
    
    // 获取环境变量
    const amapKey = process.env.NEXT_PUBLIC_AMAP_API_KEY;
    
    // 获取连接状态
    const connectionState = mcpConnector.getConnectionState();
    
    // 获取工具定义
    const allTools = ExtendedToolExecutor.getAllToolDefinitions();
    const mcpTools = allTools.filter(tool => tool.function.name.startsWith('mcp_'));
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        amapApiKey: amapKey ? `${amapKey.substring(0, 8)}...` : 'Not Set',
        nodeEnv: process.env.NODE_ENV
      },
      connectionState,
      tools: {
        total: allTools.length,
        mcp: mcpTools.length,
        local: allTools.length - mcpTools.length
      },
      mcpTools: mcpTools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        serverName: tool._mcpMeta?.serverName
      })),
      serverStatus: mcpConnector.getServerStatus()
    };
    
    console.log('🔍 Debug API: 调试信息', debugInfo);
    
    return NextResponse.json({
      success: true,
      data: debugInfo
    });
    
  } catch (error) {
    console.error('❌ Debug API: 获取调试信息失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}