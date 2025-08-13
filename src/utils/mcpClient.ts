import { MCPTool, MCPCallResult, MCPServerStatus } from '../types/mcp';
import { MCPServerConfig } from '../config/mcpServers';

export class MCPClient {
  private serverConfig: MCPServerConfig;
  private requestId = 0;
  private isHealthy = false;
  private lastHealthCheck?: Date;

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig;
  }

  async connect(): Promise<boolean> {
    try {
      console.log(`🔌 初始化MCP服务器连接: ${this.serverConfig.name}`);
      
      // HTTP协议不需要持久连接，直接进行健康检查
      return await this.checkHealth();
    } catch (error) {
      console.error(`MCP服务器初始化失败 (${this.serverConfig.name}):`, error);
      return false;
    }
  }

  private async checkHealth(): Promise<boolean> {
    try {
      // 通过尝试获取工具列表来检查服务健康状态
      const tools = await this.listTools();
      this.isHealthy = true;
      this.lastHealthCheck = new Date();
      console.log(`✅ MCP服务器健康检查通过: ${this.serverConfig.name} (${tools.length} 工具可用)`);
      return true;
    } catch (error) {
      this.isHealthy = false;
      console.error(`❌ MCP服务器健康检查失败 (${this.serverConfig.name}):`, error);
      return false;
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    const requestId = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: params || {}
    };

    try {
      console.log(`📤 发送MCP请求: ${method} @ ${this.serverConfig.name}`);
      
      const response = await fetch(this.serverConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream', // 高德地图MCP服务要求
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000), // 15秒超时
      });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let responseText = '';
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          responseText += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      // 解析JSON-RPC响应
      const jsonResponse = JSON.parse(responseText.trim());
      
      if (jsonResponse.error) {
        throw new Error(`MCP错误: ${jsonResponse.error.message} (代码: ${jsonResponse.error.code})`);
      }

      return jsonResponse;
    } catch (error) {
      console.error(`MCP请求失败 (${this.serverConfig.name}):`, error);
      throw error;
    }
  }

  async listTools(): Promise<MCPTool[]> {
    try {
      const response = await this.sendRequest('tools/list');
      return response.result?.tools || [];
    } catch (error) {
      console.error(`获取工具列表失败 (${this.serverConfig.name}):`, error);
      throw error; // 重新抛出错误，让上层处理
    }
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<MCPCallResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🔧 调用MCP工具: ${toolName} @ ${this.serverConfig.name}`);
      
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args
      });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        content: response.result,
        toolName,
        serverName: this.serverConfig.name,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      console.error(`工具调用失败 (${toolName} @ ${this.serverConfig.name}):`, errorMessage);
      
      return {
        success: false,
        error: errorMessage,
        toolName,
        serverName: this.serverConfig.name,
        executionTime
      };
    }
  }

  // 对于HTTP协议，disconnect主要用于清理状态
  disconnect() {
    this.isHealthy = false;
    this.lastHealthCheck = undefined;
    console.log(`🔌 断开MCP服务器: ${this.serverConfig.name}`);
  }

  getStatus(): MCPServerStatus {
    const now = new Date();
    const isStale = this.lastHealthCheck && 
      (now.getTime() - this.lastHealthCheck.getTime()) > 60000; // 1分钟内的检查有效

    return {
      name: this.serverConfig.name,
      status: this.isHealthy && !isStale ? 'connected' : 'disconnected',
      toolCount: 0, // 将在连接器中更新
      lastConnected: this.lastHealthCheck,
      category: this.serverConfig.category
    };
  }

  isServerConnected(): boolean {
    const now = new Date();
    const isStale = this.lastHealthCheck && 
      (now.getTime() - this.lastHealthCheck.getTime()) > 60000; // 1分钟内的检查有效
    
    return this.isHealthy && !isStale;
  }

  // 手动触发健康检查
  async refreshHealth(): Promise<boolean> {
    return await this.checkHealth();
  }
}