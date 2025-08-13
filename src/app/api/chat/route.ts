// src/app/api/chat/route.ts
// 集成了OpenManus AI代理功能的聊天API
import { NextRequest, NextResponse } from 'next/server';
import { ChatRequest, PageContext } from '@/types';
import { ExtendedToolExecutor } from '@/utils/toolManagerExtended';

// 删除重复的PageContextProcessor类定义，使用下面已有的更完整版本

interface SearchResult {
  name: string;
  url: string;
  snippet: string;
  summary?: string;
  siteName: string;
  datePublished?: string;
  siteIcon?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
}

// 移除未使用的接口定义

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// 兼容 Kimi 的消息清洗：移除空的 assistant 消息，规范 tool 消息
function sanitizeMessagesForKimi(rawMessages: any[]): any[] {
  const sanitized: any[] = [];
  for (const msg of rawMessages || []) {
    if (!msg || !msg.role) continue;
    // 统一确保 content 为字符串
    let content = msg.content;
    if (content === undefined || content === null) content = '';
    if (typeof content !== 'string') {
      try { content = JSON.stringify(content); } catch { content = String(content); }
    }

    if (msg.role === 'assistant') {
      const hasToolCalls = Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0;
      if (!content.trim()) {
        if (hasToolCalls) {
          sanitized.push({ ...msg, content: '调用工具' });
        }
        // 没有内容且没有工具调用的 assistant，直接丢弃
        continue;
      }
      sanitized.push({ ...msg, content });
      continue;
    }

    if (msg.role === 'tool') {
      const toolCallId = (msg as any).tool_call_id;
      sanitized.push({ ...msg, content, tool_call_id: toolCallId });
      continue;
    }

    // 其他角色（system/user），保留并确保 content 为字符串
    sanitized.push({ ...msg, content });
  }
  return sanitized;
}

// Helper 函数
async function parseStream(
  reader: ReadableStreamDefaultReader,
  onLine: (line: string) => void
) {
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    lines.forEach(l => l.startsWith('data: ') && onLine(l.slice(6)));
  }
}

// 动态获取工具定义（包括MCP工具）
async function getToolDefinitions() {
  console.log('🎯 Chat API: 获取工具定义');
  
  // 确保MCP已初始化
  const { mcpConnector } = await import('@/utils/mcpConnector');
  const connectionState = mcpConnector.getConnectionState();
  
  if (!connectionState.isInitialized) {
    console.log('⚡ Chat API: MCP未初始化，正在初始化...');
    try {
      await mcpConnector.initialize();
      console.log('✅ Chat API: MCP初始化完成');
    } catch (error) {
      console.error('❌ Chat API: MCP初始化失败:', error);
    }
  } else {
    console.log('✅ Chat API: MCP已初始化');
  }
  
  const tools = ExtendedToolExecutor.getAllToolDefinitions();
  console.log(`🎯 Chat API: 获取到 ${tools.length} 个工具定义`);
  
  // 统计工具类型
  const mcpTools = tools.filter(t => t.function.name.startsWith('mcp_')).length;
  const localTools = tools.length - mcpTools;
  console.log(`📊 Chat API: 本地工具 ${localTools} 个, MCP工具 ${mcpTools} 个`);
  
  return tools;
}

