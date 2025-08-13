import { MCPClient } from './mcpClient';
import { MCP_SERVERS, getStartupServers, getOnDemandServers, MCPServerConfig } from '../config/mcpServers';
import { MCPTool, MCPCallResult, MCPServerStatus, MCPConnectionState } from '../types/mcp';

export class MCPConnector {
  private clients = new Map<string, MCPClient>();
  private mcpTools = new Map<string, { tool: MCPTool; serverName: string }>();
  private connectionState: MCPConnectionState = {
    servers: {},
    totalTools: 0,
    isInitialized: false
  };

  // 初始化MCP连接器
  async initialize(): Promise<void> {
    console.log('🚀 初始化MCP连接器...');
    console.log('📋 环境变量检查:');
    console.log('- NEXT_PUBLIC_AMAP_API_KEY:', process.env.NEXT_PUBLIC_AMAP_API_KEY ? '✅已设置' : '❌未设置');
    
    try {
      // 对于HTTP协议，"连接"实际上是初始化和健康检查
      const startupServers = getStartupServers();
      console.log(`📡 启动时服务器数量: ${startupServers.length}`);
      startupServers.forEach((server, index) => {
        console.log(`${index + 1}. ${server.name}: ${server.url}`);
      });
      await this.initializeStartupServers(startupServers);
      
      this.connectionState.isInitialized = true;
      console.log('🎉 MCP连接器初始化完成');
      
      this.printStatus();
    } catch (error) {
      console.error('❌ MCP初始化失败:', error);
    }
  }

  private async initializeStartupServers(servers: MCPServerConfig[]): Promise<void> {
    const initPromises = servers.map(async (serverConfig) => {
      try {
        const success = await this.addServer(serverConfig);
        if (success) {
          console.log(`✅ 启动时初始化成功: ${serverConfig.name}`);
        } else {
          console.warn(`⚠️ 启动时初始化失败: ${serverConfig.name}`);
        }
      } catch (error) {
        console.error(`❌ 启动时初始化错误 (${serverConfig.name}):`, error);
        // 记录错误状态
        this.connectionState.servers[serverConfig.name] = {
          name: serverConfig.name,
          status: 'error',
          toolCount: 0,
          error: error instanceof Error ? error.message : '初始化失败',
          category: serverConfig.category
        };
      }
    });

    // 并行初始化，但不阻塞应用启动
    await Promise.allSettled(initPromises);
  }

  async addServer(serverConfig: MCPServerConfig): Promise<boolean> {
    try {
      const client = new MCPClient(serverConfig);
      const initialized = await client.connect(); // 对于HTTP，这实际上是健康检查
      
      if (initialized) {
        this.clients.set(serverConfig.name, client);
        await this.refreshTools(serverConfig.name);
        
        // 更新服务状态
        this.updateServerStatus(serverConfig.name, client);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`添加MCP服务器失败 (${serverConfig.name}):`, error);
      return false;
    }
  }

  async ensureConnection(serverName: string): Promise<boolean> {
    // 检查服务是否健康可用
    const client = this.clients.get(serverName);
    if (client && client.isServerConnected()) {
      return true;
    }

    // 如果客户端存在但连接不健康，尝试刷新健康状态
    if (client) {
      try {
        const healthy = await client.refreshHealth();
        if (healthy) {
          this.updateServerStatus(serverName, client);
          return true;
        }
      } catch (error) {
        console.error(`刷新服务器健康状态失败 (${serverName}):`, error);
      }
    }

    // 查找服务器配置
    const serverConfig = MCP_SERVERS.find(s => s.name === serverName);
    if (!serverConfig) {
      console.error(`未找到MCP服务器配置: ${serverName}`);
      return false;
    }

    // 按需初始化
    console.log(`🔗 按需初始化MCP服务器: ${serverName}`);
    return await this.addServer(serverConfig);
  }

  async refreshTools(serverName?: string): Promise<void> {
    const serversToRefresh = serverName 
      ? [serverName] 
      : Array.from(this.clients.keys());

    for (const name of serversToRefresh) {
      const client = this.clients.get(name);
      if (!client) continue;

      try {
        // 首先确保服务健康
        const isHealthy = await client.refreshHealth();
        if (!isHealthy) {
          console.warn(`服务器不健康，跳过工具刷新: ${name}`);
          continue;
        }

        const tools = await client.listTools();
        
        // 清除该服务器的旧工具
        for (const [toolName, toolInfo] of this.mcpTools.entries()) {
          if (toolInfo.serverName === name) {
            this.mcpTools.delete(toolName);
          }
        }
        
        // 添加新工具
        tools.forEach(tool => {
          this.mcpTools.set(tool.name, { tool, serverName: name });
        });
        
        // 更新状态
        this.updateServerStatus(name, client);
        
        console.log(`🔄 已刷新 ${name} 的工具列表: ${tools.length} 个工具`);
      } catch (error) {
        console.error(`刷新工具列表失败 (${name}):`, error);
        // 标记服务器状态为错误
        this.connectionState.servers[name] = {
          ...this.connectionState.servers[name],
          status: 'error',
          error: error instanceof Error ? error.message : '工具刷新失败'
        };
      }
    }

    // 更新总工具数
    this.connectionState.totalTools = this.mcpTools.size;
  }

