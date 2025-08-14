import { ToolCall, ToolResult, PageContext } from '@/types';
import { ToolExecutor } from './toolManager'; // 保持原有的本地工具执行器
import { EnhancedMCPToolExecutor } from './enhancedMCPToolExecutor';
import { UnifiedToolManager } from './unifiedToolManager';

export interface ToolMetadata {
  type: 'local' | 'mcp';
  serverName?: string;
  category?: string;
}

export class ToolRouter {
  private static mcpExecutor: EnhancedMCPToolExecutor;
  private static toolManager: UnifiedToolManager;

  static async initialize(): Promise<void> {
    console.log('🚀 初始化工具路由器...');
    
    // 初始化增强MCP执行器
    this.mcpExecutor = new EnhancedMCPToolExecutor();
    await this.mcpExecutor.initialize();
    
    // 初始化统一工具管理器
    this.toolManager = new UnifiedToolManager();
    await this.toolManager.initialize();
    
    console.log('✅ 工具路由器初始化完成');
  }

  /**
   * 智能路由工具执行
   */
  static async executeTools(toolCalls: ToolCall[], pageContext?: PageContext): Promise<ToolResult[]> {
    console.log(`🔧 路由器开始执行 ${toolCalls.length} 个工具`);
    
    const results: ToolResult[] = [];
    
    // 按工具类型分组
    const localCalls: ToolCall[] = [];
    const mcpCalls: ToolCall[] = [];
    
    for (const toolCall of toolCalls) {
      const metadata = this.toolManager.getToolMetadata(toolCall.function.name);
      
      if (metadata?.type === 'mcp') {
        mcpCalls.push(toolCall);
      } else {
        localCalls.push(toolCall);
      }
    }
    
    // 并行执行不同类型的工具
    const executionPromises: Promise<ToolResult[]>[] = [];
    
    if (localCalls.length > 0) {
      console.log(`📍 执行 ${localCalls.length} 个本地工具`);
      executionPromises.push(this.executeLocalTools(localCalls, pageContext));
    }
    
    if (mcpCalls.length > 0) {
      console.log(`🌐 执行 ${mcpCalls.length} 个MCP工具`);
      executionPromises.push(this.mcpExecutor.executeTools(mcpCalls, pageContext));
    }
    
    // 等待所有执行完成并合并结果
    const allResults = await Promise.all(executionPromises);
    for (const resultSet of allResults) {
      results.push(...resultSet);
    }
    
    // 按原始顺序排序结果
    const sortedResults = this.sortResultsByOriginalOrder(toolCalls, results);
    
    console.log(`✅ 路由器执行完成，返回 ${sortedResults.length} 个结果`);
    return sortedResults;
  }

  /**
   * 执行本地工具（使用原有的ToolExecutor）
   */
  private static async executeLocalTools(toolCalls: ToolCall[], pageContext?: PageContext): Promise<ToolResult[]> {
    try {
      return await ToolExecutor.executeTools(toolCalls, pageContext);
    } catch (error) {
      console.error('❌ 本地工具执行失败:', error);
      // 返回错误结果
      return toolCalls.map(call => ({
        tool_call_id: call.id,
        role: 'tool',
        content: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : '本地工具执行失败',
          toolName: call.function.name,
          toolType: 'local'
        })
      }));
    }
  }

  /**
   * 按原始工具调用顺序排序结果
   */
  private static sortResultsByOriginalOrder(toolCalls: ToolCall[], results: ToolResult[]): ToolResult[] {
    const resultMap = new Map<string, ToolResult>();
    results.forEach(result => resultMap.set(result.tool_call_id, result));
    
    return toolCalls.map(call => 
      resultMap.get(call.id) || {
        tool_call_id: call.id,
        role: 'tool',
        content: JSON.stringify({
          success: false,
          error: '工具执行结果丢失',
          toolName: call.function.name
        })
      }
    );
  }

  /**
   * 获取所有工具定义
   */
  static getAllToolDefinitions(): any[] {
    return this.toolManager?.getAllToolDefinitions() || [];
  }

  /**
   * 获取系统状态
   */
  static getSystemStatus() {
    const mcpStatus = this.mcpExecutor?.getStatus() || { available: false };
    return {
      local: { available: true, type: 'ToolExecutor' },
      mcp: {
        available: mcpStatus.initialized || false,
        ...mcpStatus
      },
      router: { initialized: !!this.toolManager }
    };
  }

  /**
   * 执行健康检查
   */
  static async healthCheck() {
    const results = {
      local: { healthy: true, type: 'ToolExecutor' },
      mcp: { healthy: false, details: [] as any[] },
      router: { healthy: !!this.toolManager }
    };

    if (this.mcpExecutor) {
      try {
        const healthCheck = await this.mcpExecutor.healthCheck();
        results.mcp = healthCheck;
      } catch (error) {
        results.mcp = {
          healthy: false,
          details: [{
            error: error instanceof Error ? error.message : '健康检查失败'
          }]
        };
      }
    }

    return results;
  }

  /**
   * 关闭工具路由器
   */
  static async shutdown(): Promise<void> {
    console.log('🔌 关闭工具路由器...');
    
    if (this.mcpExecutor) {
      await this.mcpExecutor.shutdown();
    }
    
    console.log('✅ 工具路由器已关闭');
  }
}