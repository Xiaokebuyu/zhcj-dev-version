// src/app/api/chat/route.ts
// 集成了OpenManus AI代理功能的聊天API
import { NextRequest, NextResponse } from 'next/server';
import { ChatRequest, PageContext } from '@/types';
import { ToolRouter } from '@/utils/toolRouter'; // 替换ExtendedToolExecutor

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

// 全局初始化标志
let isToolRouterInitialized = false;

// 🔧 初始化函数 - 替换原有的MCP初始化
async function initializeToolRouter() {
  if (!isToolRouterInitialized) {
    try {
      await ToolRouter.initialize();
      isToolRouterInitialized = true;
      console.log('✅ Chat API: 工具路由器初始化完成');
    } catch (error) {
      console.error('❌ Chat API: 工具路由器初始化失败:', error);
    }
  }
}

// 🔧 获取工具定义函数 - 替换原有的getMCPTools
async function getToolDefinitions() {
  // 确保工具路由器已初始化
  await initializeToolRouter();
  
  const tools = ToolRouter.getAllToolDefinitions();
  console.log(`🎯 Chat API: 获取到 ${tools.length} 个工具定义`);
  
  // 统计工具类型
  const mcpTools = tools.filter(t => t._metadata?.type === 'mcp').length;
  const localTools = tools.length - mcpTools;
  console.log(`📊 Chat API: 本地工具 ${localTools} 个, MCP工具 ${mcpTools} 个`);
  
  return tools;
}

