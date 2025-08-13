import { toolDefinitions } from './toolManager';
import { MCPToolExecutor } from './mcpToolExecutor';
import { ToolMetadata } from './toolRouter';

export class UnifiedToolManager {
  private mcpExecutor: MCPToolExecutor;
  private toolMetadataMap = new Map<string, ToolMetadata>();
  private allToolDefinitions: any[] = [];

  constructor() {
    this.mcpExecutor = new MCPToolExecutor();
  }

  async initialize(): Promise<void> {
    console.log('🔧 初始化统一工具管理器...');
    
    // 初始化MCP执行器
    await this.mcpExecutor.initialize();
    
    // 构建工具定义和元数据
    await this.buildToolDefinitions();
    
    console.log(`✅ 统一工具管理器初始化完成，管理 ${this.allToolDefinitions.length} 个工具`);
  }

  /**
   * 构建所有工具定义
   */
  private async buildToolDefinitions(): Promise<void> {
    // 清空现有定义
    this.allToolDefinitions = [];
    this.toolMetadataMap.clear();

    // 添加本地工具
    toolDefinitions.forEach(toolDef => {
      this.allToolDefinitions.push(toolDef);
      this.toolMetadataMap.set(toolDef.function.name, {
        type: 'local',
        category: 'local'
      });
    });

    // 添加MCP工具
    const mcpToolDefs = await this.mcpExecutor.getAllToolDefinitions();
    mcpToolDefs.forEach(toolDef => {
      this.allToolDefinitions.push(toolDef);
      this.toolMetadataMap.set(toolDef.function.name, toolDef._metadata);
    });

    console.log(`📊 工具统计: 本地工具 ${toolDefinitions.length} 个，MCP工具 ${mcpToolDefs.length} 个`);
  }

  /**
   * 获取所有工具定义
   */
  getAllToolDefinitions(): any[] {
    return [...this.allToolDefinitions];
  }

  /**
   * 获取工具元数据
   */
  getToolMetadata(toolName: string): ToolMetadata | undefined {
    return this.toolMetadataMap.get(toolName);
  }

  /**
   * 刷新工具定义
   */
  async refreshTools(): Promise<void> {
    console.log('🔄 刷新工具定义...');
    await this.buildToolDefinitions();
  }

  /**
   * 获取工具统计信息
   */
  getToolStats() {
    const localCount = Array.from(this.toolMetadataMap.values())
      .filter(meta => meta.type === 'local').length;
    const mcpCount = Array.from(this.toolMetadataMap.values())
      .filter(meta => meta.type === 'mcp').length;

    return {
      total: this.allToolDefinitions.length,
      local: localCount,
      mcp: mcpCount,
      servers: this.mcpExecutor.getStatus().servers
    };
  }
}