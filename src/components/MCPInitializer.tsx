'use client';

import { useEffect } from 'react';

export function MCPInitializer() {
  useEffect(() => {
    // 新架构中，工具路由器在API调用时自动初始化
    // 这里可以进行一些客户端的初始化工作
    async function initializeClient() {
      console.log('🎬 MCPInitializer: 客户端组件加载完成');
      
      try {
        // 可选：预热工具路由器（通过API调用）
        console.log('🔥 MCPInitializer: 预热工具系统...');
        
        const response = await fetch('/api/tools', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ MCPInitializer: 工具系统预热完成', {
            totalTools: data.tools?.length || 0,
            status: data.status
          });
        } else {
          console.warn('⚠️ MCPInitializer: 工具系统预热失败');
        }
        
      } catch (error) {
        console.error('❌ MCPInitializer: 客户端初始化失败:', error);
        // 不阻塞应用运行
      }
    }

    // 确保在客户端运行
    if (typeof window !== 'undefined') {
      console.log('🌐 MCPInitializer: 在客户端环境中运行');
      initializeClient();
    } else {
      console.log('🖥️ MCPInitializer: 在服务端环境中，跳过初始化');
    }
  }, []);

  // This component doesn't render anything visible
  return null;
}