// 👇 新增：统一的系统提示词常量，加入 TodoWrite 原则与防误操作规范
const SYSTEM_PROMPT = `
## 核心定位
你是一位"高效且温暖"的执行型代理。以结果为导向，聚焦把用户目标落地；对用户保持体贴、解释清晰、过程透明；减少无谓确认。

## 执行权限  
- 拥有完整平台功能调用权限
- 身份认证自动处理，无需关注satoken
- 可自主决策执行顺序和内容补全

## 决策原则
**结果导向**：用户要什么结果，就直接朝着那个目标执行
**信任工具**：平台工具都能正常工作，不必担心技术细节
**减少确认**：除关键信息外，直接按清单执行
**透明执行**：通过任务清单让用户看到整个过程

## TodoWrite任务管理原则

### 复杂任务识别
当用户需求包含以下特征时，必须创建任务清单：
- 需要多个步骤才能完成
- 涉及工具调用（搜索、发帖、查询等）
- 用户说"帮我..."、"我想要..."、"需要完成..."

### 执行模式（推荐使用新版TodoWrite工具）
1. 理解用户需求 → 立即调用TodoWrite创建任务清单
2. 开始执行第一个任务，并将其状态设为in_progress
3. 完成后立即调用TodoWrite更新状态为completed
4. 继续下一个任务直到全部完成

### TodoWrite工具使用规范
**创建任务清单示例：**
传入参数：todos数组，每个元素包含id、content、status
例如：[{id:"1", content:"分析用户需求", status:"pending"}, {id:"2", content:"搜索相关信息", status:"pending"}]

**更新任务状态示例：**
完成第一个任务后，调用TodoWrite更新状态：
[{id:"1", content:"分析用户需求", status:"completed"}, {id:"2", content:"搜索相关信息", status:"in_progress"}]

### 任务分解原则
- 每个任务是一个有意义的完整操作
- 一般分解为3-6个步骤
- 用用户友好语言描述
- 避免技术性术语

### TodoWrite任务管理要求
- **单一焦点**：同时只有一个任务为in_progress状态
- **实时更新**：每完成一步立即调用TodoWrite更新状态，不要批量更新
- **状态一致性**：每次TodoWrite调用都传入完整的todos数组，确保状态同步
- **透明播报**：告诉用户当前正在执行什么步骤
- **具体分解**：任务要具体可执行，避免过于宽泛
- **ID规则**：使用简单的数字ID（"1", "2", "3"...），便于管理

## 常见任务行为指导

### 地图规划任务
**路线规划类**：
- 目标：为用户规划从A到B的最佳路径
- 流程：搜索起终点 → 选择出行方式 → 获取路线 → 提供建议
- 出行方式自动选择：步行(<5km) → 骑行(<20km) → 驾车/公交

**地点搜索类**：
- 目标：帮用户找到合适的地点或服务
- 流程：理解需求 → 搜索POI → 筛选推荐 → 提供详情
- 默认提供：地址、距离、联系方式、营业时间

**周边服务类**：
- 目标：发现用户附近的相关服务
- 流程：确定位置 → 搜索周边 → 按距离排序 → 推荐最佳选择

### 内容发布任务
**发帖流程**：
- 理解内容要求 → 创建结构化内容 → 调用发布接口 → 确认结果

**信息提交**：
- 收集必要信息 → 格式化数据 → 提交请求 → 反馈状态

### 信息搜索任务
**网络搜索**：
- 分析查询意图 → 构造搜索词 → 获取结果 → 整合回答

## 工具选择规则

### 地图相关需求
- 涉及地址、路线、距离、位置的任务：优先使用地图工具
- 天气查询：优先使用maps_weather
- 导航需求：使用schema工具唤起客户端

### 任务管理需求  
- 多步骤任务：**强烈推荐**使用新版TodoWrite工具（统一状态管理）
- 旧版工具：create_todo_list/complete_todo_task等已弃用，但暂时保留兼容性
- 迁移策略：优先使用TodoWrite，逐步减少旧工具使用
- 单一操作：直接执行，无需创建清单

### 工具优先级
1. **TodoWrite（推荐）**：统一状态管理，简化使用
2. create_todo_list/complete_todo_task（兼容）：复杂但仍可用

### 内容发布需求
- 发帖：使用submit_post
- 提交请求：使用submit_request  
- 意见反馈：使用submit_feedback

## 执行标准
- 错误处理：工具调用失败时，向用户说明并提供替代方案
- 结果确认：完成任务后明确告知用户结果
- 过程透明：让用户知道每一步在做什么
- 效率优先：能一步完成的不分两步，能自动完成的不要确认
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
                      content: `收尾检查：你还有未完成的任务: "${remaining.content}"。如果该步骤已完成，请立即调用 TodoWrite 更新状态为completed；如果尚未完成，请继续执行该步骤。`,
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

// 🔧 工具执行函数 - 保持不变，但内部会使用新的路由器
async function executeTools(toolCalls: ToolCall[], controller: any, encoder: any, messageId: string, satoken?: string, pageContext?: PageContext) {
  try {
    console.log('📤 调用统一工具API执行工具');
    
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
  let lastTodos: any[] | null = null;
  let lastTodoList: any | null = null;
  
  for (const r of toolResults) {
    try {
      const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
      
      // 新版TodoWrite格式
      if (content?.todo_update?.todos && Array.isArray(content.todo_update.todos)) {
        lastTodos = content.todo_update.todos;
      } else if (content?.todos && Array.isArray(content.todos)) {
        lastTodos = content.todos;
      }
      
      // 旧版兼容
      if (content?.todo_update?.todoList) {
        lastTodoList = content.todo_update.todoList;
      } else if (content?.todoList) {
        lastTodoList = content.todoList;
      }
    } catch {}
  }

  // 优先使用新版格式
  if (lastTodos) {
    const total = lastTodos.length;
    const completed = lastTodos.filter((t: any) => t.status === 'completed').length;
    const inProgress = lastTodos.find((t: any) => t.status === 'in_progress');
    
    const lines = [
      '[TodoMemory]',
      `format: standard`,
      `progress: ${completed}/${total}`,
      `current_task: ${inProgress?.content || 'none'}`,
      `all_tasks: ${lastTodos.map((t: any) => `${t.id}:${t.status}`).join(', ')}`
    ];
    return lines.join('\n');
  }
  
  // 回退到旧版格式
  if (lastTodoList) {
    const currentTask = (lastTodoList.tasks || []).find((t: any) => t.id === lastTodoList.current_task_id);
    const lines = [
      '[TodoMemory]',
      `format: legacy`,
      `active_todo_id: ${lastTodoList.id}`,
      `current_task_id: ${lastTodoList.current_task_id || ''}`,
      `progress: ${lastTodoList.completed_tasks}/${lastTodoList.total_tasks}`,
      `current_task_content: ${currentTask?.content || ''}`
    ];
    return lines.join('\n');
  }
  
  return null;
}

// 🔧 提取最近一次包含的 TodoList 对象（供自动收尾使用）
function extractLatestTodoList(toolResults: any[]): any | null {
  if (!Array.isArray(toolResults)) return null;
  let lastTodos: any[] | null = null;
  let lastTodoList: any | null = null;
  
  for (const r of toolResults) {
    try {
      const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
      
      // 新版TodoWrite格式
      if (content?.todo_update?.todos && Array.isArray(content.todo_update.todos)) {
        lastTodos = content.todo_update.todos;
      } else if (content?.todos && Array.isArray(content.todos)) {
        lastTodos = content.todos;
      }
      
      // 旧版兼容
      if (content?.todo_update?.todoList) {
        lastTodoList = content.todo_update.todoList;
      } else if (content?.todoList) {
        lastTodoList = content.todoList;
      }
    } catch {}
  }

  // 优先返回新版格式，转换为旧版兼容结构
  if (lastTodos) {
    const total = lastTodos.length;
    const completed = lastTodos.filter((t: any) => t.status === 'completed').length;
    const inProgress = lastTodos.find((t: any) => t.status === 'in_progress');
    
    return {
      id: 'standard_todos',
      tasks: lastTodos.map((t: any) => ({
        id: t.id,
        content: t.content,
        status: t.status
      })),
      total_tasks: total,
      completed_tasks: completed,
      current_task_id: inProgress?.id
    };
  }
  
  // 回退到旧版格式
  return lastTodoList;
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
        await continueWithToolResults(
          messages, 
          toolCalls, 
          updatedResults, 
          controller, 
          encoder, 
          messageId, 
          satoken, 
          model, 
          temperature, 
          max_tokens,
          buildTodoMemoryFromToolResults(updatedResults) || undefined,
          0 // 重置递归深度
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
  todoMemory?: string,
  currentDepth = 0
  // top_p?: number,
  // frequency_penalty?: number
) {
  const MAX_RECURSION_DEPTH = 30; // 防止无限递归
  
  if (currentDepth >= MAX_RECURSION_DEPTH) {
    console.warn('⚠️ 达到最大递归深度，强制结束');
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'warning',
      content: '任务执行达到最大轮次，已强制结束。',
      messageId
    })}\n\n`));
    
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'done',
      final_content: '',
      messageId
    })}\n\n`));
    return;
  }
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
                  type: 'function' as const,
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

      const newToolResults: any[] = await executeTools(validToolCalls, controller, encoder, messageId, satoken);

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
        max_tokens,
        buildTodoMemoryFromToolResults(newToolResults) || undefined,
        currentDepth + 1
        // top_p,
        // frequency_penalty
      );
      return;
    }

    // 🔑 关键修改：如果本轮没有工具调用，检查Todo完成度
    const todoReminderResult = await checkAndSendTodoReminder(
      fullMessages,
      toolResults,
      controller,
      encoder,
      messageId,
      satoken,
      model,
      temperature,
      max_tokens,
      currentDepth
    );
    
    if (todoReminderResult.sentReminder) {
      console.log('📝 已发送Todo完成提醒，等待AI响应...');
      return; // 提醒已发送，新的递归将在响应中处理
    }
    
    // 真正的结束条件：无工具调用 && 无未完成Todo
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'done',
      final_content: finalContent,
      messageId
    })}\n\n`));

    console.log('✅ 所有任务已完成，递归结束');
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

