'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import FloatingAssistant from '../../components/FloatingAssistant';
import { AssistantConfig, PageContext } from '@/types';

function EmbedContent() {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<AssistantConfig>({});
  const [contextPayload, setContextPayload] = useState<{context: PageContext, forced: boolean} | null>(null);
  const openParam = searchParams?.get('open');
  // 修复：只有明确指定open=true才自动弹出，embedded=true不自动弹出
  const initialOpen = openParam === 'true';
  const [isVisible, setIsVisible] = useState(true);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  
  // 🔧 新增：语音通话状态跟踪（embed层面的防护）
  const [isVoiceCallActive, setIsVoiceCallActive] = useState(false);
  const voiceCallActiveRef = useRef(false);

  useEffect(() => {
    // 从URL参数获取配置
    const configParam = searchParams?.get('config');
    const embedded = searchParams?.get('embedded');
    
    if (configParam) {
      try {
        const parsedConfig = JSON.parse(configParam);
        setConfig(parsedConfig);
      } catch (error) {
        console.error('解析配置失败:', error);
      }
    }

    // 只在嵌入模式下设置消息监听
    if (embedded === 'true') {
      setupMessageHandling();
    }

    // 通知父页面准备就绪
    postMessageToParent('ready', { status: 'loaded' });

    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
      }
    };
  }, [searchParams]);

  // 设置与父页面的消息通信
  const setupMessageHandling = () => {
    const messageHandler = (event: MessageEvent) => {
      // 这里应该验证消息来源，但在开发阶段先简化
      const { type, data } = event.data;
      console.log('Embed页面收到消息:', type, data); // 添加调试日志

      switch (type) {
        case 'ai-assistant-init':
          console.log('处理初始化消息');
          if (data.config) {
            setConfig(prev => ({ ...prev, ...data.config }));
          }
          break;

        case 'ai-assistant-show':
          setIsVisible(true);
          break;

        case 'ai-assistant-hide':
          setIsVisible(false);
          break;

        case 'ai-assistant-updateConfig':
          if (data.config) {
            setConfig(prev => ({ ...prev, ...data.config }));
          }
          break;

        case 'ai-assistant-updateContext':
          // 🔧 强化防护：语音通话期间阻止上下文更新
          if (voiceCallActiveRef.current) {
            console.log('🚫 语音通话进行中，在embed层阻止上下文更新，保护通话稳定性');
            return;
          }
          
          // 转发上下文更新消息给FloatingAssistant组件
          console.log('✅ 接收到上下文更新，通过prop传递（embed层安全检查通过）');
          if (event.data.payload) {
            setContextPayload(event.data.payload);
          }
          break;
          
        case 'ai-assistant-voiceCallStateChange':
          // 🔧 新增：监听语音通话状态变化
          console.log('📞 收到语音通话状态变化:', data.isActive);
          setIsVoiceCallActive(data.isActive);
          voiceCallActiveRef.current = data.isActive;
          break;

        default:
          // 忽略未知消息类型
          break;
      }
    };

    messageHandlerRef.current = messageHandler;
    window.addEventListener('message', messageHandler);
  };

  // 向父页面发送消息
  const postMessageToParent = (type: string, data: Record<string, unknown> = {}) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: `ai-assistant-${type}`, data },
        '*' // 生产环境中应该指定具体的origin
      );
    }
  };

  // 错误处理
  const handleError = (error: Error) => {
    console.error('AI Assistant 错误:', error);
    postMessageToParent('error', { 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="w-full h-full">
      {/* 确保在嵌入环境中样式正确 */}
      <style jsx global>{`
        body {
          margin: 0;
          padding: 0;
          background: transparent !important;
          overflow: hidden;
        }
        
        html {
          background: transparent !important;
        }

        /* 确保悬浮助手在iframe中正常显示 */
        #ai-assistant-container {
          position: relative !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
      
      <FloatingAssistant 
        initialOpen={initialOpen}
        config={config}
        onError={handleError}
        contextPayload={contextPayload}
      />
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EmbedContent />
    </Suspense>
  );
} 