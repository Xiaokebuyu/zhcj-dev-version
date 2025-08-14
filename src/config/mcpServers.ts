export interface MCPServerConfig {
  name: string;
  url: string;
  transport: 'websocket' | 'stdio' | 'http-stream' | 'sse'; // WebSocket为首选标准传输
  description: string;
  enabled: boolean;
  connectionStrategy: 'startup' | 'onDemand';
  retryAttempts?: number;
  retryDelay?: number;
  category: string;
  connectionConfig?: {
    heartbeatInterval?: number;
    reconnectAttempts?: number;
    reconnectDelay?: number;
    connectionTimeout?: number;
  };
}

export const MCP_SERVERS: MCPServerConfig[] = [
  {
    name: '高德地图-WebSocket',
    url: `ws://mcp.amap.com/mcp?key=${process.env.NEXT_PUBLIC_AMAP_API_KEY || 'your_amap_api_key'}`,
    transport: 'websocket', // 标准WebSocket传输
    description: '高德地图官方MCP服务WebSocket连接（备用）',
    enabled: false, // 暂时禁用，因为返回405错误
    connectionStrategy: 'onDemand',
    retryAttempts: 2,
    retryDelay: 5000,
    category: '地图导航',
    connectionConfig: {
      heartbeatInterval: 30000,
      reconnectAttempts: 3,
      reconnectDelay: 3000,
      connectionTimeout: 15000
    }
  },
  {
    name: '高德地图',
    url: `http://mcp.amap.com/mcp?key=${process.env.NEXT_PUBLIC_AMAP_API_KEY || 'your_amap_api_key'}`,
    transport: 'http-stream',
    description: '高德地图官方MCP服务，支持12大核心地图服务接口',
    enabled: true, // 启用HTTP流传输作为主要连接方式
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 3000,
    category: '地图导航'
  },
  {
    name: '和风天气',
    url: `https://api.qweather.com/mcp?key=${process.env.NEXT_PUBLIC_QWEATHER_API_KEY || 'your_qweather_api_key'}`,
    transport: 'websocket',
    description: '提供天气查询、预报、气象数据服务',
    enabled: false, // 暂时禁用，等确认服务可用
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 5000,
    category: '天气信息',
    connectionConfig: {
      heartbeatInterval: 45000,
      reconnectAttempts: 3,
      reconnectDelay: 5000,
      connectionTimeout: 20000
    }
  }
];

export const getStartupServers = (): MCPServerConfig[] => {
  console.log('🔍 getStartupServers: 检查启动服务器配置');
  console.log('🔍 环境变量NEXT_PUBLIC_AMAP_API_KEY:', process.env.NEXT_PUBLIC_AMAP_API_KEY ? '✅已设置' : '❌未设置');
  
  const startupServers = MCP_SERVERS.filter(server => {
    const isEnabled = server.enabled;
    const isStartup = server.connectionStrategy === 'startup';
    const hasValidKey = !server.url.includes('your_amap_api_key'); // 检查是否有有效的API密钥
    
    console.log(`🔍 服务器 ${server.name}: enabled=${isEnabled}, strategy=${server.connectionStrategy}, hasValidKey=${hasValidKey}, transport=${server.transport}`);
    return isEnabled && isStartup && hasValidKey;
  });
  
  console.log(`🔍 筛选出 ${startupServers.length} 个启动时服务器`);
  return startupServers;
};

export const getOnDemandServers = (): MCPServerConfig[] => {
  return MCP_SERVERS.filter(server => 
    server.enabled && server.connectionStrategy === 'onDemand'
  );
};