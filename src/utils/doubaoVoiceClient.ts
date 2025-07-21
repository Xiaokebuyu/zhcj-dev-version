import { DoubaoVoiceConfig, RealtimeTranscriptEvent } from '@/types';

// 豆包协议常量
const PROTOCOL_VERSION = 0b0001;

// Message Type
const CLIENT_FULL_REQUEST = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;
const SERVER_FULL_RESPONSE = 0b1001;
const SERVER_ACK = 0b1011;
const SERVER_ERROR_RESPONSE = 0b1111;

// Message Type Specific Flags
const NEG_SEQUENCE = 0b0010;
const MSG_WITH_EVENT = 0b0100;

// Message Serialization
const NO_SERIALIZATION = 0b0000;
const JSON_SERIALIZATION = 0b0001;

// Message Compression
const GZIP = 0b0001;

/**
 * 豆包实时语音客户端 - 代理连接版本
 * 通过WebSocket代理服务器与豆包服务通信
 */
export class DoubaoVoiceClient {
  private ws: WebSocket | null = null;
  private config: DoubaoVoiceConfig;
  private sessionId: string;
  private isConnected: boolean = false;
  private onEvent: (event: RealtimeTranscriptEvent) => void;

  constructor(config: DoubaoVoiceConfig, sessionId: string, onEvent: (event: RealtimeTranscriptEvent) => void) {
    this.config = config;
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }

  /**
   * 连接到代理服务器
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('正在连接WebSocket代理服务器:', this.config.baseUrl);
        
        this.ws = new WebSocket(this.config.baseUrl);
        this.ws.binaryType = 'arraybuffer';

        let isInitialized = false;

        this.ws.onopen = () => {
          console.log('WebSocket代理连接已建立，等待豆包服务初始化...');
        };

        this.ws.onmessage = async (event) => {
          try {
            if (typeof event.data === 'string') {
              // JSON消息处理
              const message = JSON.parse(event.data);
              console.log('收到代理服务器消息:', message.type);
              
              switch (message.type) {
                case 'connected':
                  if (!isInitialized) {
                    console.log('豆包服务连接成功，协议初始化完成');
                    isInitialized = true;
                    this.isConnected = true;
                    resolve();
                  }
                  break;
                  
                case 'error':
                  console.error('代理服务器错误:', message.error);
                  reject(new Error(message.error));
                  break;
                  
                case 'end':
                  console.log('豆包服务连接已结束');
                  this.isConnected = false;
                  this.onEvent({ type: 'end', timestamp: Date.now() });
                  break;
              }
            } else {
              // 二进制消息处理（豆包响应数据）
              console.log('收到豆包二进制响应，大小:', event.data.byteLength);
              await this.handleMessage(event.data);
            }
          } catch (error) {
            console.error('处理WebSocket消息失败:', error);
            if (!isInitialized) {
              reject(error);
            }
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket连接错误:', error);
          reject(new Error('WebSocket连接失败'));
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket连接已关闭, code:', event.code, 'reason:', event.reason);
          this.isConnected = false;
          this.onEvent({ type: 'end', timestamp: Date.now() });
        };

        // 连接超时
        setTimeout(() => {
          if (!isInitialized && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
            reject(new Error('WebSocket连接超时'));
          }
        }, 15000); // 15秒超时

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送音频数据到代理服务器
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.ws || !this.isConnected) {
      console.warn('WebSocket未连接，无法发送音频数据');
      return;
    }

    try {
      console.log('准备发送音频数据到代理服务器，大小:', audioData.byteLength);
      
      // 🔧 关键修复：使用NO_COMPRESSION而非GZIP，避免音频质量下降
      const header = this.generateHeader(
        PROTOCOL_VERSION,
        CLIENT_AUDIO_ONLY_REQUEST,
        MSG_WITH_EVENT,
        NO_SERIALIZATION,
        0b0000 // 🔧 使用NO_COMPRESSION而非GZIP
      );
      
      const sessionIdBytes = this.stringToUint8Array(this.sessionId);
      const audioBytes = new Uint8Array(audioData);
      
      // 🔧 关键修复：直接发送原始音频数据，不压缩
      const message = new Uint8Array(
        header.length + 4 + 4 + sessionIdBytes.length + 4 + audioBytes.length
      );
      
      let offset = 0;
      message.set(header, offset);
      offset += header.length;
      
      message.set(this.numberToBytes(200), offset); // Task request
      offset += 4;
      
      message.set(this.numberToBytes(sessionIdBytes.length), offset);
      offset += 4;
      
      message.set(sessionIdBytes, offset);
      offset += sessionIdBytes.length;
      
      message.set(this.numberToBytes(audioBytes.length), offset);
      offset += 4;
      
      message.set(audioBytes, offset); // 🔧 直接使用原始音频数据
      
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
        console.log('音频数据已发送到代理服务器，总消息大小:', message.length);
      } else {
        console.warn('WebSocket连接状态异常:', this.ws.readyState);
      }
    } catch (error) {
      console.error('发送音频数据失败:', error);
      this.onEvent({
        type: 'error',
        error: '发送音频数据失败: ' + (error instanceof Error ? error.message : '未知错误'),
        timestamp: Date.now()
      });
    }
  }

  /**
   * 生成协议头部
   */
  private generateHeader(
    version = PROTOCOL_VERSION,
    messageType = CLIENT_AUDIO_ONLY_REQUEST,
    messageTypeSpecificFlags = MSG_WITH_EVENT,
    serialMethod = NO_SERIALIZATION,
    compressionType = GZIP,
    reservedData = 0x00,
    extensionHeader = new Uint8Array()
  ): Uint8Array {
    // 正确计算headerSize
    const headerSize = Math.floor(extensionHeader.length / 4) + 1;
    const header = new Uint8Array(headerSize * 4);
    
    header[0] = (version << 4) | headerSize;
    header[1] = (messageType << 4) | messageTypeSpecificFlags;
    header[2] = (serialMethod << 4) | compressionType;
    header[3] = reservedData;
    
    if (extensionHeader.length > 0) {
      header.set(extensionHeader, 4);
    }
    
    return header;
  }

