export interface MCPServerConfig {
  name: string;
  url: string;
  transport: 'http-stream' | 'sse' | 'websocket'; // 传输协议类型
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
    // 根据高德地图官方示例格式：https://mcp.amap.com/mcp?key=您的API密钥
    url: `https://mcp.amap.com/mcp?key=${process.env.NEXT_PUBLIC_AMAP_API_KEY || 'your_amap_api_key'}`,
    transport: 'http-stream',
    description: '提供地图导航、位置查询、路线规划等服务',
    enabled: true,
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 5000,
    category: '地图导航'
  },
  {
    name: '和风天气',
    // 假设和风天气也提供类似的MCP服务格式
    url: `https://api.qweather.com/mcp?key=${process.env.NEXT_PUBLIC_QWEATHER_API_KEY || 'your_qweather_api_key'}`,
    transport: 'http-stream',
    description: '提供天气查询、预报、气象数据服务',
    enabled: false, // 默认禁用，等确认服务可用
    connectionStrategy: 'startup',
    retryAttempts: 3,
    retryDelay: 5000,
    category: '天气信息'
  },
  {
    name: '文件处理',
    url: `https://file-mcp.example.com/mcp?key=${process.env.NEXT_PUBLIC_FILE_MCP_KEY || 'your_file_api_key'}`,
    transport: 'http-stream',
    description: '提供文件上传、下载、转换等服务',
    enabled: false,
    connectionStrategy: 'onDemand',
    retryAttempts: 2,
    retryDelay: 3000,
    category: '文件操作'
  }
];

// 获取启动时连接的服务器
export const getStartupServers = (): MCPServerConfig[] => {
  console.log('🔍 getStartupServers: 检查启动服务器配置');
  console.log('🔍 环境变量NEXT_PUBLIC_AMAP_API_KEY:', process.env.NEXT_PUBLIC_AMAP_API_KEY ? '✅已设置' : '❌未设置');
  
  const startupServers = MCP_SERVERS.filter(server => {
    const isEnabled = server.enabled;
    const isStartup = server.connectionStrategy === 'startup';
    console.log(`🔍 服务器 ${server.name}: enabled=${isEnabled}, strategy=${server.connectionStrategy}, url=${server.url}`);
    return isEnabled && isStartup;
  });
  
  console.log(`🔍 筛选出 ${startupServers.length} 个启动时服务器`);
  return startupServers;
};

// 获取按需连接的服务器
export const getOnDemandServers = (): MCPServerConfig[] => {
  return MCP_SERVERS.filter(server => 
    server.enabled && server.connectionStrategy === 'onDemand'
  );
};