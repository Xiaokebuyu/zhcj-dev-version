// src/app/api/chat/route.ts
// 集成了OpenManus AI代理功能的聊天API
import { NextRequest, NextResponse } from 'next/server';
import { ChatRequest, PageContext } from '@/types';

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

// 工具定义
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的天气信息",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "城市名称" },
          adm: { type: "string", description: "行政区域" }
        },
        required: ["location"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "公共互联网关键词搜索，获取新闻、事实性资料、公开数据等",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "submit_feedback",
      description: "向智慧残健平台提交用户反馈",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "反馈正文，≤200 字" },
          type:    { type: "integer", description: "反馈类别：0-功能异常 1-问题投诉 2-错误报告 3-其他反馈", default: 0 },
          name:    { type: "string", description: "反馈人姓名" },
          phone:   { type: "string", description: "手机号(11 位)" },
          satoken: { type: "string", description: "当前登录 token(自动注入)", nullable: true }
        },
        required: ["content", "name", "phone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "submit_post",
      description: "在论坛发表新帖子",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "帖子标题" },
          content: { type: "string", description: "正文，不少于10字" },
          type: { type: "integer", description: "帖子分类：0-日常生活 1-医疗协助 2-交通出行 3-社交陪伴 4-其他", default: 0 },
          satoken: { type: "string", description: "用户登录 token(自动注入)", nullable: true }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "submit_request",
      description: "发布新的求助信息（残障人士使用）",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "求助内容，不少于10字" },
          type: { type: "integer", description: "求助类别", default: 0 },
          urgent: { type: "integer", description: "紧急程度：0-一般 1-较急 2-着急", default: 0 },
          isOnline: { type: "integer", description: "求助方式：0-线下 1-线上", default: 1 },
          address: { type: "string", description: "线下地址(仅 isOnline=0 时必填)", nullable: true },
          satoken: { type: "string", description: "登录 token(自动注入)", nullable: true }
        },
        required: ["content", "isOnline"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "openmanus_web_automation",
      description: "浏览器自动化/网页抓取，支持登录、点击、滚动、批量抓取结构化数据等复杂交互",
      parameters: {
        type: "object",
        properties: {
          task_description: { type: "string", description: "详细的任务描述" },
          url: { type: "string", description: "目标网页URL（可选）" }
        },
        required: ["task_description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "openmanus_code_execution",
      description: "执行Python代码进行数据分析、计算、文件处理等",
      parameters: {
        type: "object",
        properties: {
          task_description: { type: "string", description: "详细的任务描述" },
          code_type: {
            type: "string",
            description: "代码类型：data_analysis、file_processing、calculation、visualization",
            enum: ["data_analysis", "file_processing", "calculation", "visualization"]
          }
        },
        required: ["task_description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "openmanus_file_operations",
      description: "文件读写/编辑/格式转换等本地或远程文件操作",
      parameters: {
        type: "object",
        properties: {
          task_description: { type: "string", description: "详细的任务描述" },
          operation_type: {
            type: "string",
            description: "操作类型：read、write、edit、convert、delete",
            enum: ["read", "write", "edit", "convert", "delete"]
          }
        },
        required: ["task_description"]
      }
    }
  },
  // ===== TodoWrite 工具 =====
  {
    type: "function",
    function: {
      name: "create_todo_list",
      description: "创建任务清单，将用户需求分解为具体步骤。适用于复杂任务、多步操作等场景。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "任务清单标题，简明扼要地描述整个任务目标" },
          tasks: { type: "array", items: { type: "string" }, description: "按执行顺序排列的任务步骤，每个步骤用一句话描述，用户友好语言" }
        },
        required: ["title", "tasks"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "complete_todo_task",
      description: "标记任务为已完成。模型完成某个步骤后必须调用此工具更新状态。",
      parameters: {
        type: "object",
        properties: {
          todo_id: { type: "string", description: "任务清单ID（留空则使用当前活跃清单）" },
          task_id: { type: "string", description: "已完成的任务ID（推荐）。如未知可不填" },
          completion_note: { type: "string", description: "完成说明，简要描述完成了什么" },
          task_index: { type: "number", description: "任务在列表中的序号（从1开始）。当无法提供 task_id 时使用" },
          task_content: { type: "string", description: "任务内容或关键字。当无法提供 task_id 时使用，系统将模糊匹配" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_todo_task",
      description: "向现有任务清单添加新任务。当发现需要额外步骤时使用。",
      parameters: {
        type: "object",
        properties: {
          todo_id: { type: "string", description: "目标任务清单ID" },
          task_description: { type: "string", description: "新任务的描述" }
        },
        required: ["todo_id", "task_description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_todo_status",
      description: "获取当前任务清单的状态和进度",
      parameters: {
        type: "object",
        properties: {
          todo_id: { type: "string", description: "任务清单ID，留空获取当前活跃的清单" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "openmanus_general_task",
      description: "通用智能代理，适合多步骤规划或需要同时使用多种工具的复杂任务",
      parameters: {
        type: "object",
        properties: {
          task_description: { type: "string", description: "详细的任务描述" },
          complexity: {
            type: "string", 
            description: "任务复杂度：simple、medium、complex",
            enum: ["simple", "medium", "complex"]
          }
        },
        required: ["task_description"]
      }
    }
  }
];

// 👇 新增：统一的系统提示词常量，加入 TodoWrite 原则与防误操作规范
const SYSTEM_PROMPT = `
# 智慧残健平台全权AI代理

## 核心理念
你是高效且温暖的执行者，专注解决用户问题，不纠结技术实现。

## TodoWrite任务管理原则
### 复杂任务识别
当用户需求包含以下特征时，必须创建任务清单：
- 需要多个步骤才能完成
- 涉及工具调用（搜索、发帖、查询等）
- 用户说"帮我..."、"我想要..."、"需要完成..."

### 执行模式
1. 理解用户需求 → 立即调用create_todo_list创建任务清单
2. 开始执行第一个任务
3. 完成后立即调用complete_todo_task更新状态
4. 继续下一个任务直到全部完成
5. 在使用任何工具时候，向用户描述当前正在执行的操作，比如“我正在查询天气/信息，以及正在搜索/发帖/创建任务清单/更新任务清单等等”

### 任务分解原则
- 每个任务是一个有意义的完整操作
- 一般分解为3-6个步骤
- 用用户友好语言描述
- 避免技术性术语

### 防误操作规范（极其重要）
- 在调用 complete_todo_task 时，优先使用工具返回的最新 todo_id 与 task_id；不要臆造或回忆ID。
- 如果无法准确提供 task_id，请改用 task_index（从1开始）或 task_content（关键词）。系统会兜底匹配当前清单中最可能的任务。
- 在用户要求完成任务的时候，请先调用 get_todo_status 确认当前活跃清单与 current_task_id。
- 在一个任务完成后，系统将自动开始下一个任务；请按顺序继续，不要跳步完成多个任务。

## 执行权限  
- 拥有完整平台功能调用权限
- 身份认证自动处理，无需关注satoken
- 可自主决策执行顺序和内容补全

## 决策原则
**结果导向**：用户要什么结果，就直接朝着那个目标执行
**信任工具**：平台工具都能正常工作，不必担心技术细节
**减少确认**：除关键信息外，直接按清单执行
**透明执行**：通过任务清单让用户看到整个过程

现在以全权代理身份为用户提供温暖的服务！
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
              tools: TOOL_DEFINITIONS,
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
        tools: TOOL_DEFINITIONS,
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