import { MCPServerConfig } from '@/config/mcpServers';
import { MCPConnectionConfig } from '@/types/mcp';

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

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  INITIALIZING = 'initializing',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

export class WebSocketMCPClient {
  private serverConfig: MCPServerConfig;
  private connectionConfig: MCPConnectionConfig;
  private ws?: WebSocket;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>();
  private connectionState = ConnectionState.DISCONNECTED;
  private serverCapabilities?: any;
  private reconnectAttempt = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private lastHeartbeat = Date.now();
  private eventListeners = new Map<string, Function[]>();

  constructor(serverConfig: MCPServerConfig, connectionConfig?: MCPConnectionConfig) {
    this.serverConfig = serverConfig;
    this.connectionConfig = {
      heartbeatInterval: 30000,
      reconnectAttempts: 5,
      reconnectDelay: 5000,
      connectionTimeout: 15000,
      ...connectionConfig
    };
  }

  /**
   * 连接到MCP服务器
   */
  async connect(): Promise<boolean> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      console.log(`🔗 MCP客户端已连接: ${this.serverConfig.name}`);
      return true;
    }

    if (this.connectionState === ConnectionState.CONNECTING) {
      console.log(`🔄 MCP客户端正在连接中: ${this.serverConfig.name}`);
      return false;
    }

    try {
      this.setConnectionState(ConnectionState.CONNECTING);
      console.log(`🔌 开始连接MCP服务器: ${this.serverConfig.name}`);

      // 如果配置的是HTTP URL，转换为WebSocket URL
      const wsUrl = this.convertToWebSocketUrl(this.serverConfig.url);
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();

      // 等待连接建立
      const connected = await this.waitForConnection();
      
      if (connected) {
        // 执行MCP初始化握手
        const initialized = await this.performMCPHandshake();
        if (initialized) {
          this.setConnectionState(ConnectionState.CONNECTED);
          this.startHeartbeat();
          this.reconnectAttempt = 0;
          console.log(`✅ MCP服务器连接成功: ${this.serverConfig.name}`);
          return true;
        }
      }

      this.setConnectionState(ConnectionState.ERROR);
      return false;

    } catch (error) {
      console.error(`❌ MCP服务器连接失败 (${this.serverConfig.name}):`, error);
      this.setConnectionState(ConnectionState.ERROR);
      return false;
    }
  }

  /**
   * 转换HTTP URL为WebSocket URL
   */
  private convertToWebSocketUrl(httpUrl: string): string {
    const url = new URL(httpUrl);
    
    // 转换协议
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }
    
    // 如果路径包含 /mcp，保持；否则添加 /ws 路径
    if (!url.pathname.includes('/mcp')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/ws';
    }
    
    return url.toString();
  }

  /**
   * 设置WebSocket事件处理器
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log(`🌐 WebSocket连接已建立: ${this.serverConfig.name}`);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error(`解析消息失败 (${this.serverConfig.name}):`, error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`🔌 WebSocket连接关闭 (${this.serverConfig.name}): 代码=${event.code}, 原因=${event.reason}`);
      this.cleanup();
      
      if (this.connectionState !== ConnectionState.DISCONNECTED) {
        this.handleReconnection();
      }
    };

    this.ws.onerror = (error) => {
      console.error(`❌ WebSocket错误 (${this.serverConfig.name}):`, error);
      this.setConnectionState(ConnectionState.ERROR);
    };
  }

  /**
   * 等待WebSocket连接建立
   */
  private waitForConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.ws) {
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        resolve(false);
      }, this.connectionConfig.connectionTimeout);

      const onOpen = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      const onError = () => {
        clearTimeout(timeout);
        resolve(false);
      };

      if (this.ws.readyState === WebSocket.OPEN) {
        clearTimeout(timeout);
        resolve(true);
      } else {
        this.ws.addEventListener('open', onOpen, { once: true });
        this.ws.addEventListener('error', onError, { once: true });
      }
    });
  }

  /**
   * 执行MCP握手
   */
  private async performMCPHandshake(): Promise<boolean> {
    try {
      this.setConnectionState(ConnectionState.INITIALIZING);
      
      // 第一步：发送initialize请求
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: { listChanged: true },
          sampling: {},
          prompts: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          experimental: {
            connectionManagement: true,
            batchRequests: true
          }
        },
        clientInfo: {
          name: 'zhcj-ai-assistant',
          version: '2.0.0'
        }
      });

      this.serverCapabilities = initResult.capabilities;
      
      // 第二步：发送initialized通知
      await this.sendNotification('initialized', {});
      
      console.log(`✅ MCP握手完成: ${this.serverConfig.name}`);
      console.log(`📊 服务器能力:`, this.serverCapabilities);
      
      return true;
    } catch (error) {
      console.error(`❌ MCP握手失败 (${this.serverConfig.name}):`, error);
      return false;
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: any): void {
    // 更新心跳时间
    this.lastHeartbeat = Date.now();

    if (message.id !== undefined) {
      // 这是对请求的响应
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        
        if (message.error) {
          pending.reject(new Error(`MCP错误: ${message.error.message} (代码: ${message.error.code})`));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // 这是来自服务器的通知
      this.handleNotification(message);
    }
  }

  /**
   * 处理来自服务器的通知
   */
  private handleNotification(message: any): void {
    console.log(`📢 收到服务器通知: ${message.method}`, message.params);
    this.emit('notification', { method: message.method, params: message.params });
    
    // 处理特定通知
    switch (message.method) {
      case 'tools/list_changed':
        this.emit('toolsChanged');
        break;
      case 'prompts/list_changed':
        this.emit('promptsChanged');
        break;
      case 'resources/list_changed':
        this.emit('resourcesChanged');
        break;
    }
  }

  /**
   * 发送JSON-RPC请求
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.connectionState !== ConnectionState.CONNECTING && 
          this.connectionState !== ConnectionState.INITIALIZING && 
          this.connectionState !== ConnectionState.CONNECTED) {
        reject(new Error(`无法发送请求，连接状态: ${this.connectionState}`));
        return;
      }

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket连接未就绪'));
        return;
      }

      const requestId = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params: params || {}
      };

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时: ${method}`));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * 发送通知（无需响应）
   */
  private async sendNotification(method: string, params?: any): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket连接未就绪');
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params: params || {}
    };

    this.ws.send(JSON.stringify(notification));
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.connectionState !== ConnectionState.CONNECTED) {
      throw new Error(`MCP客户端未连接，状态: ${this.connectionState}`);
    }

    try {
      const response = await this.sendRequest('tools/list');
      const tools = response.tools || [];
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
      if (this.connectionState !== ConnectionState.CONNECTED) {
        throw new Error(`MCP客户端未连接，状态: ${this.connectionState}`);
      }

      console.log(`🔧 调用MCP工具: ${toolName} @ ${this.serverConfig.name}`);
      
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args
      });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        content: response,
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
   * 开始心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      // 检查是否长时间没有收到消息
      if (now - this.lastHeartbeat > this.connectionConfig.heartbeatInterval! * 2) {
        console.warn(`⚠️ 心跳超时，触发重连: ${this.serverConfig.name}`);
        this.handleReconnection();
        return;
      }

      // 发送ping
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.sendNotification('ping', { timestamp: now });
        } catch (error) {
          console.error(`发送心跳失败: ${this.serverConfig.name}`, error);
        }
      }
    }, this.connectionConfig.heartbeatInterval);
  }

  /**
   * 处理重连
   */
  private async handleReconnection(): Promise<void> {
    if (this.connectionState === ConnectionState.RECONNECTING) {
      return;
    }

    this.setConnectionState(ConnectionState.RECONNECTING);
    this.cleanup();

    if (this.reconnectAttempt >= this.connectionConfig.reconnectAttempts!) {
      console.error(`❌ 重连失败，已达到最大尝试次数: ${this.serverConfig.name}`);
      this.setConnectionState(ConnectionState.ERROR);
      return;
    }

    this.reconnectAttempt++;
    console.log(`🔄 开始重连 (${this.reconnectAttempt}/${this.connectionConfig.reconnectAttempts}): ${this.serverConfig.name}`);

    setTimeout(async () => {
      const success = await this.connect();
      if (!success) {
        this.handleReconnection();
      }
    }, this.connectionConfig.reconnectDelay! * this.reconnectAttempt);
  }

  /**
   * 设置连接状态
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      const oldState = this.connectionState;
      this.connectionState = state;
      console.log(`🔄 连接状态变化 (${this.serverConfig.name}): ${oldState} -> ${state}`);
      this.emit('stateChanged', { oldState, newState: state });
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // 清理所有待处理的请求
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('连接已断开'));
    });
    this.pendingRequests.clear();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, '客户端主动关闭');
      }
      this.ws = undefined;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    console.log(`🔌 断开MCP连接: ${this.serverConfig.name}`);
    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.cleanup();
  }

  /**
   * 事件系统
   */
  on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off(event: string, listener: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`事件监听器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 检查客户端状态
   */
  isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 获取服务器信息
   */
  getServerInfo() {
    return {
      name: this.serverConfig.name,
      url: this.serverConfig.url,
      transport: 'websocket',
      connectionState: this.connectionState,
      capabilities: this.serverCapabilities,
      reconnectAttempt: this.reconnectAttempt
    };
  }
}