import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { ChevronDown, ChevronRight, MessageCircle, Mic, Search, Settings, Volume2, Copy, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { ReasoningChatMessage } from '@/types';

import 'highlight.js/styles/github.css'; // 代码高亮样式

interface UnifiedMessageProps {
  message: ReasoningChatMessage;
  onToggleReasoning?: () => void;
  onPlayAudio?: (audioUrl: string) => void;
  onRegenerateAudio?: (messageId: string, text: string) => void;
}

// 读取OpenManus后端地址（构建时注入），默认本地8001
const OPENMANUS_BASE_URL = process.env.NEXT_PUBLIC_OPENMANUS_API_URL || 'http://127.0.0.1:8001';

const UnifiedMessage: React.FC<UnifiedMessageProps> = memo(({
  message,
  onToggleReasoning,
  onPlayAudio,
  onRegenerateAudio
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const finalMessageRef = useRef<HTMLDivElement>(null);

  // 流式显示状态
  const [displayedContent, setDisplayedContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  
  // 追踪上次处理的内容长度
  const lastContentLengthRef = useRef(0);
  const streamingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateDebounceRef = useRef<NodeJS.Timeout | null>(null);

  /* ------------------------------------------------------------------
   * OpenManus 日志流处理
   * ------------------------------------------------------------------*/
  const [taskLogs, setTaskLogs] = useState<{ [taskId: string]: string[] }>({});
  const [logVisibility, setLogVisibility] = useState<{ [taskId: string]: boolean }>({});
  const eventSourcesRef = useRef<{ [taskId: string]: EventSource }>({});

  const startLogStream = useCallback((taskId: string) => {
    // 避免重复创建
    if (eventSourcesRef.current[taskId]) return;

    const es = new EventSource(`${OPENMANUS_BASE_URL}/api/task_logs/${taskId}`);

    es.onmessage = (e) => {
      const line = e.data as string;
      setTaskLogs((prev) => {
        const existing = prev[taskId] || [];
        return { ...prev, [taskId]: [...existing, line] };
      });

      // 收尾关闭
      if (line.trim() === '[任务结束]') {
        es.close();
        delete eventSourcesRef.current[taskId];
      }
    };

    es.onerror = () => {
      es.close();
      delete eventSourcesRef.current[taskId];
    };

    eventSourcesRef.current[taskId] = es;
  }, []);

  // 深度提取 task_id 的工具函数
  const extractTaskIds = (data: any): string[] => {
    const ids: string[] = [];
    if (!data) return ids;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return ids; }
    }
    if (Array.isArray(data)) {
      data.forEach(item => ids.push(...extractTaskIds(item)));
    } else if (typeof data === 'object') {
      if (data.task_id && typeof data.task_id === 'string') {
        ids.push(data.task_id);
      }
      // 遍历所有属性
      Object.values(data).forEach(v => ids.push(...extractTaskIds(v)));
    }
    return ids;
  };

  // 监测工具执行结果，若包含OpenManus task_id 则启动日志流
  useEffect(() => {
    if (message.toolExecution?.results) {
      message.toolExecution.results.forEach((res: any) => {
        let root: any = res;
        if (res.content) root = res.content;
        const ids = extractTaskIds(root);
        ids.forEach(id => startLogStream(id));
      });
    }

    // 清理函数：组件卸载时关闭所有 EventSource
    return () => {
      Object.values(eventSourcesRef.current).forEach((es) => es.close());
      eventSourcesRef.current = {};
    };
  }, [message.toolExecution?.results, startLogStream]);

  // 直接显示内容，不做额外的流式处理
  useEffect(() => {
    // 直接显示完整内容，因为真正的流式处理在FloatingAssistant中已经完成
    setDisplayedContent(message.content || '');
    setIsStreaming(false);
    lastContentLengthRef.current = (message.content || '').length;

    // 清理函数
    return () => {
      if (streamingTimerRef.current) {
        clearInterval(streamingTimerRef.current);
      }
      if (updateDebounceRef.current) {
        clearTimeout(updateDebounceRef.current);
      }
    };
  }, [message.content, message.messageType]);

  // Markdown渲染组件
  const MarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => (
    <div className={`prose prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          code: ({ node, inline, className, children, ...props }: any) => {
            if (inline) {
              return (
                <code
                  className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          a: ({ href, children, ...props }: any) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
              {...props}
            >
              {children}
            </a>
          ),
          table: ({ children, ...props }: any) => (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }: any) => (
            <th className="px-3 py-2 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }: any) => (
            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100" {...props}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );

  // 渲染思维链
  const renderReasoning = () => {
    if (!message.reasoningContent) return null;

    return (
      <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div 
          className="flex items-center justify-between p-3 bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={onToggleReasoning}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">思维过程</span>
            {!message.isReasoningComplete && (
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {message.isReasoningComplete && message.reasoningDuration && (
              <span className="text-xs text-gray-500">{message.reasoningDuration}s</span>
            )}
            <button className="p-1 rounded hover:bg-gray-200 transition-colors">
              {message.isCollapsed ? (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
          </div>
        </div>

        {!message.isCollapsed && (
          <div 
            ref={contentRef}
            className="p-4 max-h-64 overflow-y-auto text-sm text-gray-700 leading-relaxed whitespace-pre-wrap"
          >
            {message.reasoningContent}
            {!message.isReasoningComplete && (
              <span className="inline-block w-2 h-4 bg-gray-500 ml-1 animate-pulse"></span>
            )}
          </div>
        )}
      </div>
    );
  };

  // 渲染工具执行（含OpenManus日志）
  const renderToolExecution = () => {
    if (!message.toolExecution) return null;

    // 检测 OpenManus 任务
    const openManusTasks = message.toolExecution.results
      .map((r: any) => {
        let obj: any;
        if (r.result !== undefined) {
          obj = r.result;
        } else if (r.content) {
          try { obj = JSON.parse(r.content); } catch { obj = null; }
        }

        // 如果是数组（executeOpenManusTools包装结果），取首个元素解析
        if (Array.isArray(obj) && obj.length > 0) {
          try { obj = JSON.parse(obj[0].content); } catch { obj = null; }
        }

        return obj && obj.task_id ? { taskId: obj.task_id, status: obj.status } : null;
      })
      .filter(Boolean) as Array<{ taskId: string; status: string }>;

    return (
      <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              执行了 {message.toolExecution.toolCalls.length} 个工具
            </span>
            <span className="text-xs text-gray-500">
              {message.toolExecution.status === 'executing' ? '执行中...' :
               message.toolExecution.status === 'pending' ? '等待中...' :
               message.toolExecution.status === 'completed' ? '已完成' : '执行失败'}
            </span>
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          {message.toolExecution.toolCalls.map((toolCall, index) => (
            <div key={toolCall.id} className="mb-3 last:mb-0">
              <div className="text-sm font-medium text-gray-700 mb-1">
                {getToolDisplayName(toolCall.function.name)}
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                {JSON.stringify(JSON.parse(toolCall.function.arguments), null, 2)}
              </div>
            </div>
          ))}

          {/* OpenManus 任务日志显示 */}
          {openManusTasks.map(({ taskId, status }) => {
            const logs = taskLogs[taskId] || [];
            const visible = logVisibility[taskId] ?? false;
            const toggleVisibility = () => setLogVisibility(prev => ({ ...prev, [taskId]: !visible }));

            return (
              <div key={taskId} className="border-t border-gray-200 pt-3">
                <div className="flex items-center justify-between cursor-pointer" onClick={toggleVisibility}>
                  <span className="text-xs text-gray-600">OpenManus 任务 {taskId.slice(0,8)}… ({status || '运行中'})</span>
                  <button className="text-blue-600 text-xs">{visible ? '隐藏日志' : '查看日志'}</button>
                </div>
                {visible && (
                  <pre className="mt-2 max-h-52 overflow-y-auto text-xs bg-gray-50 p-2 rounded text-gray-700 whitespace-pre-wrap">
                    {logs.length === 0 ? '等待日志...' : logs.join('\n')}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 渲染普通消息
  const renderMessage = () => {
    if (message.messageType === 'reasoning' || message.messageType === 'tool_execution') {
      return null; // 这些类型通过上面的特殊渲染处理
    }

    return (
      <div className="flex gap-3">
        {/* 头像 */}
        <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center flex-shrink-0">
          {message.role === 'user' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 0 0-11.215 0c-.22.578.254 1.139.872 1.139h9.47z"/>
            </svg>
          ) : (
            <span className="text-white text-xs font-bold">AI</span>
          )}
        </div>
        
        {/* 消息内容 */}
        <div className="flex-1" ref={message.messageType === 'assistant_final' ? finalMessageRef : undefined}>
          {message.role === 'assistant' && message.messageType === 'assistant_final' ? (
                    <div className="text-gray-900">
          <MarkdownRenderer content={displayedContent} />
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-gray-500 ml-1 animate-pulse"></span>
          )}
              {/* 语音标识 */}
              {message.isVoice && (
                <span className="ml-2 inline-flex items-center">
                  <Mic size={12} className="opacity-75" />
                </span>
              )}
            </div>
          ) : (
            <p className="text-gray-900">
              {message.content}
              {/* 语音标识 */}
              {message.isVoice && (
                <span className="ml-2 inline-flex items-center">
                  <Mic size={12} className="opacity-75" />
                </span>
              )}
            </p>
          )}
          
          {/* 语音播放按钮 */}
          {message.audioUrl && onPlayAudio && (
            <button
              onClick={() => onPlayAudio(message.audioUrl!)}
              className="mt-2 p-1.5 hover:bg-gray-100 rounded transition-colors"
            >
              <Volume2 size={14} className="text-gray-400" />
            </button>
          )}
          
          {/* 重新生成语音按钮 */}
          {onRegenerateAudio && (
            <button
              onClick={() => onRegenerateAudio(message.id, message.content)}
              className="mt-2 ml-1 p-1.5 hover:bg-gray-100 rounded transition-colors"
              title="重新生成语音"
            >
              <RefreshCw size={14} className="text-gray-400" />
            </button>
          )}
          
          {/* 搜索来源 */}
          {message.searchSources && message.searchSources.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">Sources</p>
              <div className="space-y-2">
                {message.searchSources.map((source, idx) => (
                  <a
                    key={idx}
                    href={source.url}
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors group"
                  >
                    <Search size={16} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 group-hover:text-blue-600">{source.name}</p>
                      <p className="text-xs text-gray-500">{source.siteName}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* 思维链显示 */}
      {renderReasoning()}
      
      {/* 工具执行显示 */}
      {renderToolExecution()}
      
      {/* 普通消息显示 */}
      {renderMessage()}
      
      {/* 操作按钮 - 只对AI回复显示 */}
      {(message.role === 'assistant' && message.messageType === 'assistant_final') && (
        <div className="flex items-center gap-1 mt-2 ml-11">
          <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
            <Copy size={14} className="text-gray-400" />
          </button>
          <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
            <ThumbsUp size={14} className="text-gray-400" />
          </button>
          <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
            <ThumbsDown size={14} className="text-gray-400" />
          </button>
        </div>
      )}
    </div>
  );
});

// 工具名称显示映射
function getToolDisplayName(toolName: string): string {
  const toolNames: Record<string, string> = {
    'get_weather': '天气查询',
    'web_search': '网络搜索',
    'openmanus_web_automation': '网页自动化',
    'openmanus_code_execution': '代码执行',
    'openmanus_file_operations': '文件操作',
    'openmanus_general_task': '通用任务'
  };
  return toolNames[toolName] || toolName;
}

export default UnifiedMessage; 