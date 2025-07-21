// 工具调用相关类型
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// 新的工具执行数据类型
export interface ToolExecutionData {
  id: string;
  toolCalls: ToolCall[];
  results: (ToolResult | UnifiedChatResponse)[];
  status: 'executing' | 'pending' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

// 统一的聊天响应类型
export interface UnifiedChatResponse {
  type: 'reasoning' | 'content' | 'tool_execution' | 'tool_result' | 'pending_openmanus' | 'done' | 'error';
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  task_ids?: string[];
  final_content?: string;
  error?: string;
  messageId?: string;
  tool_call_id?: string;
  tool_name?: string;
  result?: unknown;
  full_reasoning?: string;
  full_content?: string;
  phase?: string;
  post_tool_reasoning?: string;
}

export interface ToolProgress {
  isToolCalling: boolean;
  currentTool?: string;
  progress: string;
  step: number;
  totalSteps: number;
}

// 搜索结果类型
export interface SearchResult {
  name: string;
  url: string;
  snippet: string;
  summary?: string;
  siteName: string;
  datePublished?: string;
  siteIcon?: string;
}

// 搜索响应类型
export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  query: string;
  totalResults?: number;
  error?: string;
}

// 页面上下文类型
export interface PageContext {
  basic: {
    title: string;
    url: string;
    description?: string;
    type: string; // 'article', 'product', 'home', 'blog', etc.
  };
  content?: {
    text?: string;
    headings?: string[];
    links?: Array<{ text: string; url: string; }>;
    images?: Array<{ alt: string; src: string; }>;
  };
  metadata?: {
    author?: string;
    publishDate?: string;
    keywords?: string[];
    language?: string;
  };
  structure?: {
    wordCount?: number;
    readingTime?: number;
    sections?: string[];
  };
  extracted?: {
    summary?: string;
    keyPoints?: string[];
    categories?: string[];
  };
  auth?: {
    satoken?: string;
  };
}

// 页面信息类型
export interface PageInfo {
  title: string;
  url: string;
  type: string;
}

// 基础聊天消息类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  audioUrl?: string; // 语音消息的音频URL
  isVoice?: boolean; // 是否为语音输入的消息
  isThinking?: boolean; // 标记思考中的消息
  toolCalls?: ToolCall[]; // 工具调用信息
  contextUsed?: boolean; // 是否使用了页面上下文
  pageInfo?: PageInfo; // 页面信息
  searchSources?: SearchResult[]; // 新增：搜索来源
}

// 助手配置类型
export interface AssistantConfig {
  baseUrl?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  theme?: 'light' | 'dark' | 'auto';
  enableVoice?: boolean;
  enablePageContext?: boolean; // 是否启用页面上下文
  maxMessages?: number;
}

// 语音设置类型
export interface VoiceSettings {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  autoPlay: boolean;
}

// 语音选项类型
export interface VoiceOption {
  id: string;
  name: string;
  displayName?: string;
}

// TTS请求类型
export interface TTSRequest {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
}

// TTS响应类型
export interface TTSResponse {
  audioUrl?: string;
  error?: string;
}

// 聊天API请求类型
export interface ChatRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  pageContext?: PageContext; // 页面上下文
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  }>;
}

// 聊天API响应类型
export interface ChatResponse {
  message: string;
  messageId: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: string;
  isSimulated?: boolean;
  requiresToolCalls?: boolean; // 是否需要工具调用
  tool_calls?: ToolCall[]; // 工具调用数组
  contextUsed?: boolean; // 是否使用了页面上下文
  pageInfo?: PageInfo; // 页面信息
  hasOpenManusTools?: boolean; // 是否包含OpenManus工具
}

// 错误类型
export interface APIError {
  error: string;
  code?: number;
  details?: string;
}

// 嵌入式助手选项
export interface EmbedOptions {
  config?: AssistantConfig;
  containerId?: string;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

// 消息事件类型
export interface MessageEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  origin?: string;
}

// 音频播放状态
export interface AudioState {
  isPlaying: boolean;
  currentMessageId?: string;
  duration?: number;
  currentTime?: number;
}

// 语音识别状态（为未来功能预留）
export interface SpeechRecognitionState {
  isListening: boolean;
  transcript: string;
  confidence: number;
  error?: string;
}

// 助手状态
export interface AssistantState {
  isOpen: boolean;
  isLoading: boolean;
  showSettings: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastError?: Error;
}

// 全局窗口扩展（用于嵌入式SDK）
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AIAssistant?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initAIAssistant?: (options: EmbedOptions) => any;
  }
}

// 向后兼容的类型别名
export type Message = ChatMessage;

export interface VoiceState {
  isListening: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  currentTranscript: string;
  finalTranscript: string;
  isStreamingActive: boolean;
  confidence: number;
}

// 语音识别配置接口
export interface STTConfig {
  language: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  grammars?: string[];
}

