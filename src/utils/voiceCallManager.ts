import { DoubaoVoiceClient } from './doubaoVoiceClient';
import { AudioProcessor } from './audioProcessor';
import { 
  DoubaoVoiceConfig, 
  VoiceCallState, 
  RealtimeTranscriptEvent,
  AudioVisualizationData 
} from '@/types';

/**
 * 语音通话管理器 - 增强版
 * 协调DoubaoVoiceClient和AudioProcessor，管理整个语音通话流程
 * 新增：防重复连接、资源清理改进、错误恢复机制
 */
export class VoiceCallManager {
  private doubaoClient: DoubaoVoiceClient | null = null;
  private audioProcessor: AudioProcessor | null = null;
  private config: DoubaoVoiceConfig;
  private sessionId: string;
  private callState: VoiceCallState;
  private callStartTime: number = 0;
  private onStateChange: (state: VoiceCallState) => void;
  private onTranscriptUpdate: (transcript: string) => void;
  private onVisualizationData: (data: AudioVisualizationData) => void;
  
  // 音频播放队列管理
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying: boolean = false;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private audioContext: AudioContext | null = null;

  // 🆕 新增：连接状态管理
  private isConnecting: boolean = false;
  private isDisposing: boolean = false;
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 3;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastConnectionError: string | null = null;

  constructor(
    config: DoubaoVoiceConfig,
    sessionId: string,
    onStateChange: (state: VoiceCallState) => void,
    onTranscriptUpdate: (transcript: string) => void,
    onVisualizationData: (data: AudioVisualizationData) => void
  ) {
    this.config = config;
    this.sessionId = sessionId;
    this.onStateChange = onStateChange;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onVisualizationData = onVisualizationData;

    // 初始化通话状态
    this.callState = {
      mode: 'voice-call',
      isCallActive: false,
      connectionStatus: 'idle',
      callDuration: 0,
      realtimeTranscript: '',
      audioQuality: 'medium',
      sessionId,
      lastActivity: Date.now()
    };

    this.audioProcessor = new AudioProcessor();
  }

  /**
   * 🆕 改进：防重复连接的开始通话方法
   */
  async startCall(): Promise<void> {
    // 防重复连接检查
    if (this.isConnecting) {
      console.warn('正在连接中，忽略重复请求');
      return;
    }

    if (this.callState.isCallActive) {
      console.warn('通话已在进行中，忽略重复请求');
      return;
    }

    if (this.isDisposing) {
      console.warn('正在清理资源，无法开始新通话');
      return;
    }

    this.isConnecting = true;
    this.connectionAttempts = 0;
    this.lastConnectionError = null;

    try {
      await this.performStartCall();
    } catch (error) {
      console.error('开始语音通话失败:', error);
      await this.handleConnectionError(error as Error);
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * 🆕 新增：实际执行连接的方法
   */
  private async performStartCall(): Promise<void> {
    try {
      console.log('开始语音通话流程...', {
        sessionId: this.sessionId,
        attempts: this.connectionAttempts + 1,
        maxAttempts: this.maxConnectionAttempts
      });
      
      this.updateCallState({
        connectionStatus: 'connecting',
        isCallActive: false
      });

      // 🆕 改进：彻底清理旧资源
      await this.forceCleanup();

      // 检查浏览器支持
      const support = AudioProcessor.checkSupport();
      if (!support.mediaDevices || !support.audioContext) {
        throw new Error('浏览器不支持语音通话功能，请使用Chrome、Firefox或Edge浏览器');
      }

      // 验证WebSocket代理URL
      if (!this.config.baseUrl.includes('/api/voice/realtime')) {
        throw new Error('WebSocket URL配置错误，应该指向代理服务器');
      }

      console.log('使用WebSocket代理URL:', this.config.baseUrl);

      // 🆕 改进：带重试的豆包客户端初始化
      console.log('正在初始化豆包语音客户端...');
      this.doubaoClient = new DoubaoVoiceClient(
        this.config,
        this.sessionId,
        this.handleDoubaoEvent.bind(this)
      );

      // 🆕 新增：连接超时保护
      const connectionPromise = this.doubaoClient.connect();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('连接超时（20秒）')), 20000);
      });

