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

export interface MCPServerStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  toolCount: number;
  lastConnected?: Date;
  error?: string;
  category: string;
  transport?: 'http-stream' | 'sse' | 'websocket'; // 传输协议类型
}

export interface MCPConnectionState {
  servers: Record<string, MCPServerStatus>;
  totalTools: number;
  isInitialized: boolean;
}

// JSON-RPC 2.0 请求格式
export interface MCPJsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, any>;
}

// JSON-RPC 2.0 响应格式
export interface MCPJsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// MCP服务器健康状态
export interface MCPServerHealth {
  healthy: boolean;
  lastCheck: Date;
  error?: string;
}