// 流式识别事件接口
export interface StreamingSTTEvent {
  type: 'start' | 'result' | 'end' | 'error' | 'no-speech';
  transcript?: string;
  isFinal?: boolean;
  confidence?: number;
  error?: string;
}

// Web Speech API类型扩展
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AIAssistant?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initAIAssistant?: (options: EmbedOptions) => any;
  }
}

// 页面上下文状态类型
export type ContextStatus = 'loading' | 'ready' | 'error' | 'disabled';

// OpenManus相关类型定义

// OpenManus任务请求类型
export interface OpenManusTaskRequest {
  task_description: string;
  agent_type?: string;
  tools?: string[];
  context?: unknown;
  max_steps?: number;
}

// OpenManus任务响应类型
export interface OpenManusTaskResponse {
  task_id: string;
  status: string;
  result?: string;
  error?: string;
  steps_completed: number;
  total_steps: number;
  created_at: string;
  updated_at: string;
}

// OpenManus任务状态类型
export interface OpenManusTaskStatus {
  task_id: string;
  status: string;
  progress: number; // 0.0 - 1.0
  current_step?: string;
  result?: string;
  error?: string;
}

// OpenManus工具类型
export interface OpenManusTool {
  name: string;
  description: string;
}

// OpenManus API响应类型
export interface OpenManusAPIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// OpenManus健康检查响应
export interface OpenManusHealthCheck {
  status: 'healthy' | 'unhealthy';
  openmanus_service?: {
    status: string;
    timestamp: string;
    openmanus_dir: string;
    manus_available: boolean;
    active_instances: number;
  };
  error?: string;
  timestamp: string;
}

// 扩展现有的ChatResponse类型
export interface ExtendedChatResponse extends ChatResponse {
  hasOpenManusTools?: boolean; // 是否包含OpenManus工具
  openManusTaskId?: string; // OpenManus任务ID
}

// 扩展现有的ToolProgress类型
export interface ExtendedToolProgress extends ToolProgress {
  isOpenManusTask?: boolean; // 是否为OpenManus任务
  openManusTaskId?: string; // OpenManus任务ID
  openManusStatus?: string; // OpenManus任务状态
}

// 豆包实时语音通话相关类型定义

// 助手模式类型
export type AssistantMode = 'text' | 'voice-call';

// 语音通话连接状态
export type VoiceCallConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

// 语音通话状态
export interface VoiceCallState {
  mode: AssistantMode;
  isCallActive: boolean;
  connectionStatus: VoiceCallConnectionStatus;
  callDuration: number;
  realtimeTranscript: string;
  audioQuality: 'low' | 'medium' | 'high';
  sessionId?: string;
  lastActivity: number;
}

// 豆包语音配置
export interface DoubaoVoiceConfig {
  apiAppId: string;
  apiAccessKey: string;
  apiResourceId: string;
  baseUrl: string;
  audioConfig: {
    inputSampleRate: number;
    outputSampleRate: number;
    channels: number;
    format: string;
    chunk: number;
  };
}

// 实时转录事件
export interface RealtimeTranscriptEvent {
  type: 'transcript' | 'audio' | 'silence' | 'error' | 'end';
  text?: string;
  audio?: ArrayBuffer;
  confidence?: number;
  isFinal?: boolean;
  error?: string; // 错误信息
  timestamp: number;
}

// 语音通话会话信息
export interface VoiceCallSession {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'ended' | 'error';
  transcripts: Array<{
    text: string;
    timestamp: number;
    speaker: 'user' | 'assistant';
  }>;
}

// 打字机效果组件属性
export interface TypingEffectProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  cursor?: boolean;
  className?: string;
}

// 音频可视化数据
export interface AudioVisualizationData {
  waveform: number[];
  volume: number;
  frequency: number[];
}

// WebSocket消息类型
export interface DoubaoWebSocketMessage {
  type: 'start' | 'audio' | 'transcript' | 'end' | 'error';
  sessionId?: string;
  data?: ArrayBuffer | string;
  error?: string;
  timestamp: number;
}

// 新的统一消息类型 - 替换现有的ChatMessage
export interface ReasoningChatMessage extends ChatMessage {
  // 消息类型：user | reasoning | tool_execution | assistant_final | assistant  
  messageType: 'user' | 'reasoning' | 'tool_execution' | 'assistant_final' | 'assistant';
  
  // 思维链内容
  reasoningContent?: string;
  isReasoningComplete?: boolean;
  reasoningDuration?: number;
  
  // 工具执行相关
  toolExecution?: ToolExecutionData;
  
  // 容器状态
  isCollapsed?: boolean;
  
  // 语音和其他现有功能
  isVoice?: boolean;
  audioUrl?: string;
  searchSources?: SearchResult[];
  contextUsed?: boolean;
  pageInfo?: { title: string; url: string; type: string; };
} 