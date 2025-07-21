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

// 👇 新增：统一的系统提示词常量，确保每次调用 DeepSeek 都能携带相同的系统级约束
const SYSTEM_PROMPT = `【快速助残AI - 极速执行模式 V2.1】

你是智慧残健平台的高效AI助手，拥有最大执行权限。核心使命：速度第一，立即行动，精准多步解决。

【关键技术要求】
⚠️ 重要：工具只能在最终回复中调用，思考过程中无法执行工具。
⚠️ 必须使用函数调用格式：tool_calls 数组。
⚠️ 思考结束后，在正式回复中立即调用所需函数工具。

【执行原则】
- **立即行动**：收到需求立刻在回复中调用工具执行。
- **多步规划**：对于复杂任务，主动拆解成多个步骤，并通过连续、多次的工具调用来顺序执行。**你的思考过程必须清晰地体现出“先做什么，后做什么”的逻辑。**
- **智能判断**：根据用户意图智能判断是否需要调用工具，如果不需要则直接回复。
- **智能补全**：根据用户意图自动补充所有必要信息。
- **速度优先**：快速决策，直接调用函数执行，无需二次确认。

【函数工具调用要求】
- **单步与多步**：简单任务单次调用，复杂任务（如需要先搜索再提交）则必须按顺序连续多次调用。
- **思考过程**：规划要调用的函数序列及参数。**必须明确说明每一步的目的和依赖关系**，例如：“第一步：使用 \`web_search\` 搜索天气信息。第二步：使用 \`submit_post\` 将搜索到的天气信息发布成帖子。”
- **正式回复**：在思考结束后，**一次只调用序列中的一个工具**。你将在下一轮得到该工具的结果，然后才能调用序列中的下一个工具。
- **禁止模拟**：禁止在思考中模拟工具调用，只在回复中真实调用。

【顺序调用范例：发布天气预报帖子】
用户需求：“帮我查一下北京明天的天气，然后发个帖子告诉大家。”
你的思考过程：
1.  **规划**：这是一个两步任务。
    -   **第一步**：需要调用 \`get_weather\` 工具，获取北京的天气信息。
    -   **第二步**：需要调用 \`submit_post\` 工具，将第一步获取到的天气信息作为内容发布出去。
2.  **执行第一步**：我将先调用 \`get_weather(location='北京')\`。
(在此处结束思考，并在回复中调用 \`get_weather\` 工具)
---
(接收到 \`get_weather\` 的结果后，进入下一轮)
---
你的思考过程：
1.  **回顾**：我已经获取了天气信息：“明天晴，25度”。
2.  **执行第二步**：现在我将调用 \`submit_post\` 工具来发布帖子。
(在此处结束思考，并在回复中调用 \`submit_post\` 工具)

【自主决策权限】
✅ 自动判断并补全反馈类型、板块分类、紧急程度。
✅ 根据上下文推测用户姓名、联系方式。
✅ 智能选择线上/线下求助方式。
✅ 自动生成标题、优化内容格式。

【智能补全规则】
- **姓名缺失** → 使用"用户"、"求助者"等通用称呼。
- **电话缺失** → 使用"平台客服电话"作为联系方式。
- **地址模糊** → 根据描述推测大概区域。
- **分类不明** → 选择最可能的默认选项。
- **紧急程度** → 根据语气词汇自动判断。

【极速执行流程】
1. **分析拆解**：分析需求，将其拆解为逻辑上连续的工具调用步骤（Step 1, Step 2, ...）。
2. **执行首个步骤**：在回复中调用第一个步骤（Step 1）的函数工具。
3. **循环执行**：接收到上一步的工具执行结果后，思考并执行下一个步骤的工具，直到所有步骤完成。
4. **最终回复**：所有工具步骤执行完毕后，整合所有结果，向用户提供最终的、完整的答案。
5. **简短说明**：在每次调用工具时，简要告知用户正在执行的操作（例如：“正在查询天气...”、“正在为您发布帖子...”）。

【工具限制】
- 禁用openmanus系列。
- 必须在回复阶段使用函数工具，思考阶段不能执行。

【思考时间：≤2秒】
【响应模式：思考 → 工具调用1 → (接收结果并思考) → 工具调用2 → ... → 最终回复】

记住：严格遵循“规划-执行-接收结果-再执行”的顺序调用模式！现在进入极速模式，收到需求立即行动。`;

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
      model = 'deepseek-reasoner', 
      temperature = 0.7, 
      max_tokens = 2048,
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
    if (!process.env.DEEPSEEK_API_KEY) {
      console.error('❌ DeepSeek API 密钥未配置');
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
          console.log('📤 发送DeepSeek请求（第一阶段 - 推理和工具调用）');
          
          // 第一阶段：DeepSeek推理，可能包含工具调用
          const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
      model,
      messages: [systemMessage, ...processedMessages],
      temperature,
      max_tokens,
              stream: true,
              tools: TOOL_DEFINITIONS,
              tool_choice: 'auto'
            })
          });

          if (!response.ok) {
            throw new Error(`DeepSeek API错误: ${response.status}`);
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
                monitorPendingTasks(pendingOpenManusTasks, processedMessages, validToolCalls, toolResults, controller, encoder, messageId, satoken);
                keepOpen = true; // 标记保持流式连接
                return; // 暂停，等待任务完成
              }

              // 第三阶段：将工具结果发回DeepSeek继续推理
              await continueWithToolResults(processedMessages, validToolCalls, toolResults, controller, encoder, messageId, satoken);
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

// 🔑 监控pending任务
async function monitorPendingTasks(
  taskIds: string[], 
  messages: any[], 
  toolCalls: ToolCall[], 
  toolResults: any[],
  controller: any, 
  encoder: any, 
  messageId: string,
  satoken?: string
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
        console.log('🎉 所有OpenManus任务完成，继续DeepSeek推理');
        
        // 继续DeepSeek推理
        await continueWithToolResults(messages, toolCalls, updatedResults, controller, encoder, messageId, satoken);
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

// 🔑 带工具结果继续DeepSeek推理
async function continueWithToolResults(
  messages: any[], 
  toolCalls: ToolCall[], 
  toolResults: any[],
  controller: any, 
  encoder: any, 
  messageId: string,
  satoken?: string
) {
      try {
    console.log('🔄 使用工具结果继续DeepSeek推理');
    
    // 构建完整的消息历史（确保始终包含系统提示词）
    const baseMessages = (messages.length > 0 && messages[0].role === 'system')
      ? messages
      : [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    const fullMessages = [
      ...baseMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: toolCalls
      },
      ...toolResults
    ];
    
    // 调用DeepSeek继续推理
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages: fullMessages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto'
      })
    });
    
    if (!response.ok) {
      throw new Error(`DeepSeek API错误: ${response.status}`);
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

        await monitorPendingTasks(pendingOpenManusTasks, fullMessages, validToolCalls, newToolResults, controller, encoder, messageId, satoken);
        return; // monitorPendingTasks 内部会在完成后继续递归
      }

      // 递归进入下一阶段
      await continueWithToolResults(fullMessages, validToolCalls, newToolResults, controller, encoder, messageId, satoken);
      return;
    }

    // 若无更多工具调用，则发送完成信号
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'done',
      final_content: finalContent,
      messageId
    })}\n\n`));

    console.log('✅ DeepSeek推理完成');

    controller.close();
  } catch (error) {
    console.error('❌ 续写DeepSeek推理失败:', error);
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
    supportedModels: ['deepseek-reasoner'],
    features: ['工具调用', '流式响应', 'OpenManus集成']
  });
}