import { ToolCall, ToolResult, PageContext } from '@/types';
import { StandardMCPClient } from './standardMCPClient';
import { WebSocketMCPClient, ConnectionState } from './websocketMCPClient';
import { getStartupServers, MCPServerConfig } from '@/config/mcpServers';

export interface MCPClientWrapper {
  client: StandardMCPClient | WebSocketMCPClient;
  type: 'websocket' | 'http';
  config: MCPServerConfig;
}

export class EnhancedMCPToolExecutor {
  private clients = new Map<string, MCPClientWrapper>();
  private toolToServerMap = new Map<string, string>();
  private isInitialized = false;
  private batchSize = 5; // 批处理大小

  async initialize(): Promise<void> {
    console.log('🚀 初始化增强MCP工具执行器...');
    
    const servers = getStartupServers();
    const initPromises = servers.map(async (serverConfig) => {
      try {
        await this.initializeServerConnection(serverConfig);
      } catch (error) {
        console.error(`❌ MCP服务器初始化错误 (${serverConfig.name}):`, error);
      }
    });

    await Promise.allSettled(initPromises);
    this.isInitialized = true;
    
    console.log(`🎉 增强MCP工具执行器初始化完成，连接 ${this.clients.size} 个服务器`);
  }

  /**
   * 初始化服务器连接
   */
  private async initializeServerConnection(serverConfig: MCPServerConfig): Promise<void> {
    let clientWrapper: MCPClientWrapper;

    if (serverConfig.transport === 'websocket') {
      // 使用WebSocket客户端
      const wsClient = new WebSocketMCPClient(serverConfig, serverConfig.connectionConfig);
      
      // 设置事件监听
      wsClient.on('stateChanged', (data: any) => {
        console.log(`🔄 连接状态变化 (${serverConfig.name}): ${data.oldState} -> ${data.newState}`);
      });
      
      wsClient.on('toolsChanged', () => {
        console.log(`📋 工具列表更新: ${serverConfig.name}`);
        this.refreshServerTools(serverConfig.name);
      });

      const success = await wsClient.connect();
      if (success) {
        clientWrapper = {
          client: wsClient,
          type: 'websocket',
          config: serverConfig
        };
        this.clients.set(serverConfig.name, clientWrapper);
        await this.loadServerTools(serverConfig.name, wsClient);
        console.log(`✅ WebSocket MCP服务器连接成功: ${serverConfig.name}`);
      } else {
        console.warn(`⚠️ WebSocket MCP服务器连接失败: ${serverConfig.name}`);
        // 可以选择降级到HTTP传输
        await this.tryFallbackConnection(serverConfig);
      }
    } else {
      // 使用传统HTTP客户端
      const httpClient = new StandardMCPClient(serverConfig);
      const success = await httpClient.initialize();
      
      if (success) {
        clientWrapper = {
          client: httpClient,
          type: 'http',
          config: serverConfig
        };
        this.clients.set(serverConfig.name, clientWrapper);
        await this.loadServerTools(serverConfig.name, httpClient);
        console.log(`✅ HTTP MCP服务器连接成功: ${serverConfig.name}`);
      } else {
        console.warn(`⚠️ HTTP MCP服务器连接失败: ${serverConfig.name}`);
      }
    }
  }

  /**
   * 尝试降级连接
   */
  private async tryFallbackConnection(serverConfig: MCPServerConfig): Promise<void> {
    console.log(`🔄 尝试HTTP降级连接: ${serverConfig.name}`);
    
    const fallbackConfig = {
      ...serverConfig,
      transport: 'http-stream' as const
    };

    const httpClient = new StandardMCPClient(fallbackConfig);
    const success = await httpClient.initialize();
    
    if (success) {
      const clientWrapper: MCPClientWrapper = {
        client: httpClient,
        type: 'http',
        config: fallbackConfig
      };
      this.clients.set(serverConfig.name, clientWrapper);
      await this.loadServerTools(serverConfig.name, httpClient);
      console.log(`✅ HTTP降级连接成功: ${serverConfig.name}`);
    } else {
      console.error(`❌ HTTP降级连接也失败: ${serverConfig.name}`);
    }
  }