// 🆕 Todo提醒检查和API请求发送函数
async function checkAndSendTodoReminder(
  fullMessages: any[],
  toolResults: any[],
  controller: any,
  encoder: any,
  messageId: string,
  satoken?: string,
  model?: string,
  temperature?: number,
  max_tokens?: number,
  currentDepth = 0
): Promise<{ sentReminder: boolean; reason?: string }> {
  try {
    // 🔍 检查两套Todo系统的完成度
    const incompleteInfo = await analyzeIncompleteTodos(toolResults);
    
    if (!incompleteInfo.hasIncomplete) {
      console.log('✅ 所有Todo都已完成，无需提醒');
      return { sentReminder: false };
    }
    
    // 🔔 构造提醒消息
    const reminderMessage = buildTodoReminderMessage(incompleteInfo);
    
    // 📨 发送提醒API请求
    console.log('🔔 检测到未完成任务，发送提醒API请求:', incompleteInfo.summary);
    
    await sendTodoReminderApiRequest(
      fullMessages,
      reminderMessage,
      toolResults,
      controller,
      encoder,
      messageId,
      satoken,
      model,
      temperature,
      max_tokens,
      currentDepth + 1
    );
    
    return { 
      sentReminder: true, 
      reason: incompleteInfo.summary 
    };
    
  } catch (error) {
    console.error('❌ Todo提醒处理失败:', error);
    return { sentReminder: false };
  }
}

