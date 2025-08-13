import { ToolCall, ToolResult, PageContext } from '@/types';
import { StandardMCPClient } from './standardMCPClient';
import { getStartupServers, MCPServerConfig } from '@/config/mcpServers';

export class MCPToolExecutor {
  private clients = new Map<string, StandardMCPClient>();
  private toolToServerMap = new Map<string, string>();
  private isInitialized = false;

  async initialize(): Promise<void> {
    console.log('🚀 初始化MCP工具执行器...');
    
    const servers = getStartupServers();
    const initPromises = servers.map(async (serverConfig) => {
      try {
        const client = new StandardMCPClient(serverConfig);
        const success = await client.initialize();
        
        if (success) {
          this.clients.set(serverConfig.name, client);
          await this.loadServerTools(serverConfig.name, client);
          console.log(`✅ MCP服务器连接成功: ${serverConfig.name}`);
        } else {
          console.warn(`⚠️ MCP服务器连接失败: ${serverConfig.name}`);
        }
      } catch (error) {
        console.error(`❌ MCP服务器初始化错误 (${serverConfig.name}):`, error);
      }
    });

    await Promise.allSettled(initPromises);
    this.isInitialized = true;
    
    console.log(`🎉 MCP工具执行器初始化完成，连接 ${this.clients.size} 个服务器`);
  }

  /**
   * 加载服务器工具
   */
  private async loadServerTools(serverName: string, client: StandardMCPClient): Promise<void> {
    try {
      const tools = await client.listTools();
      tools.forEach(tool => {
        this.toolToServerMap.set(tool.name, serverName);
      });
      console.log(`📋 加载 ${serverName} 的 ${tools.length} 个工具`);
    } catch (error) {
      console.error(`加载服务器工具失败 (${serverName}):`, error);
    }
  }

  /**
   * 执行MCP工具
   */
  async executeTools(toolCalls: ToolCall[], pageContext?: PageContext): Promise<ToolResult[]> {
    if (!this.isInitialized) {
      throw new Error('MCP工具执行器未初始化');
    }

    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await this.executeSingleTool(toolCall);
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify(result)
        });
      } catch (error) {
        console.error(`MCP工具执行失败 ${toolCall.function.name}:`, error);
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : '未知错误',
            toolName: toolCall.function.name,
            toolType: 'mcp'
          })
        });
      }
    }

    return results;
  }

  /**
   * 执行单个MCP工具
   */
  private async executeSingleTool(toolCall: ToolCall): Promise<any> {
    const serverName = this.toolToServerMap.get(toolCall.function.name);
    if (!serverName) {
      throw new Error(`未找到工具对应的MCP服务器: ${toolCall.function.name}`);
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP客户端不存在: ${serverName}`);
    }

    const args = JSON.parse(toolCall.function.arguments);
    const result = await client.callTool(toolCall.function.name, args);

    return {
      success: result.success,
      content: result.content,
      error: result.error,
      serverName: result.serverName,
      executionTime: result.executionTime,
      toolType: 'mcp'
    };
  }

  /**
   * 获取所有MCP工具定义
   */
  async getAllToolDefinitions(): Promise<any[]> {
    const toolDefinitions: any[] = [];

    for (const [serverName, client] of this.clients) {
      try {
        const tools = await client.listTools();
        tools.forEach(tool => {
          toolDefinitions.push({
            type: "function",
            function: {
              name: tool.name,
              description: `[MCP:${serverName}] ${tool.description}`,
              parameters: tool.inputSchema
            },
            _metadata: {
              type: 'mcp',
              serverName: serverName,
              category: 'mcp'
            }
          });
        });
      } catch (error) {
        console.error(`获取MCP工具定义失败 (${serverName}):`, error);
      }
    }

    return toolDefinitions;
  }

  /**
   * 检查是否为MCP工具
   */
  isMCPTool(toolName: string): boolean {
    return this.toolToServerMap.has(toolName);
  }

  /**
   * 获取执行器状态
   */
  getStatus() {
    const serverStatus = Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      connected: client.isConnected(),
      info: client.getServerInfo()
    }));

    return {
      initialized: this.isInitialized,
      servers: serverStatus,
      totalTools: this.toolToServerMap.size
    };
  }
}