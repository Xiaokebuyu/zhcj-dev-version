import { NextResponse } from 'next/server';
import { ToolRouter } from '@/utils/toolRouter';

export async function GET() {
  try {
    const systemStatus = ToolRouter.getSystemStatus();
    
    // 转换为前端需要的格式
    const servers: Record<string, any> = {};
    
    if (systemStatus.mcp?.servers) {
      systemStatus.mcp.servers.forEach((server: any) => {
        servers[server.name] = {
          name: server.name,
          status: server.connected ? 'connected' : 'error',
          category: server.info?.category || '未分类',
          toolCount: 0, // 需要从工具列表中计算
          transport: server.transport || 'unknown',
          error: server.connected ? null : '连接失败'
        };
      });
    }

    // 计算工具数量
    const toolDefinitions = ToolRouter.getAllToolDefinitions();
    const mcpTools = toolDefinitions.filter(tool => tool._metadata?.type === 'mcp');
    
    mcpTools.forEach(tool => {
      const serverName = tool._metadata?.serverName;
      if (serverName && servers[serverName]) {
        servers[serverName].toolCount += 1;
      }
    });

    const connectionState = {
      servers,
      totalTools: systemStatus.mcp?.totalTools || 0,
      isInitialized: systemStatus.mcp?.initialized || false
    };

    return NextResponse.json(connectionState);
  } catch (error) {
    console.error('获取MCP状态失败:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : '获取状态失败',
        servers: {},
        totalTools: 0,
        isInitialized: false
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