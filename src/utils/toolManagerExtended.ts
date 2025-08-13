import { ToolExecutor, ToolCall, ToolResult } from './toolManager';
import { mcpConnector } from './mcpConnector';
import { toolDefinitions } from './toolManager';
import { PageContext } from '@/types';

export class ExtendedToolExecutor extends ToolExecutor {
  
  // 重写工具执行方法，添加MCP支持
  static async executeTools(toolCalls: ToolCall[], pageContext?: PageContext): Promise<ToolResult[]> {
    console.log('🔧 开始执行工具（支持MCP），工具数量:', toolCalls.length);
    
    const results: ToolResult[] = [];
    
    for (const toolCall of toolCalls) {
      try {
        let result: object;
        
        // 检查是否为MCP工具
        if (mcpConnector.isMCPTool(toolCall.function.name)) {
          console.log(`🌐 执行MCP工具: ${toolCall.function.name}`);
          const args = JSON.parse(toolCall.function.arguments);
          const mcpResult = await mcpConnector.executeMCPTool(toolCall.function.name, args);
          
          result = {
            success: mcpResult.success,
            content: mcpResult.content,
            error: mcpResult.error,
            serverName: mcpResult.serverName,
            executionTime: mcpResult.executionTime,
            toolType: 'mcp'
          };
        } else {
          // 执行本地工具
          console.log(`🔧 执行本地工具: ${toolCall.function.name}`);
          result = await this.executeLocalTool(toolCall, pageContext);
        }
        
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify(result)
        });
        
      } catch (error) {
        console.error(`工具执行失败 ${toolCall.function.name}:`, error);
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : '未知错误',
            toolName: toolCall.function.name,
            toolType: mcpConnector.isMCPTool(toolCall.function.name) ? 'mcp' : 'local'
          })
        });
      }
    }

    return results;
  }

  // 执行本地工具（原有逻辑）
  private static async executeLocalTool(toolCall: ToolCall, pageContext?: PageContext): Promise<object> {
    // 调用父类的原有执行逻辑
    const originalResults = await super.executeTools([toolCall], pageContext);
    const result = originalResults[0];
    
    // 解析结果
    try {
      const parsedResult = JSON.parse(result.content);
      return { ...parsedResult, toolType: 'local' };
    } catch {
      return { content: result.content, toolType: 'local' };
    }
  }

  // 获取所有工具定义（包括MCP工具）
  static getAllToolDefinitions(): any[] {
    console.log('🔍 ExtendedToolExecutor.getAllToolDefinitions 被调用');
    
    const localTools = toolDefinitions; // 原有工具定义
    console.log(`📋 本地工具数量: ${localTools.length}`);
    
    const mcpTools = mcpConnector.getMCPToolDefinitions();
    console.log(`📋 MCP工具数量: ${mcpTools.length}`);
    
    const allTools = [...localTools, ...mcpTools];
    console.log(`📋 工具定义统计: 本地工具 ${localTools.length} 个, MCP工具 ${mcpTools.length} 个, 总计 ${allTools.length} 个`);
    
    return allTools;
  }

  // 获取MCP连接状态
  static getMCPStatus() {
    return mcpConnector.getConnectionState();
  }

  // 刷新MCP工具
  static async refreshMCPTools(serverName?: string) {
    await mcpConnector.refreshTools(serverName);
  }
}