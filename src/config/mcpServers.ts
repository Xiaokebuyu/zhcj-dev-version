export interface MCPServerConfig {
  name: string;
  url: string;
  transport: 'sse' | 'http-stream' | 'websocket';
  description: string;
  enabled: boolean;
  connectionStrategy: 'startup' | 'onDemand';
  retryAttempts?: number;
  retryDelay?: number;
  category: string;
}

export const MCP_SERVERS: MCPServerConfig[] = [
  {
    name: '高德地图',
    // ✅ 你的修正：使用/mcp端点，支持JSON-RPC over HTTP
    url: `https://mcp.amap.com/mcp?key=${process.env.NEXT_PUBLIC_AMAP_API_KEY || 'your_amap_api_key'}`,
    transport: 'http-stream', // ✅ 你的修正：http-stream协议
    description: '高德地图官方MCP服务，支持12大核心地图服务接口',
    enabled: true,
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 5000,
    category: '地图导航'
  },
  {
    name: '高德地图-SSE',
    // ✅ SSE端点作为备用，默认禁用
    url: `https://mcp.amap.com/sse?key=${process.env.NEXT_PUBLIC_AMAP_API_KEY || 'your_amap_api_key'}`,
    transport: 'sse',
    description: '高德地图SSE端点（需要GET请求，暂不支持）',
    enabled: false, // 禁用，因为需要不同的连接方式
    connectionStrategy: 'onDemand',
    retryAttempts: 2,
    retryDelay: 3000,
    category: '地图导航'
  },
  {
    name: '和风天气',
    url: `https://api.qweather.com/mcp?key=${process.env.NEXT_PUBLIC_QWEATHER_API_KEY || 'your_qweather_api_key'}`,
    transport: 'http-stream',
    description: '提供天气查询、预报、气象数据服务',
    enabled: false, // 暂时禁用，等确认服务可用
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 5000,
    category: '天气信息'
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