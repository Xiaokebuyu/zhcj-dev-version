import { MCPServerConfig } from '@/config/mcpServers';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPCallResult {
  success: boolean;
  content?: any;
  error?: string;
  toolName: string;
  serverName: string;
  executionTime?: number;
}

export class StandardMCPClient {
  private serverConfig: MCPServerConfig;
  private requestId = 0;
  private isInitialized = false;
  private serverCapabilities?: any;

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig;
  }

  /**
   * 标准MCP初始化流程
   */
  async initialize(): Promise<boolean> {
    try {
      console.log(`🔌 初始化MCP服务器: ${this.serverConfig.name} (${this.serverConfig.transport})`);

      // 第一步：发送initialize请求
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'zhcj-ai-assistant',
          version: '1.0.0'
        }
      });

      this.serverCapabilities = initResult.result?.capabilities;
      
      // 第二步：发送initialized通知
      await this.sendNotification('initialized');
      
      this.isInitialized = true;
      console.log(`✅ MCP服务器初始化成功: ${this.serverConfig.name}`);
      console.log(`📊 服务器能力:`, this.serverCapabilities);
      
      return true;
    } catch (error) {
      console.error(`❌ MCP服务器初始化失败 (${this.serverConfig.name}):`, error);
      return false;
    }
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.isInitialized) {
      throw new Error('MCP客户端未初始化');
    }

    try {
      const response = await this.sendRequest('tools/list');
      const tools = response.result?.tools || [];
      console.log(`📋 获取 ${this.serverConfig.name} 工具列表: ${tools.length} 个工具`);
      return tools;
    } catch (error) {
      console.error(`获取工具列表失败 (${this.serverConfig.name}):`, error);
      throw error;
    }
  }

  /**
   * 调用MCP工具
   */
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
      
      return {
        success: false,
        error: errorMessage,
        toolName,
        serverName: this.serverConfig.name,
        executionTime
      };
    }
  }

  /**
   * 发送JSON-RPC请求
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    const requestId = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: params || {}
    };

    try {
      const response = await fetch(this.serverConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // ✅ 你的修正：统一Accept头部，满足高德要求
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
      }

      // 根据传输类型和Content-Type处理响应
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // 处理SSE响应
        return await this.handleSSEResponse(response);
      } else {
        // 处理JSON响应
        return await this.handleJSONResponse(response);
      }
    } catch (error) {
      console.error(`MCP请求失败 (${this.serverConfig.name}):`, error);
      throw error;
    }
  }

  /**
   * 发送通知（无需响应）
   */
  private async sendNotification(method: string, params?: any): Promise<void> {
    const notification = {
      jsonrpc: '2.0',
      method,
      params: params || {}
    };

    await fetch(this.serverConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(10000),
    });
  }

  /**
   * 处理SSE响应
   */
  private async handleSSEResponse(response: Response): Promise<any> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取SSE响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // 处理SSE事件
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留未完成的行
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonData = line.slice(6).trim();
            if (jsonData && jsonData !== '[DONE]') {
              try {
                const parsed = JSON.parse(jsonData);
                if (parsed.error) {
                  throw new Error(`MCP错误: ${parsed.error.message}`);
                }
                if (parsed.result !== undefined) {
                  return parsed; // 返回第一个有效结果
                }
              } catch (e) {
                console.warn('解析SSE数据失败:', jsonData, e);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error('SSE响应中未找到有效结果');
  }

  /**
   * 处理JSON响应
   */
  private async handleJSONResponse(response: Response): Promise<any> {
    const jsonResponse = await response.json();
    
    if (jsonResponse.error) {
      throw new Error(`MCP错误: ${jsonResponse.error.message} (代码: ${jsonResponse.error.code})`);
    }

    return jsonResponse;
  }

  /**
   * 检查客户端状态
   */
  isConnected(): boolean {
    return this.isInitialized;
  }

  /**
   * 获取服务器信息
   */
  getServerInfo() {
    return {
      name: this.serverConfig.name,
      url: this.serverConfig.url,
      transport: this.serverConfig.transport,
      isConnected: this.isInitialized,
      capabilities: this.serverCapabilities
    };
  }
}