// 🔍 分析未完成Todo的统一函数
async function analyzeIncompleteTodos(toolResults: any[]): Promise<{
  hasIncomplete: boolean;
  summary?: string;
  details?: {
    standardTodos?: any[];
    legacyTodoList?: any;
    standardIncompleteCount?: number;
    legacyIncompleteCount?: number;
  };
}> {
  try {
    const details: any = {};
    const summaryParts: string[] = [];
    let hasAnyIncomplete = false;
    
    // 🆕 检查新版TodoWrite系统
    const latestStandardTodos = extractLatestStandardTodos(toolResults);
    if (latestStandardTodos && Array.isArray(latestStandardTodos) && latestStandardTodos.length > 0) {
      const incompleteTodos = latestStandardTodos.filter(todo => 
        todo && typeof todo === 'object' && todo.status !== 'completed'
      );
      if (incompleteTodos.length > 0) {
        hasAnyIncomplete = true;
        details.standardTodos = latestStandardTodos;
        details.standardIncompleteCount = incompleteTodos.length;
        summaryParts.push(`TodoWrite系统: ${incompleteTodos.length}个未完成`);
      }
    }
    
    // 🗂️ 检查旧版todo-list系统
    const latestLegacyTodo = extractLatestTodoList(toolResults);
    if (latestLegacyTodo && 
        typeof latestLegacyTodo.total_tasks === 'number' && 
        typeof latestLegacyTodo.completed_tasks === 'number') {
      const incompleteCount = latestLegacyTodo.total_tasks - latestLegacyTodo.completed_tasks;
      if (incompleteCount > 0) {
        hasAnyIncomplete = true;
        details.legacyTodoList = latestLegacyTodo;
        details.legacyIncompleteCount = incompleteCount;
        summaryParts.push(`todo-list系统: ${incompleteCount}个未完成`);
      }
    }
    
    return {
      hasIncomplete: hasAnyIncomplete,
      summary: summaryParts.length > 0 ? summaryParts.join('，') : undefined,
      details: hasAnyIncomplete ? details : undefined
    };
    
  } catch (error) {
    console.error('分析Todo完成度失败:', error);
    return { hasIncomplete: false };
  }
}

// 🆕 提取最新的StandardTodo数组
function extractLatestStandardTodos(toolResults: any[]): any[] | null {
  for (const result of [...toolResults].reverse()) {
    try {
      if (!result || !result.content) continue;
      
      const content = typeof result.content === 'string' ? 
        JSON.parse(result.content) : result.content;
      
      if (content && typeof content === 'object') {
        if (content.todo_update?.todos && Array.isArray(content.todo_update.todos)) {
          return content.todo_update.todos;
        } else if (content.todos && Array.isArray(content.todos)) {
          return content.todos;
        }
      }
    } catch {}
  }
  return null;
}

// 🔔 构造智能提醒消息
function buildTodoReminderMessage(incompleteInfo: any): string {
  const lines = [
    "🔍 任务完成度检查：",
    "",
    `检测到你还有未完成的任务（${incompleteInfo.summary || '未知数量'}）。`,
    "",
    "请检查以下情况：",
    "1. 如果这些任务确实已经完成，请立即调用相应的工具更新状态",
    "2. 如果还有步骤需要执行，请继续完成并更新状态", 
    "3. 如果任务不再需要，也请明确说明原因",
    "",
    "具体未完成的任务："
  ];
  
  // 🆕 列出StandardTodo系统的未完成任务
  if (incompleteInfo.details?.standardTodos && Array.isArray(incompleteInfo.details.standardTodos)) {
    const incompleteTodos = incompleteInfo.details.standardTodos.filter(
      (todo: any) => todo && typeof todo === 'object' && todo.status !== 'completed'
    );
    if (incompleteTodos.length > 0) {
      lines.push("", "📋 TodoWrite系统:");
      incompleteTodos.forEach((todo: any, index: number) => {
        const statusIcon = todo.status === 'in_progress' ? '🔄' : '⏸️';
        const content = todo.content || '未知任务';
        lines.push(`${index + 1}. ${statusIcon} ${content} (${todo.status || 'unknown'})`);
      });
    }
  }
  
  // 🗂️ 列出legacy系统的未完成任务  
  if (incompleteInfo.details?.legacyTodoList && 
      incompleteInfo.details.legacyTodoList.tasks && 
      Array.isArray(incompleteInfo.details.legacyTodoList.tasks)) {
    const todoList = incompleteInfo.details.legacyTodoList;
    const incompleteTasks = todoList.tasks.filter(
      (task: any) => task && typeof task === 'object' && task.status !== 'completed'
    );
    
    if (incompleteTasks.length > 0) {
      lines.push("", "📝 传统todo-list系统:");
      incompleteTasks.forEach((task: any, index: number) => {
        const statusIcon = task.status === 'in_progress' ? '🔄' : '⏸️';
        const content = task.content || '未知任务';
        lines.push(`${index + 1}. ${statusIcon} ${content} (${task.status || 'unknown'})`);
      });
    }
  }
  
  lines.push("", "请根据实际情况处理这些任务。");
  
  return lines.join('\n');
}