      await Promise.race([connectionPromise, timeoutPromise]);
      console.log('豆包服务连接成功');

      // 🆕 改进：延迟启动音频捕获，确保连接稳定
      console.log('等待连接稳定...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('正在启动音频捕获...');
      await this.audioProcessor!.startCapture(
        this.handleAudioData.bind(this),
        this.handleSilenceDetected.bind(this),
        this.onVisualizationData
      );
      console.log('音频捕获启动成功');

      this.callStartTime = Date.now();
      this.updateCallState({
        connectionStatus: 'connected',
        isCallActive: true,
        lastActivity: Date.now()
      });

      this.startCallTimer();
      console.log('语音通话已成功开始');

      // 重置连接尝试计数
      this.connectionAttempts = 0;
      this.lastConnectionError = null;

    } catch (error) {
      throw error;
    }
  }

  /**
   * 🆕 新增：连接错误处理和重试机制
   */
  private async handleConnectionError(error: Error): Promise<void> {
    this.connectionAttempts++;
    this.lastConnectionError = error.message;
    
    console.error(`连接失败 (尝试 ${this.connectionAttempts}/${this.maxConnectionAttempts}):`, error.message);

    await this.forceCleanup();

    // 如果还有重试机会且错误不是致命的
    if (this.connectionAttempts < this.maxConnectionAttempts && this.shouldRetry(error)) {
      console.log(`将在 ${this.connectionAttempts * 2} 秒后重试...`);
      
      this.updateCallState({
        connectionStatus: 'connecting', // 保持连接中状态
        isCallActive: false
      });

      this.reconnectTimeout = setTimeout(async () => {
        if (!this.isDisposing) {
          console.log('开始重试连接...');
          this.isConnecting = true;
          try {
            await this.performStartCall();
          } catch (retryError) {
            await this.handleConnectionError(retryError as Error);
          } finally {
            this.isConnecting = false;
          }
        }
      }, this.connectionAttempts * 2000);

    } else {
      // 所有重试失败或致命错误
      this.updateCallState({
        connectionStatus: 'error',
        isCallActive: false
      });

      throw new Error(`语音通话连接失败: ${this.lastConnectionError}`);
    }
  }

  /**
   * 🆕 新增：判断是否应该重试
   */
  private shouldRetry(error: Error): boolean {
    const retryableErrors = [
      '连接超时',
      'WebSocket连接失败',
      '代理服务器',
      'ECONNREFUSED',
      'network'
    ];

    const fatalErrors = [
      '浏览器不支持',
      '麦克风访问',
      'URL配置错误',
      '会话ID'
    ];

    const errorMessage = error.message.toLowerCase();
    
    // 检查是否是致命错误
    for (const fatalError of fatalErrors) {
      if (errorMessage.includes(fatalError.toLowerCase())) {
        return false;
      }
    }

    // 检查是否是可重试错误
    for (const retryableError of retryableErrors) {
      if (errorMessage.includes(retryableError.toLowerCase())) {
        return true;
      }
    }

    // 默认对网络相关错误重试
    return true;
  }

  /**
   * 🆕 改进：强制资源清理方法
   */
  private async forceCleanup(): Promise<void> {
    try {
      console.log('开始强制清理资源...');

      // 清除重连定时器
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // 停止音频播放
      if (this.currentAudioSource) {
        try {
          this.currentAudioSource.stop();
          this.currentAudioSource.disconnect();
        } catch (e) {
          console.warn('停止音频播放失败:', e);
        }
        this.currentAudioSource = null;
      }
      
      // 清空音频队列
      this.audioQueue = [];
      this.isPlaying = false;
      
      // 关闭音频上下文
      if (this.audioContext) {
        try {
          if (this.audioContext.state !== 'closed') {
            await this.audioContext.close();
          }
        } catch (e) {
          console.warn('关闭音频上下文失败:', e);
        }
        this.audioContext = null;
      }

      // 停止音频捕获
      if (this.audioProcessor) {
        try {
          this.audioProcessor.stopCapture();
        } catch (e) {
          console.warn('停止音频捕获失败:', e);
        }
      }

      // 关闭豆包连接
      if (this.doubaoClient) {
        try {
          await this.doubaoClient.close();
        } catch (e) {
          console.warn('关闭豆包连接失败:', e);
        }
        this.doubaoClient = null;
      }

      console.log('资源清理完成');
    } catch (error) {
      console.error('强制清理资源失败:', error);
    }
  }

  private handleDoubaoEvent(event: RealtimeTranscriptEvent): void {
    console.log('收到豆包事件:', event.type);
    
    switch (event.type) {
      case 'transcript':
        if (event.text) {
          console.log('收到AI转录文本:', event.text);
          this.updateCallState({
            realtimeTranscript: event.text,
            lastActivity: Date.now()
          });
          this.onTranscriptUpdate(event.text);
        }
        break;

      case 'audio':
        if (event.audio) {
          console.log('收到AI音频数据:', event.audio.byteLength, '字节');
          this.playAudioData(event.audio);
          this.updateCallState({ lastActivity: Date.now() });
        }
        break;

      case 'error':
        console.error('豆包语音错误:', event.error);
        this.endCall('error');
        break;

      case 'end':
        console.log('豆包会话结束');
        this.endCall('timeout');
        break;
    }
  }

  private handleAudioData(audioData: ArrayBuffer): void {
    if (!this.doubaoClient || !this.doubaoClient.isConnectionActive()) {
      console.warn('豆包客户端未连接，跳过音频数据发送');
      return;
    }

    try {
      console.log('发送音频数据到豆包，大小:', audioData.byteLength);
      this.doubaoClient.sendAudio(audioData);
      this.updateCallState({ lastActivity: Date.now() });
    } catch (error) {
      console.error('处理音频数据失败:', error);
    }
  }

  private handleSilenceDetected(duration: number): void {
    if (duration > 0) {
      console.log('检测到静音:', duration, 'ms');
    }
  }

  /**
   * 🆕 改进：增强的音频播放方法
   */
  private async playAudioData(audioData: ArrayBuffer): Promise<void> {
    try {
      console.log('接收到音频数据，大小:', audioData.byteLength, '队列长度:', this.audioQueue.length);
      
      if (audioData.byteLength === 0) {
        console.warn('音频数据为空，跳过播放');
        return;
      }

      // 🆕 改进：重用音频上下文，避免频繁创建
      if (!this.audioContext || this.audioContext.state === 'closed') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('浏览器不支持AudioContext');
        }
        this.audioContext = new AudioContextClass();
        console.log('创建新的音频上下文');
      }
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('音频上下文已恢复');
      }
      
      this.audioQueue.push(audioData);
      
      if (!this.isPlaying) {
        this.processAudioQueue();
      }
      
    } catch (error) {
      console.error('播放音频失败:', error);
    }
  }

  /**
   * 新增：处理音频播放队列
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isPlaying || this.audioQueue.length === 0 || !this.audioContext) {
      return;
    }

    this.isPlaying = true;
    console.log('开始处理音频队列，剩余:', this.audioQueue.length);

    try {
      while (this.audioQueue.length > 0) {
        const audioData = this.audioQueue.shift()!;
        await this.playRawPCMData(audioData);
      }
    } catch (error) {
      console.error('处理音频队列失败:', error);
    } finally {
      this.isPlaying = false;
      console.log('音频队列处理完成');
    }
  }

  /**
   * 新增：播放原始PCM数据
   */
  private async playRawPCMData(audioData: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('播放音频片段, 数据长度:', audioData.byteLength);
        
        if (!this.audioContext) {
          reject(new Error('AudioContext未初始化'));
          return;
        }
        
        const sampleRate = 24000;
        const channels = 1;
        
        let audioBuffer: AudioBuffer;
        
        try {
          const float32Array = new Float32Array(audioData);
          
          let minVal = float32Array[0] || 0;
          let maxVal = float32Array[0] || 0;
          for (let i = 1; i < Math.min(100, float32Array.length); i++) {
            minVal = Math.min(minVal, float32Array[i]);
            maxVal = Math.max(maxVal, float32Array[i]);
          }
          
          if (Math.abs(minVal) <= 1.2 && Math.abs(maxVal) <= 1.2) {
            audioBuffer = this.audioContext.createBuffer(channels, float32Array.length, sampleRate);
            audioBuffer.copyToChannel(float32Array, 0);
            console.log('使用Float32格式播放, 样本数:', float32Array.length);
          } else {
            throw new Error('不是Float32格式');
          }
        } catch (e) {
          console.log('Float32失败，尝试16位PCM格式');
          const int16Array = new Int16Array(audioData);
          const float32Array = new Float32Array(int16Array.length);
          
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }
          
          audioBuffer = this.audioContext.createBuffer(channels, float32Array.length, sampleRate);
          audioBuffer.copyToChannel(float32Array, 0);
          console.log('使用16位PCM格式播放, 样本数:', float32Array.length);
        }
        
        if (this.currentAudioSource) {
          try {
            this.currentAudioSource.stop();
          } catch (e) {
            // 忽略停止错误
          }
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        
        this.currentAudioSource = source;
        
        source.onended = () => {
          console.log('音频片段播放完成，时长:', audioBuffer.duration, '秒');
          this.currentAudioSource = null;
          resolve();
        };
        
        source.start();
        
      } catch (error) {
        console.error('PCM音频播放失败:', error);
        reject(error);
      }
    });
  }

  async endCall(reason: 'user_hangup' | 'timeout' | 'error' = 'user_hangup'): Promise<void> {
    // 🆕 防重复调用检查
    if (this.isDisposing) {
      console.warn('正在清理资源，忽略重复的结束通话请求');
      return;
    }

    this.isDisposing = true;

    try {
      console.log('结束语音通话，原因:', reason);
      
      await this.forceCleanup();
      
      this.updateCallState({
        connectionStatus: 'disconnected',
        isCallActive: false
      });

      // 调用结束通话API
      try {
        const response = await fetch('/api/voice/end', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: this.sessionId,
            reason,
            duration: Date.now() - this.callStartTime
          }),
        });

        if (!response.ok) {
          console.warn('结束通话API调用失败');
        }
      } catch (error) {
        console.warn('结束通话API调用错误:', error);
      }

      console.log('语音通话已结束');

    } catch (error) {
      console.error('结束语音通话失败:', error);
    } finally {
      this.isDisposing = false;
    }
  }

  private startCallTimer(): void {
    const updateDuration = () => {
      if (this.callState.isCallActive && !this.isDisposing) {
        const duration = Date.now() - this.callStartTime;
        this.updateCallState({ callDuration: duration });
        setTimeout(updateDuration, 1000);
      }
    };
    updateDuration();
  }

  private updateCallState(updates: Partial<VoiceCallState>): void {
    this.callState = { ...this.callState, ...updates };
    this.onStateChange(this.callState);
  }

  // 🆕 新增：获取连接状态信息
  getConnectionInfo(): {
    isConnecting: boolean;
    connectionAttempts: number;
    lastError: string | null;
    isDisposing: boolean;
  } {
    return {
      isConnecting: this.isConnecting,
      connectionAttempts: this.connectionAttempts,
      lastError: this.lastConnectionError,
      isDisposing: this.isDisposing
    };
  }

  toggleMute(): void {
    console.log('切换静音状态');
    // TODO: 实现静音功能
  }

  togglePause(): void {
    console.log('切换暂停状态');
    // TODO: 实现暂停功能
  }

  getCallState(): VoiceCallState {
    return { ...this.callState };
  }

  isCallActive(): boolean {
    return this.callState.isCallActive && this.callState.connectionStatus === 'connected' && !this.isDisposing;
  }

  dispose(): void {
    // 🔧 修复：区分主动结束和组件卸载清理
    // 如果通话还在活跃状态，使用'error'而不是'user_hangup'
    const reason = this.callState.isCallActive ? 'error' : 'user_hangup';
    console.log(`VoiceCallManager.dispose调用，通话状态: ${this.callState.isCallActive ? '活跃' : '已结束'}，使用原因: ${reason}`);
    
    this.endCall(reason);
    
    if (this.audioProcessor) {
      this.audioProcessor.dispose();
      this.audioProcessor = null;
    }
  }
}