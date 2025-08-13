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
  connected: boolean;
  info: {
    name: string;
    url: string;
    transport: string;
    isConnected: boolean;
    capabilities?: any;
  };
}

export interface MCPConnectionState {
  servers: Record<string, MCPServerStatus>;
  totalTools: number;
  isInitialized: boolean;
}

// JSON-RPC 2.0 标准格式
export interface MCPJsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, any>;
}

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

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    sampling?: {};
    prompts?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

