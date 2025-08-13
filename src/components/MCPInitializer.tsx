'use client';

import { useEffect } from 'react';

export function MCPInitializer() {
  useEffect(() => {
    // Initialize MCP connector when the app starts
    async function initializeMCP() {
      console.log('🎬 MCPInitializer: 开始初始化MCP');
      try {
        // Dynamic import to avoid server-side issues
        console.log('📦 MCPInitializer: 动态导入mcpConnector');
        const { mcpConnector } = await import('@/utils/mcpConnector');
        
        console.log('🚀 MCPInitializer: 调用mcpConnector.initialize()');
        await mcpConnector.initialize();
        
        console.log('✅ MCPInitializer: MCP初始化完成');
        
        // 检查初始化结果
        const connectionState = mcpConnector.getConnectionState();
        console.log('📊 MCPInitializer: 连接状态', connectionState);
        
      } catch (error) {
        console.error('❌ MCPInitializer: MCP初始化失败:', error);
      }
    }

    // 确保在客户端运行
    if (typeof window !== 'undefined') {
      console.log('🌐 MCPInitializer: 在客户端环境中运行');
      initializeMCP();
    } else {
      console.log('🖥️ MCPInitializer: 在服务端环境中，跳过初始化');
    }
  }, []);

  // This component doesn't render anything visible
  return null;
}