// 👇 新增：统一的系统提示词常量，加入 TodoWrite 原则与防误操作规范
const SYSTEM_PROMPT = `
## 核心定位
你是一位"高效且温暖"的执行型代理。以结果为导向，聚焦把用户目标落地；对用户保持体贴、解释清晰、过程透明；减少无谓确认。

## 平台权限
- 具备 TodoWrite：任务规划和状态管理的三件套工具
- 具备平台核心功能的自动化工具：submit_post,submit_request,submit_feedback
- 具备公共互联网搜索工具：web_search
- 具备通用天气查询工具：get_weather（作为高德天气工具的回退选项）
- 具备高德地图 MCP 工具（详见下方清单）。默认信任工具返回，不臆造信息；异常时按"容错与回退"执行

## 高德MCP工具清单（精确版本）

地点搜索与POI查询：
- maps_text_search(keywords, city?, citylimit?)
  参数：keywords必需关键词，city推荐城市，citylimit可选是否限城市
  返回：POI列表，包含name, location, address, id等

- maps_around_search(keywords, location, radius?)
  参数：keywords必需关键词，location必需中心点坐标"经度,纬度"，radius可选半径米数
  返回：周边POI列表

- maps_search_detail(id)
  参数：id必需POI的ID
  返回：详细POI信息

路径规划：
- maps_direction_driving(origin, destination)
  参数：origin/destination格式为"经度,纬度"
  返回：驾车路线方案

- maps_direction_walking(origin, destination)
  参数：origin/destination格式为"经度,纬度"，最大支持100km
  返回：步行路线和时间

- maps_direction_bicycling(origin, destination)
  参数：origin/destination格式为"经度,纬度"，最大支持500km
  返回：骑行路线，考虑自行车道和坡度

- maps_direction_transit_integrated(origin, destination, city, cityd)
  参数：origin/destination为坐标"经度,纬度"，city必需起点城市，cityd必需终点城市
  返回：公共交通方案（地铁、公交、火车等）

距离测量：
- maps_distance(origins, destination, type?)
  参数：origins起点坐标多个用|分隔，destination终点坐标，type类型1驾车0直线3步行
  返回：距离和时间

地理编码：
- maps_geo(address, city?)
  参数：address必需详细地址，city推荐所在城市
  返回：经纬度坐标

- maps_regeocode(location)
  参数：location必需坐标"经度,纬度"
  返回：结构化地址信息

天气与环境：
- maps_weather(city)
  参数：city必需城市名称或adcode
  返回：天气、预报、空气质量等

- maps_ip_location(ip)
  参数：ip必需IP地址
  返回：IP对应地理位置

客户端集成：
- maps_schema_navi(lon, lat)
  参数：lon经度，lat纬度
  功能：唤起高德地图导航
  
- maps_schema_take_taxi(dlon, dlat, dname, slon?, slat?, sname?)
  参数：dlon/dlat/dname终点必需，slon/slat/sname起点可选
  功能：唤起打车

## TodoWrite工具最佳实践

使用时机（立即建清单）：
满足以下任一条件：
1. 任务需要3+个步骤
2. 用户使用"帮我/我想要/需要完成"等表述
3. 涉及多个工具调用的复杂任务
4. 地图相关的多步操作（搜索→规划→比较）

工作流标准：
1. create_todo_list：将任务分解为具体的执行步骤
2. 标记in_progress：将当前执行的任务标记为进行中（同时只能有一个）
3. 工具调用：执行具体操作并向用户播报进度
4. complete_todo_task：完成后立即标记完成状态
5. 循环执行：继续下一个任务直到全部完成

任务管理原则：
- 单一焦点：同时只有一个任务为in_progress状态
- 实时更新：每完成一步立即更新状态，不要批量更新
- 透明播报：告诉用户当前正在执行什么步骤
- 具体分解：任务要具体可执行，避免过于宽泛

## 工具使用限制（极其重要）

### 地图任务强制规则
当用户需求涉及以下内容时，**必须且只能**使用高德MCP工具：
- 路径规划、导航、路线查询
- 地点搜索、POI查询、周边服务
- 地理编码、坐标转换
- 距离测量、时间估算
- 天气查询（优先使用maps_weather）

### 地图任务识别规则
以下情境视为地图任务：
1. "怎么去""到哪里""从A到B""路线规划"等表述
2. "附近""周边""最近""周围" + 地点/服务类型
3. "步行多久""开车多久""多远""距离"等
4. "天气""气温"等与出行相关的查询
5. 出现地址、城市名、经纬度等地理信息

### 容错与回退机制
- API密钥错误：明确告知用户配置问题，不要尝试其他数据源
- 工具调用失败：检查参数格式，特别注意坐标格式"经度,纬度"
- 无结果：提供替代搜索建议或扩大搜索范围
- 跨城查询：确保提供起止城市参数

## 坐标格式标准
- 所有坐标参数使用"经度,纬度"格式，如"116.404,39.915"
- 经度在前，纬度在后，用英文逗号分隔
- 多个坐标用竖线|分隔，如"120.1,30.2|120.2,30.3"

## 执行策略优化

### 槽位收集原则
- **最小可行信息**：先以现有信息调用获取候选结果，再根据结果澄清细节
- **避免连环追问**：不要为了完整信息而过度询问用户
- **智能推断**：使用IP定位等工具推断用户位置，但需确认

### 任务透明度
- **播报进度**：每次工具调用前说明要做什么
- **解释选择**：为什么选择某个路线或方案
- **预期管理**：告知用户大概需要多长时间完成

### 结果展示
- **结构化输出**：使用表格、列表等格式清晰展示结果
- **关键信息突出**：时间、距离、费用等重要信息要醒目
- **可操作建议**：提供具体的下一步行动建议

## 异常处理标准

### 常见错误处理
1. **INVALID_USER_KEY**：提示检查API密钥配置
2. **参数格式错误**：检查坐标格式是否为"经度,纬度"
3. **无搜索结果**：建议扩大搜索范围或修改关键词
4. **超出服务范围**：明确告知限制条件（如步行100km限制）

### 回退策略
- 优先使用高德MCP工具
- API失败时不要静默切换到其他数据源
- 明确告知用户当前工具的限制和问题
- 提供基于可用工具的替代方案

---

**记住：始终以用户目标为导向，保持执行的高效性和沟通的温暖性。通过TodoWrite工具让用户清楚地看到任务进展，通过高德MCP工具提供准确的地理信息服务。**
`;

