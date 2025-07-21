const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const WebSocket = require('ws');
const zlib = require('zlib');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// 创建Next.js应用
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 豆包协议常量
const PROTOCOL_VERSION = 0b0001;
const CLIENT_FULL_REQUEST = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;
const SERVER_FULL_RESPONSE = 0b1001;
const SERVER_ACK = 0b1011;
const SERVER_ERROR_RESPONSE = 0b1111;
const NEG_SEQUENCE = 0b0010;
const MSG_WITH_EVENT = 0b0100;
const NO_SERIALIZATION = 0b0000;
const JSON_SERIALIZATION = 0b0001;
const GZIP = 0b0001;

// --- BEGIN PATCH: ensure ".next/server/app/embed/chunks" symlink exists ---
// Determine build output directories (define outside try blocks)
const buildDir = path.join(__dirname, '.next', 'server');
const chunksDir = path.join(buildDir, 'chunks');

try {
  // There might be several nested `app/*` paths that reference the same `chunks` folder.
  // For now we ensure the critical `app/embed/chunks` path exists so that
  // require('./chunks/xxx.js') from compiled files can be resolved correctly.
  const embedChunksDir = path.join(buildDir, 'app', 'embed', 'chunks');
  if (!fs.existsSync(embedChunksDir)) {
    // Ensure parent directories exist
    fs.mkdirSync(path.dirname(embedChunksDir), { recursive: true });
    // Create a symbolic link that points back to the real chunks folder.
    fs.symlinkSync(chunksDir, embedChunksDir, 'junction');
    console.log('[startup] Created symlink', embedChunksDir, '->', chunksDir);
  }
} catch (err) {
  console.warn('[startup] Failed to create chunks symlink:', err);
}

// --- BEGIN PATCH: ensure .next/server/*.js symlinks for chunks ---
try {
  const chunkFiles = fs.existsSync(chunksDir) ? fs.readdirSync(chunksDir).filter(f => f.endsWith('.js')) : [];
  for (const file of chunkFiles) {
    const target = path.join(buildDir, file); // e.g., .next/server/447.js
    const source = path.join(chunksDir, file);
    if (!fs.existsSync(target)) {
      try {
        fs.symlinkSync(source, target, 'junction');
        console.log('[startup] Linked chunk', target, '->', source);
      } catch (err) {
        console.warn('[startup] Failed linking chunk', file, err.message);
      }
    }
  }
} catch (err) {
  console.warn('[startup] Error while linking chunk files:', err);
}
// --- END PATCH ---

// 生成协议头 - 修复版本
function generateHeader(
  version = PROTOCOL_VERSION,
  messageType = CLIENT_FULL_REQUEST,
  messageTypeSpecificFlags = MSG_WITH_EVENT,
  serialMethod = JSON_SERIALIZATION,
  compressionType = GZIP,
  reservedData = 0x00,
  extensionHeader = Buffer.alloc(0)
) {
  // 修复：正确计算headerSize
  const headerSize = Math.floor(extensionHeader.length / 4) + 1;
  const header = Buffer.alloc(headerSize * 4);
  
  header[0] = (version << 4) | headerSize;
  header[1] = (messageType << 4) | messageTypeSpecificFlags;
  header[2] = (serialMethod << 4) | compressionType;
  header[3] = reservedData;
  
  if (extensionHeader.length > 0) {
    extensionHeader.copy(header, 4);
  }
  
  return header;
}

// 数字转换为4字节大端序
function numberToBytes(num) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(num, 0);
  return buffer;
}