  /**
   * 加载服务器工具
   */
  private async loadServerTools(serverName: string, client: StandardMCPClient | WebSocketMCPClient): Promise<void> {
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
   * 刷新服务器工具列表
   */
  private async refreshServerTools(serverName: string): Promise<void> {
    const wrapper = this.clients.get(serverName);
    if (!wrapper) return;

    try {
      // 移除旧的工具映射
      for (const [toolName, mappedServerName] of this.toolToServerMap.entries()) {
        if (mappedServerName === serverName) {
          this.toolToServerMap.delete(toolName);
        }
      }

      // 重新加载工具
      await this.loadServerTools(serverName, wrapper.client);
    } catch (error) {
      console.error(`刷新服务器工具失败 (${serverName}):`, error);
    }
  }

  /**
   * 执行MCP工具（支持批处理）
   */
  async executeTools(toolCalls: ToolCall[], pageContext?: PageContext): Promise<ToolResult[]> {
    if (!this.isInitialized) {
      throw new Error('增强MCP工具执行器未初始化');
    }

    console.log(`🔧 增强执行器开始执行 ${toolCalls.length} 个MCP工具`);

    // 按服务器分组工具调用
    const serverGroups = new Map<string, ToolCall[]>();
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const serverName = this.toolToServerMap.get(toolCall.function.name);
      if (!serverName) {
        // 工具不存在
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error: `未找到工具对应的MCP服务器: ${toolCall.function.name}`,
            toolName: toolCall.function.name,
            toolType: 'mcp'
          })
        });
        continue;
      }

      if (!serverGroups.has(serverName)) {
        serverGroups.set(serverName, []);
      }
      serverGroups.get(serverName)!.push(toolCall);
    }

    // 并行执行不同服务器的工具
    const executionPromises = Array.from(serverGroups.entries()).map(
      ([serverName, calls]) => this.executeServerTools(serverName, calls)
    );

    const serverResults = await Promise.all(executionPromises);
    for (const serverResult of serverResults) {
      results.push(...serverResult);
    }

    // 按原始顺序排序结果
    const sortedResults = this.sortResultsByOriginalOrder(toolCalls, results);
    
    console.log(`✅ 增强执行器执行完成，返回 ${sortedResults.length} 个结果`);
    return sortedResults;
  }

  /**
   * 执行特定服务器的工具
   */
  private async executeServerTools(serverName: string, toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const wrapper = this.clients.get(serverName);
    if (!wrapper) {
      return toolCalls.map(call => ({
        tool_call_id: call.id,
        role: 'tool',
        content: JSON.stringify({
          success: false,
          error: `MCP客户端不存在: ${serverName}`,
          toolName: call.function.name,
          toolType: 'mcp'
        })
      }));
    }

    const results: ToolResult[] = [];

    // 检查连接状态（仅对WebSocket）
    if (wrapper.type === 'websocket') {
      const wsClient = wrapper.client as WebSocketMCPClient;
      if (wsClient.getConnectionState() !== ConnectionState.CONNECTED) {
        console.warn(`⚠️ WebSocket连接不可用，尝试重连: ${serverName}`);
        const reconnected = await wsClient.connect();
        if (!reconnected) {
          return toolCalls.map(call => ({
            tool_call_id: call.id,
            role: 'tool',
            content: JSON.stringify({
              success: false,
              error: `服务器连接失败: ${serverName}`,
              toolName: call.function.name,
              toolType: 'mcp'
            })
          }));
        }
      }
    }

    // 批处理执行
    for (let i = 0; i < toolCalls.length; i += this.batchSize) {
      const batch = toolCalls.slice(i, i + this.batchSize);
      const batchPromises = batch.map(toolCall => this.executeSingleTool(wrapper, toolCall));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 执行单个MCP工具
   */
  private async executeSingleTool(wrapper: MCPClientWrapper, toolCall: ToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await wrapper.client.callTool(toolCall.function.name, args);

      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify({
          success: result.success,
          content: result.content,
          error: result.error,
          serverName: result.serverName,
          executionTime: result.executionTime,
          toolType: 'mcp',
          transport: wrapper.type
        })
      };
    } catch (error) {
      console.error(`MCP工具执行失败 ${toolCall.function.name}:`, error);
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
          toolName: toolCall.function.name,
          toolType: 'mcp',
          transport: wrapper.type
        })
      };
    }
  }

  /**
   * 按原始工具调用顺序排序结果
   */
  private sortResultsByOriginalOrder(toolCalls: ToolCall[], results: ToolResult[]): ToolResult[] {
    const resultMap = new Map<string, ToolResult>();
    results.forEach(result => resultMap.set(result.tool_call_id, result));
    
    return toolCalls.map(call => 
      resultMap.get(call.id) || {
        tool_call_id: call.id,
        role: 'tool',
        content: JSON.stringify({
          success: false,
          error: '工具执行结果丢失',
          toolName: call.function.name,
          toolType: 'mcp'
        })
      }
    );
  }

  /**
   * 获取所有MCP工具定义
   */
  async getAllToolDefinitions(): Promise<any[]> {
    const toolDefinitions: any[] = [];

    for (const [serverName, wrapper] of this.clients) {
      try {
        const tools = await wrapper.client.listTools();
        tools.forEach(tool => {
          toolDefinitions.push({
            type: "function",
            function: {
              name: tool.name,
              description: `[MCP:${serverName}:${wrapper.type.toUpperCase()}] ${tool.description}`,
              parameters: tool.inputSchema
            },
            _metadata: {
              type: 'mcp',
              serverName: serverName,
              transport: wrapper.type,
              category: wrapper.config.category
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
    const serverStatus = Array.from(this.clients.entries()).map(([name, wrapper]) => {
      let connectionState = 'unknown';
      let serverInfo: any = {};

      if (wrapper.type === 'websocket') {
        const wsClient = wrapper.client as WebSocketMCPClient;
        connectionState = wsClient.getConnectionState();
        serverInfo = wsClient.getServerInfo();
      } else {
        const httpClient = wrapper.client as StandardMCPClient;
        connectionState = httpClient.isConnected() ? 'connected' : 'disconnected';
        serverInfo = httpClient.getServerInfo();
      }

      return {
        name,
        connected: connectionState === 'connected',
        connectionState,
        transport: wrapper.type,
        info: serverInfo
      };
    });

    return {
      initialized: this.isInitialized,
      servers: serverStatus,
      totalTools: this.toolToServerMap.size,
      batchSize: this.batchSize,
      connectionTypes: {
        websocket: serverStatus.filter(s => s.transport === 'websocket').length,
        http: serverStatus.filter(s => s.transport === 'http').length
      }
    };
  }

  /**
   * 设置批处理大小
   */
  setBatchSize(size: number): void {
    this.batchSize = Math.max(1, Math.min(10, size)); // 限制在1-10之间
    console.log(`🔧 MCP批处理大小设置为: ${this.batchSize}`);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any[] }> {
    const details: any[] = [];
    let allHealthy = true;

    for (const [serverName, wrapper] of this.clients) {
      try {
        const startTime = Date.now();
        
        if (wrapper.type === 'websocket') {
          const wsClient = wrapper.client as WebSocketMCPClient;
          const state = wsClient.getConnectionState();
          const isHealthy = state === ConnectionState.CONNECTED;
          
          if (!isHealthy && state !== ConnectionState.CONNECTING) {
            // 尝试重连
            await wsClient.connect();
          }
          
          details.push({
            server: serverName,
            transport: 'websocket',
            healthy: wsClient.getConnectionState() === ConnectionState.CONNECTED,
            state: wsClient.getConnectionState(),
            responseTime: Date.now() - startTime
          });
        } else {
          // HTTP客户端健康检查
          const httpClient = wrapper.client as StandardMCPClient;
          const isHealthy = httpClient.isConnected();
          
          details.push({
            server: serverName,
            transport: 'http',
            healthy: isHealthy,
            state: isHealthy ? 'connected' : 'disconnected',
            responseTime: Date.now() - startTime
          });
        }
      } catch (error) {
        allHealthy = false;
        details.push({
          server: serverName,
          transport: wrapper.type,
          healthy: false,
          error: error instanceof Error ? error.message : '未知错误',
          responseTime: Date.now()
        });
      }
    }

    allHealthy = allHealthy && details.every(d => d.healthy);

    return { healthy: allHealthy, details };
  }

  /**
   * 关闭所有连接
   */
  async shutdown(): Promise<void> {
    console.log('🔌 关闭所有MCP连接...');
    
    const shutdownPromises = Array.from(this.clients.values()).map(async (wrapper) => {
      try {
        if (wrapper.type === 'websocket') {
          const wsClient = wrapper.client as WebSocketMCPClient;
          await wsClient.disconnect();
        }
        // HTTP客户端不需要显式关闭
      } catch (error) {
        console.error(`关闭连接失败 (${wrapper.config.name}):`, error);
      }
    });

    await Promise.all(shutdownPromises);
    
    this.clients.clear();
    this.toolToServerMap.clear();
    this.isInitialized = false;
    
    console.log('✅ 所有MCP连接已关闭');
  }
}