// 页面上下文处理器
class PageContextProcessor {
  // 生成页面上下文的系统消息
  static generateContextSystemMessage(pageContext: PageContext): string {
    if (!pageContext) return '';

    const { basic, metadata, structure, extracted } = pageContext;
    
    let contextMessage = `[页面上下文信息]\n`;
    
    // 基本信息
    contextMessage += `当前页面：${basic.title}\n`;
    contextMessage += `页面URL：${basic.url}\n`;
    contextMessage += `页面类型：${this.getPageTypeDescription(basic.type)}\n`;
    if (basic.description) {
      contextMessage += `页面描述：${basic.description}\n`;
    }
    
    // 元数据信息
    if (metadata) {
      if (metadata.author) {
        contextMessage += `作者：${metadata.author}\n`;
      }
      if (metadata.publishDate) {
        contextMessage += `发布时间：${metadata.publishDate}\n`;
      }
      if (metadata.keywords && metadata.keywords.length > 0) {
        contextMessage += `关键词：${metadata.keywords.join(', ')}\n`;
      }
    }
    
    // 页面结构
    if (structure?.sections && structure.sections.length > 0) {
      contextMessage += `\n页面结构：\n`;
      structure.sections.slice(0, 8).forEach((section) => {
        contextMessage += `- ${section}\n`;
      });
    }
    
    // 页面内容摘要
    if (extracted?.summary) {
      contextMessage += `\n页面主要内容：\n${extracted.summary}\n`;
    }
    
    // 关键要点
    if (extracted?.keyPoints && extracted.keyPoints.length > 0) {
      contextMessage += `\n页面关键要点：\n`;
      extracted.keyPoints.slice(0, 5).forEach(point => {
        contextMessage += `- ${point}\n`;
      });
    }
    
    // 内容统计
    if (structure?.wordCount && structure?.readingTime) {
      contextMessage += `\n内容统计：约${structure.wordCount}字，预计阅读时间${structure.readingTime}分钟\n`;
    }
    
    contextMessage += `\n---\n`;
    contextMessage += `请基于以上页面上下文信息来回答用户的问题。当用户询问"这个页面"、"当前页面"、"总结页面内容"等相关问题时，请参考上述信息进行回答。\n`;
    
    return contextMessage;
  }

  // 获取页面类型描述
  static getPageTypeDescription(pageType: string): string {
    const typeMap: Record<string, string> = {
      'homepage': '首页',
      'about': '关于页面',
      'contact': '联系页面',
      'blog_post': '博客文章',
      'product': '产品页面',
      'portfolio': '作品展示页面',
      'general': '一般页面'
    };
    
    return typeMap[pageType] || '未知页面类型';
  }