// 生成连接ID
function generateConnectId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // 创建WebSocket服务器
  const wss = new WebSocket.Server({ 
    server,
    path: '/api/voice/realtime'
  });

  wss.on('connection', (clientWs, req) => {
    console.log('新的客户端WebSocket连接');
    
    const url = parse(req.url, true);
    const sessionId = url.query.sessionId;
    const clientId = url.query.clientId || 'unknown';
    
    if (!sessionId) {
      console.error('缺少会话ID');
      clientWs.close(1008, '缺少会话ID');
      return;
    }

    console.log('会话ID:', sessionId, '客户端ID:', clientId);

    let doubaoWs = null;
    let isConnected = false;
    let isProtocolInitialized = false;
    
    // 🆕 新增：心跳管理
    let lastPingTime = Date.now();
    let heartbeatCheckInterval = null;

    // 🔧 修改：禁用强制心跳检查，避免30秒断开问题
    const startHeartbeatCheck = () => {
      console.log('⚠️  已禁用强制心跳检查，避免30秒断开问题');
      // 注释掉原有的心跳检查逻辑，允许长时间连接
      /*
      heartbeatCheckInterval = setInterval(() => {
        const timeSinceLastPing = Date.now() - lastPingTime;
        
        // 如果30秒内没收到客户端心跳，认为连接异常
        if (timeSinceLastPing > 30000) {
          console.warn('客户端心跳超时，距离上次ping:', timeSinceLastPing, 'ms');
          console.log('主动关闭异常连接');
          
          // 清理豆包连接
          if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
            doubaoWs.close();
          }
          
          // 关闭客户端连接
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, '心跳超时');
          }
        }
      }, 15000); // 每15秒检查一次
      */
    };

    // 🆕 新增：停止心跳检查
    const stopHeartbeatCheck = () => {
      if (heartbeatCheckInterval) {
        clearInterval(heartbeatCheckInterval);
        heartbeatCheckInterval = null;
        console.log('停止服务器端心跳检查');
      }
    };

    // 连接到豆包服务
    const connectToDoubao = async () => {
      try {
        console.log('正在连接到豆包服务...');
        
        // 完整的豆包WebSocket headers
        const headers = {
          'X-Api-App-ID': '2139817228',
          'X-Api-Access-Key': 'LMxFTYn2mmWwQwmLfT3ZbwS4yj0JPiMt',
          'X-Api-Resource-Id': 'volc.speech.dialog',
          'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
          'X-Api-Connect-Id': generateConnectId()
        };

        console.log('连接头信息:', headers);

        doubaoWs = new WebSocket('wss://openspeech.bytedance.com/api/v3/realtime/dialogue', {
          headers: headers
        });

        doubaoWs.on('open', async () => {
          console.log('🎯 豆包WebSocket连接已建立，开始协议初始化...');
          console.log('📡 连接状态: readyState =', doubaoWs.readyState);
          
          try {
            // 发送StartConnection请求
            console.log('📤 正在发送StartConnection...');
            await sendStartConnection();
            console.log('✅ StartConnection已发送');
            
            // 等待一下再发送StartSession
            setTimeout(async () => {
              try {
                console.log('📤 正在发送StartSession...');
                await sendStartSession();
                console.log('✅ StartSession已发送');
                
                isProtocolInitialized = true;
                isConnected = true;
                
                // 通知客户端连接成功
                clientWs.send(JSON.stringify({
                  type: 'connected',
                  sessionId: sessionId,
                  clientId: clientId
                }));
                
                // 🚫 禁用启动心跳检查
                // startHeartbeatCheck();
                
                console.log('🎉 豆包协议初始化完成，会话ID:', sessionId);
              } catch (error) {
                console.error('❌ StartSession失败:', error);
                clientWs.send(JSON.stringify({
                  type: 'error',
                  error: 'StartSession失败: ' + error.message
                }));
              }
            }, 500);
            
          } catch (error) {
            console.error('❌ StartConnection失败:', error);
            clientWs.send(JSON.stringify({
              type: 'error',
              error: 'StartConnection失败: ' + error.message
            }));
          }
        });

        // 发送StartConnection请求
        const sendStartConnection = async () => {
          try {
            const header = generateHeader();
            console.log('=== 发送协议头调试 ===');
            console.log('生成的协议头:', Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' '));
            console.log('header[0]值:', header[0], '(二进制:', header[0].toString(2), ')');
            
            const payload = Buffer.from('{}');
            const compressedPayload = await gzipAsync(payload);
            
            const message = Buffer.concat([
              header,
              numberToBytes(1), // StartConnection event
              numberToBytes(compressedPayload.length),
              compressedPayload
            ]);
            
            console.log('完整消息前16字节:', Array.from(message.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            
            doubaoWs.send(message);
            console.log('已发送StartConnection请求, 大小:', message.length);
          } catch (error) {
            console.error('发送StartConnection失败:', error);
            throw error;
          }
        };

        // 发送StartSession请求
        const sendStartSession = async () => {
          try {
            const startSessionReq = {
              tts: {
                audio_config: {
                  channel: 1,
                  format: 'pcm',
                  sample_rate: 24000
                }
              },
              dialog: {
                bot_name: '豆包'
              }
            };

            const header = generateHeader();
            const sessionIdBytes = Buffer.from(sessionId);
            const payload = Buffer.from(JSON.stringify(startSessionReq));
            const compressedPayload = await gzipAsync(payload);
            
            const message = Buffer.concat([
              header,
              numberToBytes(100), // StartSession event
              numberToBytes(sessionIdBytes.length),
              sessionIdBytes,
              numberToBytes(compressedPayload.length),
              compressedPayload
            ]);
            
            doubaoWs.send(message);
            console.log('已发送StartSession请求, 大小:', message.length);
          } catch (error) {
            console.error('发送StartSession失败:', error);
            throw error;
          }
        };

        doubaoWs.on('message', async (data) => {
          try {
            console.log('=== 豆包原始响应调试 ===');
            console.log('数据大小:', data.length);
            console.log('前8字节:', Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            
            // 解析协议头
            if (data.length >= 4) {
              const protocolVersion = data[0] >> 4;
              const headerSize = data[0] & 0x0f;
              console.log('解析的协议版本:', protocolVersion);
              console.log('解析的头部大小:', headerSize);
              console.log('原始header[0]值:', data[0], '(二进制:', data[0].toString(2), ')');
            }
            
            console.log('收到豆包消息, 大小:', data.length);
            
            // 解析豆包响应
            const response = await parseDoubaoResponse(data);
            console.log('解析结果:', {
              messageType: response.messageType,
              event: response.event,
              payloadType: typeof response.payloadMsg,
              payloadSize: response.payloadMsg instanceof Buffer ? response.payloadMsg.length : 'N/A'
            });
            
            // 直接转发原始二进制数据给客户端
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data);
            }
          } catch (error) {
            console.error('调试失败:', error);
            console.error('处理豆包消息失败:', error);
            clientWs.send(JSON.stringify({
              type: 'error',
              error: '处理豆包消息失败: ' + error.message
            }));
          }
        });

        doubaoWs.on('error', (error) => {
          console.error('❌ 豆包WebSocket错误:', error);
          console.error('🔍 错误详情:', {
            message: error.message,
            code: error.code,
            stack: error.stack?.slice(0, 200)
          });
          
          // 发送详细错误信息给客户端
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'error',
              error: `豆包服务连接错误: ${error.message || '未知错误'} (${error.code || 'NO_CODE'})`
            }));
          }
        });

        doubaoWs.on('close', (code, reason) => {
          const reasonText = reason ? reason.toString() : '无原因';
          console.log(`🔌 豆包WebSocket连接已关闭, code: ${code}, reason: ${reasonText}`);
          console.log('📊 连接状态详情:', {
            isConnected,
            isProtocolInitialized,
            sessionId,
            客户端状态: clientWs.readyState === WebSocket.OPEN ? 'OPEN' : 'CLOSED'
          });
          
          isConnected = false;
          
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'end',
              details: {
                code,
                reason: reasonText,
                wasInitialized: isProtocolInitialized
              }
            }));
          }
        });

      } catch (error) {
        console.error('连接豆包服务失败:', error);
        clientWs.send(JSON.stringify({
          type: 'error',
          error: '无法连接到豆包服务: ' + error.message
        }));
      }
    };

    // 处理客户端消息
    clientWs.on('message', (message) => {
      try {
        // 检查是否是二进制消息（音频数据）
        if (Buffer.isBuffer(message)) {
          console.log('收到客户端音频数据, 大小:', message.length);
          
          if (doubaoWs && isConnected && isProtocolInitialized && doubaoWs.readyState === WebSocket.OPEN) {
            // 直接转发音频数据到豆包
            doubaoWs.send(message);
          } else {
            console.warn('豆包连接未就绪，忽略音频数据');
          }
        } else {
          // JSON消息处理
          try {
            const jsonMessage = JSON.parse(message.toString());
            console.log('收到客户端JSON消息:', jsonMessage.type);
            
            // 根据消息类型处理
            switch (jsonMessage.type) {
              case 'ping':
                // 🆕 改进：处理心跳包
                console.log('收到客户端心跳包, 时间戳:', jsonMessage.timestamp);
                lastPingTime = Date.now();
                
                // 发送心跳响应
                clientWs.send(JSON.stringify({ 
                  type: 'pong', 
                  timestamp: Date.now(),
                  sessionId: sessionId
                }));
                console.log('已回复心跳响应');
                break;
              default:
                console.log('未处理的消息类型:', jsonMessage.type);
            }
          } catch (error) {
            console.error('解析客户端JSON消息失败:', error);
          }
        }
      } catch (error) {
        console.error('处理客户端消息失败:', error);
      }
    });

    clientWs.on('close', () => {
      console.log('客户端WebSocket连接已关闭');
      
      // 🚫 禁用停止心跳检查
      // stopHeartbeatCheck();
      
      // 清理豆包连接
      if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
        try {
          sendFinishSession().then(() => {
            setTimeout(() => {
              sendFinishConnection().then(() => {
                setTimeout(() => {
                  doubaoWs.close();
                }, 100);
              });
            }, 100);
          });
        } catch (error) {
          console.error('发送结束请求失败:', error);
          doubaoWs.close();
        }
      }
    });

    clientWs.on('error', (error) => {
      console.error('客户端WebSocket错误:', error);
      
      // 🚫 禁用停止心跳检查
      // stopHeartbeatCheck();
      
      if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
        doubaoWs.close();
      }
    });

    // 发送结束会话请求
    const sendFinishSession = async () => {
      if (!doubaoWs || doubaoWs.readyState !== WebSocket.OPEN) return;
      
      try {
        const header = generateHeader();
        const sessionIdBytes = Buffer.from(sessionId);
        const payload = Buffer.from('{}');
        const compressedPayload = await gzipAsync(payload);
        
        const message = Buffer.concat([
          header,
          numberToBytes(102), // FinishSession event
          numberToBytes(sessionIdBytes.length),
          sessionIdBytes,
          numberToBytes(compressedPayload.length),
          compressedPayload
        ]);
        
        doubaoWs.send(message);
        console.log('已发送FinishSession请求');
      } catch (error) {
        console.error('发送FinishSession失败:', error);
      }
    };

    // 发送结束连接请求
    const sendFinishConnection = async () => {
      if (!doubaoWs || doubaoWs.readyState !== WebSocket.OPEN) return;
      
      try {
        const header = generateHeader();
        const payload = Buffer.from('{}');
        const compressedPayload = await gzipAsync(payload);
        
        const message = Buffer.concat([
          header,
          numberToBytes(2), // FinishConnection event
          numberToBytes(compressedPayload.length),
          compressedPayload
        ]);
        
        doubaoWs.send(message);
        console.log('已发送FinishConnection请求');
      } catch (error) {
        console.error('发送FinishConnection失败:', error);
      }
    };

    // 开始连接到豆包
    connectToDoubao();
  });

  // 解析豆包响应的函数
  async function parseDoubaoResponse(data) {
    if (data.length < 4) {
      throw new Error('数据长度不足');
    }

    const protocolVersion = data[0] >> 4;
    const headerSize = data[0] & 0x0f;
    const messageType = data[1] >> 4;
    const messageTypeSpecificFlags = data[1] & 0x0f;
    const serializationMethod = data[2] >> 4;
    const messageCompression = data[2] & 0x0f;
    const reserved = data[3];
    
    const headerExtensions = data.slice(4, headerSize * 4);
    const payload = data.slice(headerSize * 4);
    
    const result = {};
    let payloadMsg = null;
    let start = 0;
    
    if (messageType === SERVER_FULL_RESPONSE || messageType === SERVER_ACK) {
      result.messageType = messageType === SERVER_ACK ? 'SERVER_ACK' : 'SERVER_FULL_RESPONSE';
      
      if (messageTypeSpecificFlags & NEG_SEQUENCE) {
        result.seq = payload.readUInt32BE(start);
        start += 4;
      }
      
      if (messageTypeSpecificFlags & MSG_WITH_EVENT) {
        result.event = payload.readUInt32BE(start);
        start += 4;
      }
      
      const remainingPayload = payload.slice(start);
      if (remainingPayload.length >= 4) {
        const sessionIdSize = remainingPayload.readInt32BE(0);
        
        if (remainingPayload.length >= 4 + sessionIdSize + 4) {
          const sessionId = remainingPayload.slice(4, 4 + sessionIdSize);
          result.sessionId = sessionId.toString();
          
          const payloadSize = remainingPayload.readUInt32BE(4 + sessionIdSize);
          payloadMsg = remainingPayload.slice(4 + sessionIdSize + 4, 4 + sessionIdSize + 4 + payloadSize);
        }
      }
    } else if (messageType === SERVER_ERROR_RESPONSE) {
      result.messageType = 'SERVER_ERROR';
      result.code = payload.readUInt32BE(0);
      
      const payloadSize = payload.readUInt32BE(4);
      payloadMsg = payload.slice(8, 8 + payloadSize);
    }
    
    // 处理压缩和序列化 - 特殊处理音频数据
    if (payloadMsg && payloadMsg.length > 0) {
      // 检查是否是音频数据事件（event 352），如果是则保持原始二进制格式
      const isAudioData = result.event === 352;
      
      if (!isAudioData && messageCompression === GZIP) {
        try {
          payloadMsg = await gunzipAsync(payloadMsg);
        } catch (error) {
          console.warn('解压失败，使用原始数据:', error);
        }
      }
      
      if (!isAudioData && serializationMethod === JSON_SERIALIZATION) {
        try {
          const text = payloadMsg.toString('utf8');
          payloadMsg = JSON.parse(text);
        } catch (error) {
          console.warn('JSON解析失败，使用原始文本:', error);
          payloadMsg = payloadMsg.toString('utf8');
        }
      } else if (!isAudioData && serializationMethod !== NO_SERIALIZATION) {
        payloadMsg = payloadMsg.toString('utf8');
      }
      
      // 如果是音频数据，保持为Buffer格式
      if (isAudioData) {
        console.log('检测到音频数据事件 352，保持原始二进制格式，大小:', payloadMsg.length);
      }
    }
    
    result.payloadMsg = payloadMsg;
    return result;
  }

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> WebSocket代理服务器已启动在 /api/voice/realtime');
  });
}); 