// 📨 发送提醒API请求
async function sendTodoReminderApiRequest(
  fullMessages: any[],
  reminderMessage: string,
  toolResults: any[],
  controller: any,
  encoder: any,
  messageId: string,
  satoken?: string,
  model?: string,
  temperature?: number,
  max_tokens?: number,
  nextDepth = 1
) {
  try {
    // 🔄 向用户显示正在发送提醒
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'system_instruction',
      content: '🔍 检测到未完成任务，正在提醒AI完成所有步骤...',
      messageId
    })}\n\n`));
    
    // 📝 构造包含提醒的新消息历史
    const reminderMessages: any[] = [
      ...fullMessages,
      ...toolResults.map((r: any) => ({
        role: 'tool' as const,
        tool_call_id: r.tool_call_id,
        content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
      })),
      {
        role: 'user' as const,
        content: reminderMessage
      }
    ];
    
    // 🎯 添加Todo记忆到系统消息
    const todoMemory = buildTodoMemoryFromToolResults(toolResults);
    let systemMessage = SYSTEM_PROMPT;
    if (todoMemory && typeof todoMemory === 'string') {
      systemMessage += `\n\n${todoMemory}`;
    }
    
    const requestMessages: any[] = [
      { role: 'system' as const, content: systemMessage },
      ...reminderMessages.slice(1) // 去掉原来的system消息
    ];
    
    // 🚀 发送API请求
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', { // 使用实际的API URL
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${satoken || process.env.MOONSHOT_API_KEY}`, // 使用实际的API密钥
      },
      body: JSON.stringify({
        model: model || 'kimi-k2-turbo-preview',
        messages: requestMessages,
        stream: true,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 4000,
        tools: await getToolDefinitions(), // 使用getToolDefinitions获取工具定义
        tool_choice: 'auto'
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    // 📖 处理流式响应 - 复用现有的流处理逻辑
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');
    
    let finalContent = '';
    const localToolCalls: ToolCall[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = new TextDecoder().decode(value);
      const lines = text.split('\n').filter(line => line.trim().startsWith('data: '));
      
      for (const line of lines) {
        if (line.includes('[DONE]')) continue;
        
        try {
          const data = JSON.parse(line.substring(6));
          const delta = data.choices?.[0]?.delta;
          
          if (delta?.content) {
            finalContent += delta.content;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'content',
              content: delta.content,
              messageId
            })}\n\n`));
          }
          
          // 处理工具调用
          if (delta?.tool_calls) {
            delta.tool_calls.forEach((toolCall: any) => {
              if (typeof toolCall.index === 'number') {
                const index = toolCall.index;
                
                while (localToolCalls.length <= index) {
                  localToolCalls.push({
                    id: `temp_${index}`,
                    type: 'function' as const,
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
          console.error('解析提醒响应错误:', e);
        }
      }
    }
    
    // 🔄 如果有新的工具调用，继续递归
    const validToolCalls: ToolCall[] = localToolCalls.filter(tc => 
      tc.function.name && tc.function.arguments && !tc.id.startsWith('temp_')
    );
    
    if (validToolCalls.length > 0) {
      console.log('🛠️ 提醒响应中包含工具调用，继续执行...');
      
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'tool_execution',
        tool_calls: validToolCalls,
        messageId
      })}\n\n`));
      
      const newToolResults: any[] = await executeTools(validToolCalls, controller, encoder, messageId, satoken);
      
      // 🔄 继续递归（这里会重新检查Todo完成度）
      await continueWithToolResults(
        reminderMessages,
        validToolCalls,
        newToolResults,
        controller,
        encoder,
        messageId,
        satoken,
        model,
        temperature,
        max_tokens,
        buildTodoMemoryFromToolResults(newToolResults) || undefined,
        nextDepth
      );
    } else {
      // 📝 提醒后仍无工具调用，结束递归
      console.log('💭 AI收到提醒后未调用工具，可能认为任务已完成');
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'done',
        final_content: finalContent,
        messageId
      })}\n\n`));
      controller.close();
    }
    
  } catch (error) {
    console.error('❌ 发送Todo提醒失败:', error);
    // 失败时直接结束，避免无限递归
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'error',
      error: '任务提醒发送失败',
      messageId
    })}\n\n`));
    controller.close();
  }
}