  // 检测是否为页面相关问题
  static isPageRelatedQuestion(userMessage: string): boolean {
    const pageKeywords = [
      '这个页面', '当前页面', '这页', '本页',
      '总结页面', '页面内容', '页面说什么', '页面讲什么',
      '这里写的什么', '这里说的什么', '这个网站',
      '这个作品', '这个项目', '这篇文章',
      '页面主要内容', '这个页面讲的是什么'
    ];
    
    return pageKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // 增强用户消息（为页面相关问题添加上下文提示）
  static enhanceUserMessage(userMessage: string, pageContext: PageContext): string {
    if (!pageContext || !this.isPageRelatedQuestion(userMessage)) {
      return userMessage;
    }

    // 为页面相关问题添加明确的上下文提示
    return userMessage + `\n\n[请基于当前页面"${pageContext.basic.title}"的内容来回答这个问题]`;
  }
}

// 移除未使用的 ToolResultProcessor 类

export async function POST(request: NextRequest) {
  try {
    const { 
      messages, 
      model = 'kimi-k2-turbo-preview', 
      temperature = 1.0, 
      max_tokens = 2048,
      // top_p = 0.8,
      // frequency_penalty = 0.3,
      pageContext
    }: ChatRequest = await request.json();

    console.log('🚀 收到聊天请求:', {
      messagesCount: messages?.length,
      model,
      hasPageContext: !!pageContext
    });

    // 🔑 从请求头或cookie中获取 satoken
    const satokenFromHeader = request.headers.get('Authorization')?.replace('Bearer ', '');
    const satokenFromCookie = request.cookies.get('satoken')?.value;
    const satokenFromBody = pageContext?.auth?.satoken;

    const satoken = satokenFromBody || satokenFromHeader || satokenFromCookie;
    
    console.log(`🔑 satoken捕获: Body(${satokenFromBody ? '✅' : '❌'}), Header(${satokenFromHeader ? '✅' : '❌'}), Cookie(${satokenFromCookie ? '✅' : '❌'}). 最终使用: ${satoken ? '✅' : '❌'}`);

    // 验证请求数据
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: '无效的消息格式' },
        { status: 400 }
      );
    }

    // 检查 API 密钥
    if (!process.env.MOONSHOT_API_KEY) {
      console.error('❌ Kimi API 密钥未配置');
      return NextResponse.json({
        message: '抱歉，AI 服务配置有误。',
        messageId: Date.now().toString(),
        error: 'API密钥未配置',
        isSimulated: true
      });
    }

    // 处理页面上下文
    const processedMessages = [...messages];
    if (pageContext && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        const enhancedContent = PageContextProcessor.enhanceUserMessage(
          lastMessage.content, 
          pageContext
        );
        processedMessages[processedMessages.length - 1] = {
          ...lastMessage,
          content: enhancedContent
        };
      }
    }

    // 构建系统消息
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPT
    };

    // 🔑 统一流式处理架构
    const encoder = new TextEncoder();
    
    return new Response(new ReadableStream({
      async start(controller) {
        const messageId = `msg_${Date.now()}`;
        let reasoningContent = '';
        let finalContent = '';
        const toolCalls: ToolCall[] = [];
        let keepOpen = false; // 如果存在pending任务保持流打开

        try {
          console.log('📤 发送Kimi请求（第一阶段 - 推理和工具调用）');
          
          // 第一阶段：Kimi推理，可能包含工具调用
          const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.MOONSHOT_API_KEY}`,
            },
            body: JSON.stringify({
              model,
              messages: sanitizeMessagesForKimi([systemMessage, ...processedMessages]),
              temperature,
              max_tokens,
              // ...(top_p !== undefined && { top_p }),
              // ...(frequency_penalty !== undefined && { frequency_penalty }),
              stream: true,
              tools: await getToolDefinitions(),
              tool_choice: 'auto'
            })
          });

          if (!response.ok) {
            let errorBody = '';
            try { errorBody = await response.text(); } catch {}
            console.error('Kimi API响应错误(第一阶段):', response.status, errorBody);
            throw new Error(`Kimi API错误: ${response.status}`);
          }

          // 处理流式响应
          const reader = response.body?.getReader();
          if (!reader) throw new Error('无法获取响应流');

          await parseStream(reader, line => {
            if (line === '[DONE]') return;

            try {
              const parsed = JSON.parse(line);
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.reasoning_content) {
                reasoningContent += delta.reasoning_content;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'reasoning',
                  content: delta.reasoning_content,
                  messageId
                })}\n\n`));
              } else if (delta?.content) {
                finalContent += delta.content;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content',
                  content: delta.content,
                  messageId
                })}\n\n`));
              } else if (delta?.tool_calls) {
                // 处理工具调用（累积分片数据）
                delta.tool_calls.forEach((toolCall: {
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }) => {
                  if (typeof toolCall.index === 'number') {
                    const index = toolCall.index;
                    
                    // 确保数组长度足够
                    while (toolCalls.length <= index) {
                      toolCalls.push({
                        id: `temp_${index}`,
                        type: 'function',
                        function: { name: '', arguments: '' }
                      });
                    }
                    
                    // 累积工具调用数据
                    if (toolCall.id) toolCalls[index].id = toolCall.id;
                    if (toolCall.function?.name) {
                      toolCalls[index].function.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                      toolCalls[index].function.arguments += toolCall.function.arguments;
                    }
                  }
                });
              }
            } catch (e) {
              console.error('解析流式数据错误:', e);
            }
          });

          // 第二阶段：如果有工具调用，执行工具
          if (toolCalls.length > 0) {
            console.log('🛠️ 检测到工具调用，开始执行:', toolCalls.map(t => t.function.name));
            
            // 过滤有效的工具调用
            const validToolCalls = toolCalls.filter(tc => 
              tc.function.name && 
              tc.function.arguments && 
              !tc.id.startsWith('temp_')
            );

            if (validToolCalls.length > 0) {
            // 发送工具执行开始信号
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_execution',
              tool_calls: validToolCalls,
              messageId
            })}\n\n`));

              // 🔑 统一调用 /api/tools 执行所有工具
              const toolResults = await executeTools(validToolCalls, controller, encoder, messageId, satoken, pageContext);
                
              // 检查是否有pending的OpenManus任务
              const pendingOpenManusTasks = extractPendingTasks(toolResults);
              
              if (pendingOpenManusTasks.length > 0) {
                console.log('⏳ 检测到pending OpenManus任务:', pendingOpenManusTasks);
                
                // 发送pending信号
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'pending_openmanus',
                task_ids: pendingOpenManusTasks,
                messageId
              })}\n\n`));

                // 启动任务监控
                monitorPendingTasks(
                  pendingOpenManusTasks, 
                  processedMessages, 
                  validToolCalls, 
                  toolResults, 
                  controller, 
                  encoder, 
                  messageId, 
                  satoken, 
                  model, 
                  temperature, 
                  max_tokens
                  // top_p,
                  // frequency_penalty
                );
                keepOpen = true; // 标记保持流式连接
                return; // 暂停，等待任务完成
              }

              // 第三阶段：将工具结果发回Kimi继续推理（追加Todo记忆，降低跨轮次错误率）
              await continueWithToolResults(
                processedMessages, 
                validToolCalls, 
                // 适配工具结果结构: ensure tool_call_id + content 字符串
                toolResults.map((r: any) => ({
                  ...r,
                  content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
                })), 
                controller, 
                encoder, 
                messageId, 
                satoken, 
                model, 
                temperature, 
                max_tokens,
                buildTodoMemoryFromToolResults(toolResults) || undefined
                // top_p,
                // frequency_penalty
              );

              // 🧩 自动收尾：如果模型没有显式更新最后一步，但Todo仍未完成，则补一次状态更新提示
              try {
                const lastTodo = extractLatestTodoList(toolResults);
                if (lastTodo && lastTodo.completed_tasks < lastTodo.total_tasks) {
                  const remaining = (lastTodo.tasks || []).find((t: any) => t.status !== 'completed');
                  if (remaining) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'system_instruction',
                      content: `收尾检查：你还有未完成的任务: "${remaining.content}"。如果该步骤已完成，请立即调用 complete_todo_task 完成状态更新；如果尚未完成，请继续执行该步骤。`,
                      messageId
                    })}\n\n`));
                  }
                }
              } catch {}
            }
          } else {
            // 没有工具调用，直接完成
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'done',
                      reasoning_content: reasoningContent,
              final_content: finalContent,
                      messageId
                    })}\n\n`));
          }
        } catch (error) {
          console.error('❌ 聊天处理错误:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : '处理失败',
              messageId
            })}\n\n`));
        } finally {
            if (!keepOpen) {
              controller.close();
            }
        }
        }
    }), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    console.error('❌ API错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}

// 🔑 统一工具执行函数
async function executeTools(toolCalls: ToolCall[], controller: any, encoder: any, messageId: string, satoken?: string, pageContext?: PageContext) {
  try {
    console.log('📤 调用统一工具API执行工具');
    
    // ✅ 修复：使用相对路径，避免硬编码localhost
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
    const toolsUrl = baseUrl ? `${baseUrl}/api/tools` : '/api/tools';
    
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (satoken) {
      headers['Authorization'] = `Bearer ${satoken}`;
    }

    const response = await fetch(toolsUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ 
        tool_calls: toolCalls,
        pageContext: pageContext
      })
    });

    if (!response.ok) {
      throw new Error(`工具API调用失败: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`工具执行失败: ${data.error}`);
    }

    // 发送系统提示词
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'system_instruction',
      content: '请根据以下工具执行结果回答用户问题。处理工具结果时请注意：1）重点提取和总结关键内容信息，忽略技术细节和代码；2）基于获取的信息内容，结合用户问题提供有价值的分析和建议；3）如果结果包含多个信息源，请进行整合分析；4）保持回答的准确性和实用性。',
      messageId
    })}\n\n`));

    // 发送工具结果
    data.results.forEach((result: any) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'tool_result',
        tool_call_id: result.tool_call_id,
        result: JSON.parse(result.content),
        messageId
      })}\n\n`));
    });

    console.log('✅ 所有工具执行完成');
    return data.results;
    
  } catch (error) {
    console.error('❌ 工具执行错误:', error);
    throw error;
  }
}

// 🔑 提取pending任务
function extractPendingTasks(toolResults: any[]): string[] {
  const pendingTasks: string[] = [];
  
  toolResults.forEach(result => {
    try {
      const content = JSON.parse(result.content);
      if (content.task_id && content.status === 'pending') {
        pendingTasks.push(content.task_id);
      }
    } catch (e) {
      // 忽略解析错误
    }
  });
  
  return pendingTasks;
}

// 🔧 从工具结果中提取最新的 Todo 记忆（用于后续轮次提示模型）
function buildTodoMemoryFromToolResults(toolResults: any[]): string | null {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return null;
  let lastTodo: any | null = null;
  for (const r of toolResults) {
    try {
      const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
      if (content?.todo_update?.todoList) {
        lastTodo = content.todo_update.todoList;
      } else if (content?.todoList) {
        lastTodo = content.todoList;
      }
    } catch {}
  }
  if (!lastTodo) return null;
  const currentTask = (lastTodo.tasks || []).find((t: any) => t.id === lastTodo.current_task_id);
  const lines = [
    '[TodoMemory]',
    `active_todo_id: ${lastTodo.id}`,
    `current_task_id: ${lastTodo.current_task_id || ''}`,
    `progress: ${lastTodo.completed_tasks}/${lastTodo.total_tasks}`,
    `current_task_content: ${currentTask?.content || ''}`
  ];
  return lines.join('\n');
}

// 🔧 提取最近一次包含的 TodoList 对象（供自动收尾使用）
function extractLatestTodoList(toolResults: any[]): any | null {
  if (!Array.isArray(toolResults)) return null;
  let lastTodo: any | null = null;
  for (const r of toolResults) {
    try {
      const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
      if (content?.todo_update?.todoList) {
        lastTodo = content.todo_update.todoList;
      } else if (content?.todoList) {
        lastTodo = content.todoList;
      }
    } catch {}
  }
  return lastTodo;
}

// 🔑 监控pending任务
async function monitorPendingTasks(
  taskIds: string[], 
  messages: any[], 
  toolCalls: ToolCall[], 
  toolResults: any[],
  controller: any, 
  encoder: any, 
  messageId: string,
  satoken?: string,
  model?: string,
  temperature?: number,
  max_tokens?: number
  // top_p?: number,
  // frequency_penalty?: number
) {
  console.log('🔍 开始监控pending任务:', taskIds);
    
  const checkInterval = setInterval(async () => {
    try {
      let allCompleted = true;
      const updatedResults = [...toolResults];
      
      for (let i = 0; i < taskIds.length; i++) {
        const taskId = taskIds[i];
        
        // ✅ 修复：使用相对路径，避免硬编码localhost
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
        const statusUrl = baseUrl ? `${baseUrl}/api/openmanus/status?task_id=${taskId}` : `/api/openmanus/status?task_id=${taskId}`;
        
        const statusResponse = await fetch(statusUrl);
        const statusData = await statusResponse.json();
        
        if (statusData.success && statusData.status === 'completed') {
          console.log(`✅ 任务完成: ${taskId}`);
          
          // 更新工具结果
          const resultIndex = updatedResults.findIndex(r => {
            const content = JSON.parse(r.content);
            return content.task_id === taskId;
          });
      
          if (resultIndex !== -1) {
            updatedResults[resultIndex] = {
              ...updatedResults[resultIndex],
              content: JSON.stringify({
                success: true,
                task_id: taskId,
                status: 'completed',
                result: statusData.result,
                message: '任务已完成'
              })
        };
      }
        } else if (statusData.status === 'failed') {
          console.log(`❌ 任务失败: ${taskId}`);
          // 标记为失败但继续
        } else {
          allCompleted = false;
        }
      }
      
      if (allCompleted) {
        clearInterval(checkInterval);
        console.log('🎉 所有OpenManus任务完成，继续Kimi推理');
        
        // 继续Kimi推理
        await continueWithToolResults(messages, toolCalls, updatedResults, controller, encoder, messageId, satoken, model, temperature, max_tokens
          // top_p,
          // frequency_penalty
        );
    }
  } catch (error) {
      console.error('❌ 监控任务状态失败:', error);
    }
  }, 3000); // 每3秒检查一次
  
  // 超时保护（5分钟后强制完成）
  setTimeout(() => {
    clearInterval(checkInterval);
    console.log('⏰ 任务监控超时，强制完成');
  }, 300000);
  }

// 🔑 带工具结果继续Kimi推理
async function continueWithToolResults(
  messages: any[], 
  toolCalls: ToolCall[], 
  toolResults: any[],
  controller: any, 
  encoder: any, 
  messageId: string,
  satoken?: string,
  model?: string,
  temperature?: number,
  max_tokens?: number,
  todoMemory?: string
  // top_p?: number,
  // frequency_penalty?: number
) {
      try {
    console.log('🔄 使用工具结果继续Kimi推理');
    
    // 构建完整的消息历史（确保始终包含系统提示词）
    const baseMessages = (messages.length > 0 && messages[0].role === 'system')
      ? messages
      : [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    // 附加 TodoMemory 提示，帮助下一轮工具选择携带正确ID
    const memoryMessages = todoMemory
      ? [{ role: 'system', content: `${todoMemory}` }]
      : [];

    // 将工具执行结果转换为 Kimi 期望的 tool 消息
    const toolMessages = (toolResults || []).map((result: any) => {
      const toolCallId = result.tool_call_id || result.id;
      let contentString: string;
      try {
        contentString = typeof result.content === 'string' ? result.content : JSON.stringify(result.content ?? '');
      } catch {
        contentString = String(result.content ?? '');
      }
      return {
        role: 'tool',
        content: contentString,
        tool_call_id: toolCallId
      };
    });

    const fullMessages = sanitizeMessagesForKimi([
      ...baseMessages,
      ...memoryMessages,
      {
        role: 'assistant',
        content: toolCalls.length > 0 ? '调用工具' : '(无工具调用)',
        tool_calls: toolCalls
      },
      ...toolMessages
    ]);
    
    // 调用Kimi继续推理，使用与第一阶段相同的参数
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOONSHOT_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'kimi-k2-turbo-preview',
        messages: fullMessages,
        temperature: temperature || 0.6,
        max_tokens: max_tokens || 2048,
        // ...(top_p !== undefined && { top_p }),
        // ...(frequency_penalty !== undefined && { frequency_penalty }),
        stream: true,
        tools: await getToolDefinitions(),
        tool_choice: 'auto'
      })
    });
    
    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}
      console.error('Kimi API响应错误(续写):', response.status, errorBody);
      throw new Error(`Kimi API错误: ${response.status}`);
    }
    
    // 处理续写的流式响应
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');

    let finalContent = '';
    const localToolCalls: ToolCall[] = [];
    
    await parseStream(reader, line => {
      if (line === '[DONE]') return;

      try {
        const parsed = JSON.parse(line);
        const delta = parsed.choices?.[0]?.delta;

        // 🚀 同步支持后续阶段的思维链输出
        if (delta?.reasoning_content) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'reasoning',
            content: delta.reasoning_content,
            messageId
          })}\n\n`));
        }

        if (delta?.content) {
          finalContent += delta.content;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'content',
            content: delta.content,
            messageId
          })}\n\n`));
        } else if (delta?.tool_calls) {
          // 处理工具调用（累积分片数据）
          delta.tool_calls.forEach((toolCall: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }) => {
            if (typeof toolCall.index === 'number') {
              const index = toolCall.index;
              
              while (localToolCalls.length <= index) {
                localToolCalls.push({
                  id: `temp_${index}`,
                  type: 'function',
                  function: { name: '', arguments: '' }
                });
              }
              
              if (toolCall.id) localToolCalls[index].id = toolCall.id;
              if (toolCall.function?.name) localToolCalls[index].function.name = toolCall.function.name;
              if (toolCall.function?.arguments) localToolCalls[index].function.arguments += toolCall.function.arguments;
            }
          });
        }
      } catch (e) {
        console.error('解析续写响应错误:', e);
      }
    });

    // 如果本阶段出现工具调用，执行并递归下一阶段
    const validToolCalls = localToolCalls.filter(tc => tc.function.name && tc.function.arguments && !tc.id.startsWith('temp_'));

    if (validToolCalls.length > 0) {
      // 通知前端工具执行开始
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'tool_execution',
        tool_calls: validToolCalls,
        messageId
      })}\n\n`));

      const newToolResults = await executeTools(validToolCalls, controller, encoder, messageId, satoken);

      // 检测pending任务
      const pendingOpenManusTasks = extractPendingTasks(newToolResults);
      if (pendingOpenManusTasks.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'pending_openmanus',
          task_ids: pendingOpenManusTasks,
          messageId
        })}\n\n`));

        await monitorPendingTasks(
          pendingOpenManusTasks, 
          fullMessages, 
          validToolCalls, 
          newToolResults, 
          controller, 
          encoder, 
          messageId, 
          satoken, 
          model, 
          temperature, 
          max_tokens
          // top_p,
          // frequency_penalty
        );
        return; // monitorPendingTasks 内部会在完成后继续递归
      }

      // 递归进入下一阶段
      await continueWithToolResults(
        fullMessages, 
        validToolCalls, 
        newToolResults, 
        controller, 
        encoder, 
        messageId, 
        satoken, 
        model, 
        temperature, 
        max_tokens
        // top_p,
        // frequency_penalty
      );
      return;
    }

    // 若无更多工具调用，则发送完成信号
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'done',
      final_content: finalContent,
      messageId
    })}\n\n`));

    console.log('✅ Kimi推理完成');

    controller.close();
  } catch (error) {
    console.error('❌ 续写Kimi推理失败:', error);
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : '续写失败',
      messageId
    })}\n\n`));
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: '聊天API运行正常',
    timestamp: new Date().toISOString(),
    supportedModels: ['kimi-k2-turbo-preview'],
    features: ['工具调用', '流式响应', 'OpenManus集成']
  });
}