  /**
   * 压缩数据
   */
  private async compressData(data: Uint8Array): Promise<Uint8Array> {
    try {
      if ('CompressionStream' in window) {
        const compressionStream = new CompressionStream('gzip');
        const writer = compressionStream.writable.getWriter();
        const reader = compressionStream.readable.getReader();
        
        writer.write(data);
        writer.close();
        
        const chunks: Uint8Array[] = [];
        let done = false;
        
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) {
            chunks.push(value);
          }
        }
        
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        
        return result;
      } else {
        console.warn('浏览器不支持GZIP压缩，使用原始数据');
        return data;
      }
    } catch (error) {
      console.error('GZIP压缩失败，使用原始数据:', error);
      return data;
    }
  }

  /**
   * 解压数据
   */
  private async decompressData(data: Uint8Array): Promise<Uint8Array> {
    try {
      if ('DecompressionStream' in window) {
        const decompressionStream = new DecompressionStream('gzip');
        const writer = decompressionStream.writable.getWriter();
        const reader = decompressionStream.readable.getReader();
        
        writer.write(data);
        writer.close();
        
        const chunks: Uint8Array[] = [];
        let done = false;
        
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) {
            chunks.push(value);
          }
        }
        
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        
        return result;
      } else {
        return data;
      }
    } catch (error) {
      console.error('GZIP解压失败:', error);
      return data;
    }
  }

  /**
   * 将字符串转换为Uint8Array
   */
  private stringToUint8Array(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  /**
   * 将数字转换为4字节大端序数组
   */
  private numberToBytes(num: number): Uint8Array {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, num, false); // false = 大端序
    return new Uint8Array(buffer);
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(data: ArrayBuffer): Promise<void> {
    try {
      const response = await this.parseResponse(new Uint8Array(data));
      console.log('解析豆包响应:', {
        messageType: response.messageType,
        event: response.event,
        payloadType: typeof response.payloadMsg,
        payloadSize: response.payloadMsg instanceof Uint8Array ? response.payloadMsg.length : 'N/A'
      });
      
      if (response.messageType === 'SERVER_ACK' && response.payloadMsg instanceof Uint8Array) {
        // 音频数据
        console.log('收到音频数据:', response.payloadMsg.length, '字节');
        this.onEvent({
          type: 'audio',
          audio: response.payloadMsg.buffer as ArrayBuffer,
          timestamp: Date.now()
        });
      } else if (response.messageType === 'SERVER_FULL_RESPONSE') {
        console.log('收到完整响应, event:', response.event);
        
        if (response.event === 450) {
          console.log('收到清空缓存指令');
        }
        
        if (typeof response.payloadMsg === 'string') {
          console.log('收到转录文本:', response.payloadMsg);
          this.onEvent({
            type: 'transcript',
            text: response.payloadMsg,
            isFinal: true,
            timestamp: Date.now()
          });
        }
      } else if (response.messageType === 'SERVER_ERROR') {
        console.error('服务器错误:', response.payloadMsg);
        this.onEvent({
          type: 'error',
          error: response.payloadMsg as string,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('处理消息失败:', error);
      this.onEvent({
        type: 'error',
        error: '消息处理失败',
        timestamp: Date.now()
      });
    }
  }

  /**
   * 解析服务器响应
   */
  private async parseResponse(data: Uint8Array): Promise<{
    messageType?: string;
    event?: number;
    payloadMsg?: unknown;
    sessionId?: string;
    code?: number;
    seq?: number;
  }> {
    if (data.length < 4) {
      throw new Error('数据长度不足');
    }

    const protocolVersion = data[0] >> 4;
    const headerSize = data[0] & 0x0f;
    const messageType = data[1] >> 4;
    const messageTypeSpecificFlags = data[1] & 0x0f;
    const serializationMethod = data[2] >> 4;
    const messageCompression = data[2] & 0x0f;
    
    console.log('解析响应头:', {
      protocolVersion,
      headerSize,
      messageType,
      messageTypeSpecificFlags,
      serializationMethod,
      messageCompression
    });
    
    const payload = data.slice(headerSize * 4);
    
    const result: {
      messageType?: string;
      event?: number;
      payloadMsg?: unknown;
      sessionId?: string;
      code?: number;
      seq?: number;
    } = {};
    
    let payloadMsg: unknown = null;
    let start = 0;
    
    if (messageType === SERVER_FULL_RESPONSE || messageType === SERVER_ACK) {
      result.messageType = messageType === SERVER_ACK ? 'SERVER_ACK' : 'SERVER_FULL_RESPONSE';
      
      if (messageTypeSpecificFlags & NEG_SEQUENCE) {
        const view = new DataView(payload.buffer, payload.byteOffset + start, 4);
        result.seq = view.getUint32(0, false);
        start += 4;
      }
      
      if (messageTypeSpecificFlags & MSG_WITH_EVENT) {
        const view = new DataView(payload.buffer, payload.byteOffset + start, 4);
        result.event = view.getUint32(0, false);
        start += 4;
      }
      
      const remainingPayload = payload.slice(start);
      if (remainingPayload.length >= 4) {
        const view = new DataView(remainingPayload.buffer, remainingPayload.byteOffset, 4);
        const sessionIdSize = view.getInt32(0, false);
        
        if (remainingPayload.length >= 4 + sessionIdSize + 4) {
          const sessionId = remainingPayload.slice(4, 4 + sessionIdSize);
          result.sessionId = new TextDecoder().decode(sessionId);
          
          const payloadSizeView = new DataView(remainingPayload.buffer, remainingPayload.byteOffset + 4 + sessionIdSize, 4);
          const payloadSize = payloadSizeView.getUint32(0, false);
          
          payloadMsg = remainingPayload.slice(4 + sessionIdSize + 4, 4 + sessionIdSize + 4 + payloadSize);
        }
      }
    } else if (messageType === SERVER_ERROR_RESPONSE) {
      result.messageType = 'SERVER_ERROR';
      const view = new DataView(payload.buffer, payload.byteOffset, 4);
      result.code = view.getUint32(0, false);
      
      const payloadSizeView = new DataView(payload.buffer, payload.byteOffset + 4, 4);
      const payloadSize = payloadSizeView.getUint32(0, false);
      
      payloadMsg = payload.slice(8, 8 + payloadSize);
    }
    
    // 处理压缩和序列化
    if (payloadMsg instanceof Uint8Array) {
             if (messageCompression === GZIP) {
         try {
           payloadMsg = await this.decompressData(payloadMsg as Uint8Array);
         } catch (error) {
           console.warn('解压失败，使用原始数据:', error);
         }
       }
       
       if (serializationMethod === JSON_SERIALIZATION) {
         try {
           const text = new TextDecoder().decode(payloadMsg as Uint8Array);
           payloadMsg = JSON.parse(text);
         } catch (error) {
           console.warn('JSON解析失败，使用原始文本:', error);
           payloadMsg = new TextDecoder().decode(payloadMsg as Uint8Array);
         }
       } else if (serializationMethod !== NO_SERIALIZATION) {
         payloadMsg = new TextDecoder().decode(payloadMsg as Uint8Array);
       }
    }
    
    result.payloadMsg = payloadMsg;
    return result;
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (!this.ws) return;

    try {
      console.log('正在关闭WebSocket连接...');
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    } catch (error) {
      console.error('关闭连接失败:', error);
    }
  }

  /**
   * 检查连接状态
   */
  isConnectionActive(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}