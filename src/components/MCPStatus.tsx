import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RotateCcw, Settings } from 'lucide-react';
import { MCPConnectionState } from '@/types';

interface MCPStatusProps {
  className?: string;
}

export const MCPStatus: React.FC<MCPStatusProps> = ({ className }) => {
  const [connectionState, setConnectionState] = useState<MCPConnectionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 获取MCP状态
  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/mcp/status');
      if (response.ok) {
        const data = await response.json();
        setConnectionState(data);
      }
    } catch (error) {
      console.error('获取MCP状态失败:', error);
    }
  };

  // 刷新连接
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await fetch('/api/mcp/refresh', { method: 'POST' });
      await fetchStatus();
    } catch (error) {
      console.error('刷新MCP连接失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // 每30秒自动刷新状态
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!connectionState) {
    return (
      <div className={`text-sm text-gray-500 ${className}`}>
        MCP状态加载中...
      </div>
    );
  }

  const connectedServers = Object.values(connectionState.servers)
    .filter(server => server.status === 'connected');
  
  const hasErrors = Object.values(connectionState.servers)
    .some(server => server.status === 'error');

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {connectedServers.length > 0 ? (
            <Wifi size={16} className="text-green-500" />
          ) : (
            <WifiOff size={16} className="text-red-500" />
          )}
          <span className="text-sm font-medium">
            MCP服务 ({connectedServers.length}/{Object.keys(connectionState.servers).length})
          </span>
        </div>
        
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="刷新连接"
        >
          <RotateCcw size={14} className={`text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2">
        {Object.values(connectionState.servers).map((server) => (
          <div
            key={server.name}
            className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                server.status === 'connected' ? 'bg-green-500' :
                server.status === 'connecting' ? 'bg-yellow-500' :
                server.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
              }`} />
              <span className="font-medium">{server.name}</span>
              <span className="text-gray-500">({server.category})</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-gray-600">{server.toolCount} 工具</span>
              {server.error && (
                <span className="text-red-600" title={server.error}>⚠️</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {connectionState.totalTools > 0 && (
        <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-blue-800">
          总计 {connectionState.totalTools} 个MCP工具可用
        </div>
      )}

      {hasErrors && (
        <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-800">
          部分服务连接异常，功能可能受限
        </div>
      )}
    </div>
  );
};