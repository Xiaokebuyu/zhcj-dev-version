import { AudioVisualizationData } from '@/types';

/**
 * 音频处理器类
 * 负责音频捕获、格式转换、静音检测和可视化数据生成
 */
export class AudioProcessor {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private isRecording: boolean = false;
  private silenceThreshold: number = 0.01; // 静音阈值
  private silenceStartTime: number = 0;
  private onAudioData: ((audioData: ArrayBuffer) => void) | null = null;
  private onSilenceDetected: ((duration: number) => void) | null = null;
  private onVisualizationData: ((data: AudioVisualizationData) => void) | null = null;

  // 音频配置
  private readonly sampleRate = 16000; // 豆包要求的采样率
  private readonly channels = 1; // 单声道
  private readonly bufferSize = 2048; // 减小缓冲区大小以减少延迟

  constructor() {
    this.initializeAudioContext();
  }

  /**
   * 初始化音频上下文
   */
  private async initializeAudioContext(): Promise<void> {
    try {
      // 创建AudioContext，指定采样率
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('浏览器不支持AudioContext');
      }
      this.audioContext = new AudioContextClass({
        sampleRate: this.sampleRate
      });

      // 创建分析器节点用于可视化和静音检测
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;

    } catch (error) {
      console.error('初始化音频上下文失败:', error);
      throw new Error('不支持Web Audio API');
    }
  }

  /**
   * 修复：改进的音频捕获启动方法
   */
  async startCapture(
    onAudioData: (audioData: ArrayBuffer) => void,
    onSilenceDetected?: (duration: number) => void,
    onVisualizationData?: (data: AudioVisualizationData) => void
  ): Promise<void> {
    if (this.isRecording) {
      throw new Error('音频捕获已在进行中');
    }

    this.onAudioData = onAudioData;
    this.onSilenceDetected = onSilenceDetected || null;
    this.onVisualizationData = onVisualizationData || null;

    try {
      // 检查浏览器支持
      const support = AudioProcessor.checkSupport();
      if (!support.mediaDevices) {
        throw new Error('浏览器不支持MediaDevices API，无法访问麦克风');
      }
      if (!support.audioContext) {
        throw new Error('浏览器不支持Web Audio API');
      }

      console.log('正在请求麦克风权限...');
      
      // 修复：使用更兼容的音频约束
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: this.sampleRate },
          channelCount: { exact: this.channels },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // 添加延迟优化
          latency: { ideal: 0.01 }
        }
      });

      console.log('麦克风权限获取成功');

      if (!this.audioContext || !this.analyserNode) {
        await this.initializeAudioContext();
      }

      // 修复：确保音频上下文处于运行状态
      if (this.audioContext!.state === 'suspended') {
        console.log('正在恢复音频上下文...');
        await this.audioContext!.resume();
      }

      // 创建源节点
      this.sourceNode = this.audioContext!.createMediaStreamSource(this.mediaStream);
      
      // 修复：使用更小的缓冲区大小以减少延迟
      this.scriptProcessorNode = this.audioContext!.createScriptProcessor(
        this.bufferSize, 
        this.channels, 
        this.channels
      );

      // 连接音频节点
      this.sourceNode.connect(this.analyserNode!);
      this.analyserNode!.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.audioContext!.destination);

      // 设置音频处理回调
      this.scriptProcessorNode.onaudioprocess = (event) => {
        try {
          this.processAudioData(event);
        } catch (error) {
          console.error('音频数据处理失败:', error);
        }
      };

      this.isRecording = true;
      this.silenceStartTime = Date.now();
      
      console.log('音频捕获已开始，采样率:', this.audioContext!.sampleRate);

    } catch (error) {
      console.error('开始音频捕获失败:', error);
      this.cleanup();
      
      // 提供更具体的错误信息
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          throw new Error('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
        } else if (error.name === 'NotFoundError') {
          throw new Error('未找到可用的麦克风设备');
        } else if (error.name === 'NotSupportedError') {
          throw new Error('当前浏览器不支持音频捕获');
        } else if (error.name === 'NotReadableError') {
          throw new Error('麦克风设备被其他应用占用');
        } else {
          throw new Error(`音频捕获失败: ${error.message}`);
        }
      } else {
        throw new Error('音频捕获失败: 未知错误');
      }
    }
  }

  /**
   * 修复：改进的音频数据处理方法
   */
  private processAudioData(event: AudioProcessingEvent): void {
    if (!this.isRecording || !this.onAudioData) {
      return;
    }

    const inputBuffer = event.inputBuffer;
    const channelData = inputBuffer.getChannelData(0);

    // 修复：重采样到目标采样率（如果需要）
    let processedData = channelData;
    if (inputBuffer.sampleRate !== this.sampleRate) {
      processedData = this.resampleAudio(channelData, inputBuffer.sampleRate, this.sampleRate);
      console.log(`重采样音频: ${inputBuffer.sampleRate}Hz -> ${this.sampleRate}Hz`);
    }

    // 计算音量用于静音检测
    const volume = this.calculateVolume(processedData);

    // 静音检测（仅用于日志记录，不影响超时逻辑）
    if (volume < this.silenceThreshold) {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = Date.now();
      } else {
        const silenceDuration = Date.now() - this.silenceStartTime;
        if (this.onSilenceDetected && silenceDuration > 1000) {
          this.onSilenceDetected(silenceDuration);
        }
      }
    } else {
      // 重置静音计时，但不通知上层重置超时定时器
      // 超时逻辑现在完全基于AI是否响应
      this.silenceStartTime = 0;
    }

    // 生成可视化数据
    if (this.onVisualizationData && this.analyserNode) {
      const visualizationData = this.generateVisualizationData(volume);
      this.onVisualizationData(visualizationData);
    }

    // 转换为PCM格式并发送
    const pcmData = this.convertToPCM(processedData);
    
    // 添加调试日志
    if (volume > this.silenceThreshold) {
      console.log(`音频数据: 采样数=${processedData.length}, 音量=${volume.toFixed(4)}, PCM大小=${pcmData.length * 2}字节`);
    }
    
    this.onAudioData(pcmData.buffer as ArrayBuffer);
  }

  /**
   * 计算音频音量
   */
  private calculateVolume(channelData: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += channelData[i] * channelData[i];
    }
    return Math.sqrt(sum / channelData.length);
  }

  /**
   * 修复：改进的PCM转换方法，确保与豆包兼容
   */
  private convertToPCM(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // 限制到[-1, 1]范围
      let sample = Math.max(-1, Math.min(1, float32Array[i]));
      
      // 转换为16位整数，使用正确的范围
      if (sample < 0) {
        int16Array[i] = Math.floor(sample * 0x8000); // -32768
      } else {
        int16Array[i] = Math.floor(sample * 0x7FFF); // 32767
      }
    }
    return int16Array;
  }

  /**
   * 新增：简单的重采样方法
   */
  private resampleAudio(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
    if (inputRate === outputRate) {
      return input;
    }

    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const index = Math.floor(sourceIndex);
      const fraction = sourceIndex - index;

      if (index + 1 < input.length) {
        // 线性插值
        output[i] = input[index] * (1 - fraction) + input[index + 1] * fraction;
      } else {
        output[i] = input[index];
      }
    }

    return output;
  }

  /**
   * 生成音频可视化数据
   */
  private generateVisualizationData(volume: number): AudioVisualizationData {
    if (!this.analyserNode) {
      return {
        waveform: [],
        volume: 0,
        frequency: []
      };
    }

    // 获取频域数据
    const frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(frequencyData);

    // 获取时域数据（波形）
    const waveformData = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(waveformData);

    // 简化波形数据（取样）
    const waveformSamples = 32; // 32个采样点用于显示
    const waveform: number[] = [];
    const step = Math.floor(waveformData.length / waveformSamples);
    
    for (let i = 0; i < waveformSamples; i++) {
      const index = i * step;
      // 将0-255的值转换为-1到1的范围
      waveform.push((waveformData[index] - 128) / 128);
    }

    // 简化频率数据
    const frequencySamples = 16; // 16个频段
    const frequency: number[] = [];
    const freqStep = Math.floor(frequencyData.length / frequencySamples);
    
    for (let i = 0; i < frequencySamples; i++) {
      const index = i * freqStep;
      // 归一化到0-1范围
      frequency.push(frequencyData[index] / 255);
    }

    return {
      waveform,
      volume,
      frequency
    };
  }

  /**
   * 停止音频捕获
   */
  stopCapture(): void {
    if (!this.isRecording) return;

    console.log('正在停止音频捕获...');
    this.cleanup();
    this.resetCallbacks();
    
    console.log('音频捕获已停止');
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    try {
      // 先停止录音状态，防止后续处理
      this.isRecording = false;
      
      // 清除音频处理回调，防止后续事件触发
      if (this.scriptProcessorNode) {
        this.scriptProcessorNode.onaudioprocess = null;
        this.scriptProcessorNode.disconnect();
        this.scriptProcessorNode = null;
      }

      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }

      if (this.analyserNode) {
        this.analyserNode.disconnect();
      }

      // 停止媒体流
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          track.stop();
        });
        this.mediaStream = null;
      }

      this.silenceStartTime = 0;

    } catch (error) {
      console.error('清理音频资源失败:', error);
    }
  }

  /**
   * 完全重置所有回调和状态
   */
  private resetCallbacks(): void {
    this.onAudioData = null;
    this.onSilenceDetected = null;
    this.onVisualizationData = null;
  }

  /**
   * 检查是否正在录音
   */
  isCapturing(): boolean {
    return this.isRecording;
  }

  /**
   * 设置静音检测阈值
   */
  setSilenceThreshold(threshold: number): void {
    this.silenceThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 获取当前音频上下文状态
   */
  getAudioContextState(): string {
    return this.audioContext?.state || 'not-initialized';
  }

  /**
   * 检查浏览器支持情况
   */
  static checkSupport(): { 
    mediaDevices: boolean; 
    audioContext: boolean; 
    scriptProcessor: boolean;
  } {
    const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return {
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      audioContext: !!AudioContextClass,
      scriptProcessor: !!AudioContextClass
    };
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    this.stopCapture();
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.resetCallbacks();
  }
}