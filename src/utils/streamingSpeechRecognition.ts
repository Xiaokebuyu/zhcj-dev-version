import { STTConfig, StreamingSTTEvent } from '../types';

// Web Speech API类型声明
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

// 语音识别管理器类
export class StreamingSpeechRecognition {
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean = false;
  private config: STTConfig;
  private onEvent: (event: StreamingSTTEvent) => void;

  constructor(config: STTConfig, onEvent: (event: StreamingSTTEvent) => void) {
    this.config = config;
    this.onEvent = onEvent;
    this.initialize();
  }

  private initialize() {
    // 检查浏览器支持
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      this.isSupported = true;
      this.setupRecognition();
    } else {
      this.isSupported = false;
      this.onEvent({ type: 'error', error: '浏览器不支持语音识别功能' });
    }
  }

  private setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    if (!this.recognition) return;

    // 配置识别参数
    this.recognition.continuous = this.config.continuous;
    this.recognition.interimResults = this.config.interimResults;
    this.recognition.lang = this.config.language;
    this.recognition.maxAlternatives = this.config.maxAlternatives;

    // 事件监听
    this.recognition.onstart = () => {
      console.log('🎤 语音识别开始');
      this.onEvent({ type: 'start' });
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';
      let confidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        confidence = Math.max(confidence, result[0].confidence || 0);

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // 发送实时结果
      if (interimTranscript) {
        this.onEvent({
          type: 'result',
          transcript: interimTranscript,
          isFinal: false,
          confidence
        });
      }

      // 发送最终结果
      if (finalTranscript) {
        this.onEvent({
          type: 'result',
          transcript: finalTranscript,
          isFinal: true,
          confidence
        });
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('🚨 语音识别错误:', event.error);
      let errorMessage = '语音识别出错';
      
      switch (event.error) {
        case 'no-speech':
          errorMessage = '未检测到语音，请重试';
          this.onEvent({ type: 'no-speech' });
          return;
        case 'audio-capture':
          errorMessage = '无法访问麦克风，请检查权限';
          break;
        case 'not-allowed':
          errorMessage = '麦克风权限被拒绝';
          break;
        case 'network':
          errorMessage = '网络错误，请检查连接';
          break;
        case 'service-not-allowed':
          errorMessage = '语音服务不可用';
          break;
        default:
          errorMessage = `识别错误: ${event.error}`;
      }

      this.onEvent({ type: 'error', error: errorMessage });
    };

    this.recognition.onend = () => {
      console.log('🔇 语音识别结束');
      this.onEvent({ type: 'end' });
    };

    this.recognition.onspeechstart = () => {
      console.log('🗣️ 检测到语音');
    };

    this.recognition.onspeechend = () => {
      console.log('🤫 语音结束');
    };

    this.recognition.onnomatch = () => {
      console.log('❓ 未识别到匹配内容');
      this.onEvent({ type: 'no-speech' });
    };
  }

  public start(): boolean {
    if (!this.isSupported || !this.recognition) {
      this.onEvent({ type: 'error', error: '语音识别不可用' });
      return false;
    }

    try {
      this.recognition.start();
      return true;
    } catch {
      this.onEvent({ type: 'error', error: '启动语音识别失败' });
      return false;
    }
  }

  public stop() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  public abort() {
    if (this.recognition) {
      this.recognition.abort();
    }
  }

  public isAvailable(): boolean {
    return this.isSupported;
  }

  public updateConfig(newConfig: Partial<STTConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (this.recognition) {
      // 重新应用配置
      this.recognition.continuous = this.config.continuous;
      this.recognition.interimResults = this.config.interimResults;
      this.recognition.lang = this.config.language;
      this.recognition.maxAlternatives = this.config.maxAlternatives;
    }
  }
} 