  private updateServerStatus(serverName: string, client: MCPClient): void {
    const toolCount = Array.from(this.mcpTools.values())
      .filter(info => info.serverName === serverName).length;
    
    const status = client.getStatus();
    this.connectionState.servers[serverName] = {
      ...status,
      toolCount
    };
  }

  // 获取所有MCP工具定义（转换为标准格式）
  getMCPToolDefinitions(): any[] {
    console.log(`🔧 获取MCP工具定义，当前工具数量: ${this.mcpTools.size}`);
    const toolDefinitions = Array.from(this.mcpTools.entries()).map(([toolName, { tool, serverName }]) => {
      const toolDef = {
        type: "function",
        function: {
          name: toolName, // 使用原始工具名，不添加前缀
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: tool.inputSchema
        },
        _mcpMeta: {
          isMCPTool: true,
          originalName: toolName,
          serverName: serverName
        }
      };
      console.log(`- 工具: ${toolName} (来自 ${serverName})`);
      return toolDef;
    });
    console.log(`🎯 返回 ${toolDefinitions.length} 个MCP工具定义`);
    return toolDefinitions;
  }

  // 执行MCP工具
  async executeMCPTool(toolName: string, args: Record<string, any>): Promise<MCPCallResult> {
    // 直接使用工具名，不需要去除前缀
    const toolInfo = this.mcpTools.get(toolName);
    if (!toolInfo) {
      return {
        success: false,
        error: `MCP工具不存在: ${toolName}`,
        toolName: toolName,
        serverName: 'unknown'
      };
    }

    // 确保连接可用
    const connectionReady = await this.ensureConnection(toolInfo.serverName);
    if (!connectionReady) {
      return {
        success: false,
        error: `无法连接到MCP服务器: ${toolInfo.serverName}`,
        toolName: toolName,
        serverName: toolInfo.serverName
      };
    }

    const client = this.clients.get(toolInfo.serverName);
    if (!client) {
      return {
        success: false,
        error: `MCP客户端不存在: ${toolInfo.serverName}`,
        toolName: toolName,
        serverName: toolInfo.serverName
      };
    }

    return await client.callTool(toolName, args);
  }

  // 检查是否为MCP工具
  isMCPTool(toolName: string): boolean {
    return this.mcpTools.has(toolName);
  }

  // 获取连接状态
  getConnectionState(): MCPConnectionState {
    return { ...this.connectionState };
  }

  // 获取服务器状态列表
  getServerStatus(): MCPServerStatus[] {
    return Object.values(this.connectionState.servers);
  }

  // 断开连接
  async disconnect(serverName?: string): Promise<void> {
    if (serverName) {
      const client = this.clients.get(serverName);
      if (client) {
        client.disconnect();
        this.clients.delete(serverName);
        delete this.connectionState.servers[serverName];
        
        // 清除该服务器的工具
        for (const [toolName, toolInfo] of this.mcpTools.entries()) {
          if (toolInfo.serverName === serverName) {
            this.mcpTools.delete(toolName);
          }
        }
        
        this.connectionState.totalTools = this.mcpTools.size;
        console.log(`🔌 已断开MCP服务器: ${serverName}`);
      }
    } else {
      // 断开所有连接
      for (const client of this.clients.values()) {
        client.disconnect();
      }
      this.clients.clear();
      this.mcpTools.clear();
      this.connectionState = {
        servers: {},
        totalTools: 0,
        isInitialized: false
      };
      console.log('🔌 已断开所有MCP服务器');
    }
  }

  private printStatus(): void {
    const status = this.getServerStatus();
    const tools = Array.from(this.mcpTools.entries());
    
    console.log('\n📊 MCP状态报告:');
    console.log(`HTTP MCP服务器: ${status.length} 个`);
    status.forEach(server => {
      const statusIcon = server.status === 'connected' ? '✅' : '❌';
      const errorInfo = server.error ? ` [${server.error}]` : '';
      console.log(`  ${statusIcon} ${server.name}: ${server.status} (${server.toolCount} 工具)${errorInfo}`);
    });
    console.log(`可用MCP工具: ${tools.length} 个`);
    tools.forEach(([name, { serverName }]) => {
      console.log(`  - mcp_${name} (来自 ${serverName})`);
    });
    console.log('');
  }
}

// 单例实例
export const mcpConnector = new MCPConnector();