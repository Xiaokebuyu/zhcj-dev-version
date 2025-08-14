// src/utils/toolManager.ts
// 集成了OpenManus AI代理功能的工具管理器

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
  
  // 优化后的工具定义
  export const toolDefinitions = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "获取指定城市的详细天气信息，包括实时天气、空气质量、天气指数等",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "城市名称" },
            adm: { type: "string", description: "行政区域，用于区分重名城市" }
          },
          required: ["location"]
        }
      }
    },
    // ===== 标准 TodoWrite 工具 =====
    {
      type: "function",
      function: {
        name: "TodoWrite",
        description: "使用此工具创建和管理任务清单，用于复杂任务、多步操作等场景。将用户需求分解为具体步骤，并跟踪进度。",
        parameters: {
          type: "object",
          properties: {
            todos: {
              type: "array",
              description: "更新后的完整任务列表",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "任务唯一标识符" },
                  content: { type: "string", description: "任务内容描述，用用户友好的语言" },
                  status: { 
                    type: "string", 
                    enum: ["pending", "in_progress", "completed"],
                    description: "任务状态：pending（待执行）、in_progress（进行中）、completed（已完成）"
                  }
                },
                required: ["id", "content", "status"]
              }
            }
          },
          required: ["todos"]
        }
      }
    },
    // ===== 旧版 TodoWrite 工具（向后兼容）=====
    {
      type: "function",
      function: {
        name: "create_todo_list",
        description: "[已弃用，请使用TodoWrite] 创建任务清单，将用户需求分解为具体步骤。适用于复杂任务、多步操作等场景。",
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
        description: "[已弃用，请使用TodoWrite] 标记任务为已完成。模型完成某个步骤后必须调用此工具更新状态。",
        parameters: {
          type: "object",
          properties: {
            todo_id: { type: "string", description: "任务清单ID" },
            task_id: { type: "string", description: "已完成的任务ID" },
            completion_note: { type: "string", description: "完成说明，简要描述完成了什么" },
            // 兼容增强：如果无法准确提供 task_id，可提供 task_index 或 task_content，由系统兜底匹配
            task_index: { type: "number", description: "任务在列表中的序号（从1开始）。与 task_id 二选一" },
            task_content: { type: "string", description: "任务内容（或其关键字），系统将进行模糊匹配。与 task_id 二选一" }
          },
          required: ["todo_id", "task_id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "add_todo_task",
        description: "[已弃用，请使用TodoWrite] 向现有任务清单添加新任务。当发现需要额外步骤时使用。",
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
        description: "[已弃用，请使用TodoWrite] 获取当前任务清单的状态和进度",
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
        name: "web_search",
        description: "公共互联网关键词搜索，获取新闻、事实性资料、公开数据等",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            count: { type: "number", description: "返回结果数量，默认8条", default: 8 }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "submit_feedback",
        description: "向智慧残健平台提交用户反馈意见。适用于用户对平台功能、服务质量的建议或投诉",
        parameters: {
          type: "object",
          properties: {
            content: { 
              type: "string", 
              description: "反馈内容，至少10字，详细描述问题或建议" 
            },
            type: { 
              type: "integer", 
              description: "反馈类型：0-功能建议 1-问题投诉 2-错误报告 3-其他反馈", 
              default: 0 
            },
            name: { 
              type: "string", 
              description: "用户真实姓名，用于后续联系" 
            },
            phone: { 
              type: "string", 
              description: "11位手机号，格式：1开头的11位数字" 
            },
            satoken: { 
              type: "string", 
              description: "用户登录凭证(自动注入)", 
              nullable: true 
            }
          },
          required: ["content", "name", "phone"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "submit_post",
        description: "在互助论坛发表新帖子。适用于残障人士分享经验、寻求建议、交流心得",
        parameters: {
          type: "object",
          properties: {
            title: { 
              type: "string", 
              description: "帖子标题，简洁明确地概括主题" 
            },
            content: { 
              type: "string", 
              description: "帖子正文，至少10字，详细描述分享内容或问题" 
            },
            type: { 
              type: "integer", 
              description: "讨论板块：0-生活帮助 1-教育支持 2-辅助科技 3-医疗康复 4-就业创业 5-心理支持", 
              default: 0 
            },
            satoken: { 
              type: "string", 
              description: "用户登录凭证(自动注入)", 
              nullable: true 
            }
          },
          required: ["title", "content"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "submit_request",
        description: "发布新的求助信息。残障人士可通过此功能寻求志愿者的线上或线下帮助",
        parameters: {
          type: "object",
          properties: {
            content: { 
              type: "string", 
              description: "求助内容，至少10字，详细描述需要的帮助和联系方式" 
            },
            type: { 
              type: "integer", 
              description: "求助类别：0-日常生活 1-医疗协助 2-交通出行 3-社交陪伴 4-其他", 
              default: 0 
            },
            urgent: { 
              type: "integer", 
              description: "紧急程度：0-普通 1-较急 2-紧急", 
              default: 0 
            },
            isOnline: { 
              type: "integer", 
              description: "求助方式：0=线下(志愿者上门) 1=线上(远程协助)，必须明确指定", 
              default: 1 
            },
            address: { 
              type: "string", 
              description: "详细地址(仅线下求助时必填)，格式：省市区+详细地址", 
              nullable: true 
            },
            satoken: { 
              type: "string", 
              description: "用户登录凭证(自动注入)", 
              nullable: true 
            }
          },
          required: ["content", "isOnline"]
        }
      }
    },

    // OpenManus工具定义
    {
      type: "function",
      function: {
        name: "openmanus_web_automation",
        description: "基于浏览器的自动化与爬取工具，可在目标网页上执行点击、输入、滚动、抓取结构化数据、下载文件、登录等复杂交互。用于【需要模拟用户操作或批量抓取/填报】的任务，而不仅仅是简单搜索。",
        parameters: {
          type: "object",
          properties: {
            task_description: {
              type: "string",
              description: "详细的任务描述，例如：抓取某网站的产品信息、自动填写表单、下载文件等"
            },
            url: {
              type: "string",
              description: "目标网页URL（可选）"
            }
          },
          required: ["task_description"]
        }
      }
    },

    {
      type: "function",
      function: {
        name: "openmanus_code_execution",
        description: "执行Python代码进行数据分析、计算、文件处理等。适用于需要编程解决的复杂任务",
        parameters: {
          type: "object",
          properties: {
            task_description: {
              type: "string",
              description: "详细的任务描述，例如：分析CSV数据、生成图表、数据处理、算法实现等"
            },
            code_type: {
              type: "string",
              description: "代码类型：data_analysis（数据分析）、file_processing（文件处理）、calculation（计算）、visualization（可视化）",
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
        description: "文件操作，包括文件读写、编辑、格式转换等。适用于需要处理文件的任务",
        parameters: {
          type: "object",
          properties: {
            task_description: {
              type: "string",
              description: "详细的任务描述，例如：编辑配置文件、转换文件格式、批量重命名等"
            },
            operation_type: {
              type: "string",
              description: "操作类型：read（读取）、write（写入）、edit（编辑）、convert（转换）",
              enum: ["read", "write", "edit", "convert"]
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
        description: "OpenManus 通用代理，适合无法通过以上专用工具完成，或需要多步骤规划/决策/混合操作（代码+网页+文件）的复合型任务。",
        parameters: {
          type: "object",
          properties: {
            task_description: {
              type: "string",
              description: "详细的任务描述，OpenManus将自动分析并执行"
            },
            complexity: {
              type: "string",
              description: "任务复杂度：simple（简单）、medium（中等）、complex（复杂）",
              enum: ["simple", "medium", "complex"]
            }
          },
          required: ["task_description"]
        }
      }
    }
  ];
  
  // 天气API响应类型定义
  interface GeoLocation {
    name: string;
    id: string;
    lat: string;
    lon: string;
    adm1: string;
    adm2: string;
    country: string;
    rank: string;
  }
  
  interface WeatherNow {
    obsTime: string;
    temp: string;
    feelsLike: string;
    text: string;
    wind360: string;
    windDir: string;
    windScale: string;
    windSpeed: string;
    humidity: string;
    precip: string;
    pressure: string;
    vis: string;
    cloud: string;
    dew: string;
  }
  
  interface AirQuality {
    pubTime: string;
    aqi: string;
    level: string;
    category: string;
    primary: string;
    pm10: string;
    pm2p5: string;
    no2: string;
    so2: string;
    co: string;
    o3: string;
  }
  
  interface WeatherIndex {
    date: string;
    type: string;
    name: string;
    level: string;
    category: string;
    text: string;
  }
  
  // OpenManus任务类型定义
  export interface OpenManusTaskRequest {
    task_description: string;
    agent_type?: string;
    tools?: string[];
    context?: Record<string, unknown>;
    max_steps?: number;
  }

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

  // 工具执行器
  export class ToolExecutor {
    private static readonly QWEATHER_TOKEN = process.env.QWEATHER_API_KEY;
    private static readonly OPENMANUS_API_URL = 'http://127.0.0.1:8001';
    
    // ✅ 简化：直接使用生产环境地址
    private static readonly API_BASE = 'https://zhcj.cloud/api';

    // ✅ 创建标准化的请求头
    private static createHeaders(satoken: string): Record<string, string> {
      return {
        "Content-Type": "application/json",
        "ada_token": satoken,
        "satoken": satoken,
        "Authorization": `Bearer ${satoken}`,
        "Cookie": `ada_token=${satoken}`
      };
    }
    
    // ✅ 统一认证处理方法
    private static injectAuthToken(toolArgs: any, pageContext?: import('@/types').PageContext): any {
      const authToken = pageContext?.auth?.satoken;
      
      if (!authToken) {
        console.error('❌ 认证失败：未找到satoken');
        throw new Error('用户未登录或认证信息已过期，请重新登录');
      }
      
      console.log(`✅ 认证信息已注入，token长度: ${authToken.length}`);
      return { ...toolArgs, satoken: authToken };
    }
    
    // ✅ 添加认证调试功能
    private static debugAuthInfo(pageContext?: import('@/types').PageContext) {
      console.log('🔍 认证调试信息:');
      console.log('- pageContext存在:', !!pageContext);
      console.log('- pageContext.auth存在:', !!pageContext?.auth);
      console.log('- pageContext.auth.satoken:', pageContext?.auth?.satoken ? '已获取' : '未获取');
      
      if (pageContext?.auth?.satoken) {
        console.log('- satoken长度:', pageContext.auth.satoken.length);
        console.log('- satoken前10位:', pageContext.auth.satoken.substring(0, 10) + '...');
      }
      
      // 尝试直接从Cookie获取（如果在浏览器环境）
      if (typeof document !== 'undefined') {
        const directSaToken = document.cookie
          .split('; ')
          .find(c => c.startsWith('satoken='))?.split('=')[1];
        const directAdaToken = document.cookie
          .split('; ')
          .find(c => c.startsWith('ada_token='))?.split('=')[1];
        console.log('- 直接从Cookie获取satoken:', directSaToken ? '已获取' : '未获取');
        console.log('- 直接从Cookie获取ada_token:', directAdaToken ? '已获取' : '未获取');
        
        // 显示所有cookies用于调试
        console.log('- 所有Cookies:', document.cookie);
      }
    }

    // ✅ 添加回退token提取方法
    private static extractFallbackToken(): string | null {
      try {
        // 尝试从当前环境的Cookie直接提取
        if (typeof document !== 'undefined') {
          // 优先读取 Sa-Token 默认 cookie("satoken")
          let token = document.cookie
            .split('; ')
            .find(c => c.startsWith('satoken='))?.split('=')[1];

          // 回退：尝试旧版 "ada_token"
          if (!token) {
            token = document.cookie
              .split('; ')
              .find(c => c.startsWith('ada_token='))?.split('=')[1];
          }

          return token || null;
        }
        return null;
      } catch (error) {
        console.warn('回退认证提取失败:', error);
        return null;
      }
    }

    private static async submitFeedback(argsStr: string): Promise<object> {
      const { content, type = 0, name, phone, satoken } = JSON.parse(argsStr);
      
      if (!content?.trim()) throw new Error("反馈内容不能为空");
      if (!satoken) throw new Error("用户未登录，缺少认证信息");

      console.log('🔑 submitFeedback - 认证信息:', {
        hasToken: !!satoken,
        tokenLength: satoken?.length,
        tokenPrefix: satoken?.substring(0, 10) + '...'
      });

      const headers = this.createHeaders(satoken);

      let finalName = name, finalPhone = phone;
      if (!name || !phone) {
        try {
          console.log('📡 获取用户信息 - API地址:', `${this.API_BASE}/user/current`);
          const r = await fetch(`${this.API_BASE}/user/current`, {
            method: 'GET',
            headers: headers,
            // ✅ 在服务端环境中不要使用credentials: 'include'
          });
          
          console.log('📡 获取用户信息 - 响应状态:', r.status);
          
          if (r.ok) {
            const j = await r.json();
            console.log('📡 获取用户信息 - 响应数据:', j);
            if (j.code === 200) {
              finalName = finalName ?? j.data.uName;
              finalPhone = finalPhone ?? j.data.uPhone;
            }
          } else {
            console.warn('获取用户信息失败 - HTTP状态:', r.status, r.statusText);
          }
        } catch (error) {
          console.warn('获取用户信息异常:', error);
        }
      }

      const body = JSON.stringify({ content, type, name: finalName, phone: finalPhone });
      
      console.log('📡 提交反馈 - API地址:', `${this.API_BASE}/Feedback/submit`);
      console.log('📡 提交反馈 - 请求头:', headers);
      console.log('📡 提交反馈 - 请求体:', body);
      
      const res = await fetch(`${this.API_BASE}/Feedback/submit`, {
        method: "POST",
        headers: headers,
        body: body,
        // ✅ 服务端环境不使用credentials
      });
      
      console.log('📡 提交反馈 - 响应状态:', res.status);
      
      const data = await res.json();
      console.log('📡 提交反馈 - 响应数据:', data);
      
      return { success: data.code === 200, ...data };
    }

    private static async submitPost(argsStr: string): Promise<object> {
      const { title, content, type = 0, satoken } = JSON.parse(argsStr);

      if (!satoken) throw new Error("未登录，缺少认证信息");
      if (!title || !content) throw new Error("标题和内容不能为空");
      if (content.length < 10) throw new Error("帖子内容不少于10字");

      const headers = this.createHeaders(satoken);
      const body = JSON.stringify({ ftype: Number(type), ftitle: title, fcontent: content });
      
      console.log('📡 发帖 - 请求信息:', { apiBase: this.API_BASE, headers, body: body.substring(0, 100) + '...' });
      
      const res = await fetch(`${this.API_BASE}/forum/publish`, {
        method: 'POST',
        headers: headers,
        body: body,
      });
      
      const data = await res.json();
      console.log('📡 发帖 - 响应:', { status: res.status, data });
      
      return { success: data.code === 200, ...data };
    }

    private static async submitRequest(argsStr: string): Promise<object> {
      const { content, type = 0, urgent = 0, isOnline = 1, address, satoken } = JSON.parse(argsStr);

      // 参数校验
      if (!satoken) throw new Error("未登录，缺少认证信息");
      if (!content?.trim()) throw new Error("求助内容不能为空");
      if (content.length < 10) throw new Error("求助内容不少于10字");
      
      // ✅ 关键修复：确保 isOnline 是数字类型并转换为整数
      const onlineStatus = parseInt(String(isOnline));
      if (onlineStatus !== 0 && onlineStatus !== 1) {
        throw new Error("求助方式参数错误，请指定 0（线下）或 1（线上）");
      }
      
      // ✅ 线下求助地址验证
      if (onlineStatus === 0 && !address?.trim()) {
        throw new Error("线下求助必须填写地址");
      }

      const headers = this.createHeaders(satoken);
      
      // ✅ 关键修复：按照 DisabledPlatform.vue 的成功格式构建请求体
      // 使用小写字段名，与前端 Vue 保持一致
      const body = JSON.stringify({
        rtype: parseInt(String(type)),      // 确保是整数
        rcontent: content.trim(),           // 去除首尾空白
        rurgent: parseInt(String(urgent)),  // 确保是整数
        raddress: address?.trim() || '',    // 地址处理
        risOnline: onlineStatus             // ✅ 使用小写 risOnline，与 Vue 一致
      });
      
      console.log('📡 求助发布 - 请求信息:', { 
        apiBase: this.API_BASE, 
        headers, 
        bodyData: JSON.parse(body) // 显示解析后的数据便于调试
      });
      
      const res = await fetch(`${this.API_BASE}/request/publish`, {
        method: 'POST',
        headers: headers,
        body: body,
      });
      
      const data = await res.json();
      console.log('📡 求助发布 - 响应:', { status: res.status, data });
      
      // ✅ 增强错误处理
      if (data.code === 200) {
        return { 
          success: true, 
          message: '求助发布成功',
          data: data.data,
          ...data 
        };
      } else {
        console.error('❌ 求助发布失败:', data);
        return { 
          success: false, 
          error: data.msg || data.message || '发布失败',
          code: data.code,
          ...data 
        };
      }
    }
    
    // ✅ 增强executeTools方法 - 统一认证处理
    static async executeTools(toolCalls: ToolCall[], pageContext?: import('@/types').PageContext): Promise<ToolResult[]> {
      // 添加详细的调试信息
      console.log('🔧 开始执行工具，认证信息检查:');
      console.log('- toolCalls数量:', toolCalls.length);
      this.debugAuthInfo(pageContext);
      
      const results: ToolResult[] = [];
      
      for (const toolCall of toolCalls) {
        try {
          let result: object;
          
          switch (toolCall.function.name) {
            // ===== 标准 TodoWrite 工具 =====
            case 'TodoWrite':
              result = await this.executeTodoWrite(toolCall.function.arguments);
              break;
            // ===== 旧版 TodoWrite 执行分支（向后兼容）=====
            case 'create_todo_list':
              result = await this.createTodoList(toolCall.function.arguments);
              break;
            case 'complete_todo_task':
              result = await this.completeTodoTask(toolCall.function.arguments);
              break;
            case 'add_todo_task':
              result = await this.addTodoTask(toolCall.function.arguments);
              break;
            case 'get_todo_status':
              result = await this.getTodoStatus(toolCall.function.arguments);
              break;
            case 'get_weather':
              result = await this.getWeather(toolCall.function.arguments);
              break;
            case 'web_search':
              result = await this.executeWebSearchTool(toolCall.function.arguments);
              break;
            case 'submit_feedback':
            case 'submit_post':
            case 'submit_request':
              // ✅ 统一的认证处理逻辑
              try {
                let toolArgs = JSON.parse(toolCall.function.arguments);
                
                // 优先从pageContext获取认证信息
                if (pageContext?.auth?.satoken) {
                  toolArgs = this.injectAuthToken(toolArgs, pageContext);
                } 
                // 回退：尝试直接从环境获取
                else {
                  const fallbackToken = this.extractFallbackToken();
                  if (fallbackToken) {
                    toolArgs.satoken = fallbackToken;
                    console.warn('⚠️ 使用回退认证token');
                  } else {
                    throw new Error('无法获取认证信息，请确保用户已登录');
                  }
                }
                
                console.log(`✅ 工具 ${toolCall.function.name} 认证信息已注入`);
                
                // 执行对应的工具方法
                switch (toolCall.function.name) {
                  case 'submit_feedback':
                    result = await this.submitFeedback(JSON.stringify(toolArgs));
                    break;
                  case 'submit_post':
                    result = await this.submitPost(JSON.stringify(toolArgs));
                    break;
                  case 'submit_request':
                    result = await this.submitRequest(JSON.stringify(toolArgs));
                    break;
                }
                
              } catch (authError) {
                console.error(`❌ 工具 ${toolCall.function.name} 认证失败:`, authError);
                result = {
                  error: `认证失败: ${authError instanceof Error ? authError.message : '未知认证错误'}`,
                  suggestion: '请刷新页面重新登录，确保已正确登录后再试',
                  success: false,
                  toolName: toolCall.function.name
                };
              }
              break;
            case 'openmanus_web_automation':
              result = await this.createOpenManusTask(toolCall.function.arguments, 'web_automation');
              break;
            case 'openmanus_code_execution':
              result = await this.createOpenManusTask(toolCall.function.arguments, 'code_execution');
              break;
            case 'openmanus_file_operations':
              result = await this.createOpenManusTask(toolCall.function.arguments, 'file_operations');
              break;
            case 'openmanus_general_task':
              result = await this.createOpenManusTask(toolCall.function.arguments, 'general');
              break;
            default:
              throw new Error(`未知工具: ${toolCall.function.name}`);
          }
          
          results.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify(result)
          });
          
        } catch (error) {
          console.error(`工具执行失败 ${toolCall.function.name}:`, error);
          results.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify({
              error: error instanceof Error ? error.message : '未知错误',
              toolName: toolCall.function.name,
              success: false
            })
          });
        }
      }
      
      console.log(`✅ 工具执行完成，成功 ${results.length} 个`);
      return results;
    }

    // ===== 标准 TodoWrite 工具实现 =====
    private static async executeTodoWrite(args: string): Promise<object> {
      try {
        const { todos } = JSON.parse(args);
        
        if (!Array.isArray(todos)) {
          return { success: false, error: 'todos参数必须是数组' };
        }

        // 验证todos数组格式
        for (const todo of todos) {
          if (!todo.id || !todo.content || !todo.status) {
            return { 
              success: false, 
              error: '每个todo必须包含id、content和status字段' 
            };
          }
          if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
            return { 
              success: false, 
              error: `无效的status值: ${todo.status}。必须是 pending、in_progress 或 completed` 
            };
          }
        }

        const { StandardTodoManager } = await import('@/types/todo');
        const todoManager = StandardTodoManager.getInstance();
        const updatedTodos = todoManager.updateTodos(todos);
        const progress = todoManager.getProgress();

        console.log('✅ TodoWrite执行成功:', { 
          todosCount: updatedTodos.length, 
          progress: `${progress.completed}/${progress.total}` 
        });

        return {
          success: true,
          todos: updatedTodos,
          progress,
          message: `任务清单已更新，共${updatedTodos.length}个任务，完成${progress.completed}个`,
          todo_update: { 
            type: 'todos_updated', 
            todos: updatedTodos,
            progress 
          }
        };
      } catch (error) {
        console.error('❌ TodoWrite执行失败:', error);
        return { 
          success: false, 
          error: `TodoWrite执行失败: ${error instanceof Error ? error.message : String(error)}` 
        };
      }
    }

    // ===== 旧版 TodoWrite 方法实现（向后兼容）=====
    private static async createTodoList(args: string): Promise<object> {
      try {
        const { title, tasks } = JSON.parse(args);
        
        // 弃用警告
        console.warn('⚠️ create_todo_list已弃用，建议使用TodoWrite工具替代');
        
        const { TodoManager } = await import('@/types/todo');
        const todoManager = TodoManager.getInstance();
        const todoList = todoManager.createTodoList(title, tasks);
        console.log('🧩 create_todo_list（兼容模式）:', { title, tasksCount: tasks?.length, todoId: todoList.id });
        return {
          success: true,
          todoList,
          message: `已创建任务清单"${title}"，包含${tasks.length}个任务（建议下次使用TodoWrite工具）`,
          todo_update: { type: 'todo_created', todoList },
          deprecation_notice: 'create_todo_list已弃用，请使用TodoWrite工具替代'
        };
      } catch (error) {
        console.error('❌ create_todo_list 失败:', error);
        return { success: false, error: `创建Todo失败: ${error}` };
      }
    }

    private static async completeTodoTask(args: string): Promise<object> {
      try {
        const { todo_id, task_id, completion_note, task_index, task_content } = JSON.parse(args);
        
        // 弃用警告
        console.warn('⚠️ complete_todo_task已弃用，建议使用TodoWrite工具替代');
        
        const { TodoManager } = await import('@/types/todo');
        const todoManager = TodoManager.getInstance();

        // 获取列表（带重试，缓解偶发的异步时序问题）
        let todoList = todoManager.getTodoListById(todo_id) || null;
        if (!todoList) {
          for (let i = 0; i < 2 && !todoList; i++) {
            await new Promise(res => setTimeout(res, 120));
            todoList = todoManager.getTodoListById(todo_id);
          }
        }
        // 回退：若没传todo_id或未找到，则尝试使用活跃列表
        if (!todoList) {
          todoList = todoManager.getActiveTodoList();
        }
        if (!todoList) {
          return { success: false, error: '未找到Todo列表，请先创建任务清单或重试' };
        }

        // 解析 task_id，不存在时尝试用 task_index 或 task_content 兜底
        let resolvedTaskId: string | undefined = task_id;
        let resolvedFrom: 'id' | 'index' | 'content' | 'current' | 'unknown' = 'unknown';

        if (!resolvedTaskId && typeof task_index === 'number') {
          // 兼容从1开始/0开始，优先认为从1开始
          const idx = Math.max(0, Math.floor(task_index) - 1);
          const target = todoList.tasks[idx];
          if (target) {
            resolvedTaskId = target.id;
            resolvedFrom = 'index';
          }
        }
        if (!resolvedTaskId && typeof task_content === 'string' && task_content.trim()) {
          const keyword = task_content.trim();
          const preferOrder = ['in_progress', 'pending', 'completed'] as const;
          let matched: string | undefined;
          for (const status of preferOrder) {
            const found = todoList.tasks.find(t => t.status === status && t.content.includes(keyword));
            if (found) { matched = found.id; break; }
          }
          if (matched) {
            resolvedTaskId = matched;
            resolvedFrom = 'content';
          }
        }
        if (!resolvedTaskId && todoList.current_task_id) {
          resolvedTaskId = todoList.current_task_id;
          resolvedFrom = 'current';
        }
        if (!resolvedTaskId) {
          return {
            success: false,
            error: '无法解析任务标识。请提供 task_id，或补充 task_index/task_content。',
            hint: {
              available_tasks: todoList.tasks.map((t, i) => ({ index: i + 1, id: t.id, status: t.status, content: t.content })).slice(0, 20)
            }
          };
        }

        const updatedTodoList = todoManager.completeTask(todoList.id, resolvedTaskId, completion_note);
        if (!updatedTodoList) {
          return { success: false, error: '任务不存在或已完成' };
        }
        console.log('🧩 complete_todo_task:', { todo_id, task_id, completion_note, completed: updatedTodoList.completed_tasks, total: updatedTodoList.total_tasks });
        const progress = {
          completed: updatedTodoList.completed_tasks,
          total: updatedTodoList.total_tasks,
          percentage: (updatedTodoList.completed_tasks / updatedTodoList.total_tasks) * 100
        };
        return {
          success: true,
          todoList: updatedTodoList,
          message: `${completion_note || '任务已完成'}（建议下次使用TodoWrite工具）`,
          progress,
          all_completed: progress.completed === progress.total,
          todo_update: { type: 'task_completed', todoList: updatedTodoList },
          resolved: { task_id: resolvedTaskId, from: resolvedFrom },
          deprecation_notice: 'complete_todo_task已弃用，请使用TodoWrite工具替代'
        };
      } catch (error) {
        console.error('❌ complete_todo_task 失败:', error);
        return { success: false, error: `完成任务失败: ${error}` };
      }
    }

    private static async addTodoTask(args: string): Promise<object> {
      try {
        const { todo_id, task_description } = JSON.parse(args);
        const { TodoManager } = await import('@/types/todo');
        const todoManager = TodoManager.getInstance();
        const updatedTodoList = todoManager.addTask(todo_id, task_description);
        if (!updatedTodoList) {
          return { success: false, error: 'Todo列表不存在' };
        }
        console.log('🧩 add_todo_task:', { todo_id, task_description, total: updatedTodoList.total_tasks });
        return {
          success: true,
          todoList: updatedTodoList,
          message: `已添加新任务: ${task_description}`,
          todo_update: { type: 'task_added', todoList: updatedTodoList }
        };
      } catch (error) {
        console.error('❌ add_todo_task 失败:', error);
        return { success: false, error: `添加任务失败: ${error}` };
      }
    }

    private static async getTodoStatus(args: string): Promise<object> {
      try {
        let todo_id: string | undefined;
        try { todo_id = JSON.parse(args)?.todo_id; } catch {}
        const { TodoManager } = await import('@/types/todo');
        const todoManager = TodoManager.getInstance();
        const todoList = todo_id ? todoManager.getTodoListById(todo_id) : todoManager.getActiveTodoList();
        if (!todoList) {
          return { success: false, error: '没有找到Todo列表' };
        }
        console.log('🧩 get_todo_status:', { todo_id: todo_id || '(active)', completed: todoList.completed_tasks, total: todoList.total_tasks, current: todoList.current_task_id });
        return {
          success: true,
          todoList,
          has_incomplete_tasks: todoManager.hasIncompleteTasks(todoList.id)
        };
      } catch (error) {
        console.error('❌ get_todo_status 失败:', error);
        return { success: false, error: `获取Todo状态失败: ${error}` };
      }
    }
    
    // 获取天气信息的核心方法
    static async getWeather(argumentsStr: string) {
      const args = JSON.parse(argumentsStr);
      const { location, adm } = args;
      
      if (!this.QWEATHER_TOKEN) {
        throw new Error('和风天气API密钥未配置');
      }
      
      // 第一步：获取地理位置信息
      const geoData = await this.getGeoLocation(location, adm);
      if (!geoData || geoData.length === 0) {
        throw new Error(`未找到城市: ${location}`);
      }
      
      const cityInfo = geoData[0]; // 取第一个结果
      const { lat, lon, name, adm1, adm2 } = cityInfo;
      
      // 并行请求多个天气API
      const [weatherNow, airQuality, weatherIndices, minutely] = await Promise.allSettled([
        this.getWeatherNow(lat, lon),
        this.getAirQuality(lat, lon),
        this.getWeatherIndices(lat, lon),
        this.getMinutelyPrecipitation(lat, lon)
      ]);
      
      // 处理结果
      const result = {
        success: true,
        location: {
          name,
          adm1,
          adm2,
          lat,
          lon
        },
        weather: weatherNow.status === 'fulfilled' ? weatherNow.value : null,
        airQuality: airQuality.status === 'fulfilled' ? airQuality.value : null,
        indices: weatherIndices.status === 'fulfilled' ? weatherIndices.value : null,
        minutely: minutely.status === 'fulfilled' ? minutely.value : null,
        timestamp: new Date().toISOString(),
        errors: [
          weatherNow.status === 'rejected' ? `天气数据: ${weatherNow.reason}` : null,
          airQuality.status === 'rejected' ? `空气质量: ${airQuality.reason}` : null,
          weatherIndices.status === 'rejected' ? `天气指数: ${weatherIndices.reason}` : null,
          minutely.status === 'rejected' ? `分钟降水: ${minutely.reason}` : null,
        ].filter(Boolean)
      };
      
      return result;
    }
    
    // 地理位置查询
    private static async getGeoLocation(location: string, adm?: string): Promise<GeoLocation[]> {
      const params = new URLSearchParams({
        location,
        key: this.QWEATHER_TOKEN!
      });
      
      if (adm) {
        params.append('adm', adm);
      }
      
      const response = await fetch(`https://geoapi.qweather.com/v2/city/lookup?${params}`);
      
      if (!response.ok) {
        throw new Error(`地理位置API请求失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== '200') {
        throw new Error(`地理位置查询失败: ${data.code}`);
      }

      return data.location || [];
    }
    
    // 实时天气
    private static async getWeatherNow(lat: string, lon: string): Promise<WeatherNow> {
      const response = await fetch(
        `https://devapi.qweather.com/v7/weather/now?location=${lon},${lat}&key=${this.QWEATHER_TOKEN}`
      );

      if (!response.ok) {
        throw new Error(`实时天气API请求失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== '200') {
        throw new Error(`实时天气查询失败: ${data.code}`);
      }

      return data.now;
    }
    
    // 空气质量
    private static async getAirQuality(lat: string, lon: string): Promise<AirQuality> {
      const response = await fetch(
        `https://devapi.qweather.com/v7/air/now?location=${lon},${lat}&key=${this.QWEATHER_TOKEN}`
      );

      if (!response.ok) {
        throw new Error(`空气质量API请求失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== '200') {
        throw new Error(`空气质量查询失败: ${data.code}`);
      }

      return data.now;
    }
    
    // 天气指数
    private static async getWeatherIndices(lat: string, lon: string): Promise<WeatherIndex[]> {
      const response = await fetch(
        `https://devapi.qweather.com/v7/indices/1d?type=1,2,3,5,8&location=${lon},${lat}&key=${this.QWEATHER_TOKEN}`
      );

      if (!response.ok) {
        throw new Error(`天气指数API请求失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== '200') {
        throw new Error(`天气指数查询失败: ${data.code}`);
      }

      return data.daily || [];
    }
    
    // 分钟级降水
    private static async getMinutelyPrecipitation(lat: string, lon: string) {
      const response = await fetch(
        `https://devapi.qweather.com/v7/minutely/5m?location=${lon},${lat}&key=${this.QWEATHER_TOKEN}`
      );

      if (!response.ok) {
        throw new Error(`分钟降水API请求失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== '200') {
        throw new Error(`分钟降水查询失败: ${data.code}`);
      }

      return data;
    }
    
    // Web 搜索工具
    private static async executeWebSearchTool(argumentsStr: string): Promise<object> {
      const args = JSON.parse(argumentsStr);
      const { query, count = 8 } = args;

      const BOCHA_API_KEY = process.env.BOCHA_API_KEY;

      if (!BOCHA_API_KEY) {
        throw new Error('博查AI搜索API密钥未配置');
      }

      try {
        const response = await fetch('https://api.bochaai.com/v1/web-search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${BOCHA_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            freshness: 'oneYear',
            summary: true,
            count: Math.min(count, 8),
          }),
        });

        if (!response.ok) {
          throw new Error(`搜索API请求失败: ${response.status}`);
        }

        const data = await response.json();

        if (data.code !== 200) {
          throw new Error(`搜索失败: ${data.msg || '未知错误'}`);
        }

        const searchResults = data.data?.webPages?.value || [];

        return {
          success: true,
          query,
          totalResults: data.data?.webPages?.totalEstimatedMatches || 0,
          results: searchResults.map((item: any) => ({
            name: item.name || '',
            url: item.url || '',
            snippet: item.snippet || '',
            summary: item.summary || item.snippet || '',
            siteName: item.siteName || '',
            datePublished: item.datePublished || item.dateLastCrawled || '',
            siteIcon: item.siteIcon || '',
          })),
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error('网络搜索失败:', error);
        throw new Error(`网络搜索失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
    
    // OpenManus任务执行
    static async executeOpenManusTask(argumentsStr: string, taskType: string): Promise<object> {
      const args = JSON.parse(argumentsStr);
      const { task_description, ...otherArgs } = args;

      try {
        const taskRequest: OpenManusTaskRequest = {
          task_description,
          agent_type: 'manus',
          max_steps: 20,
          ...otherArgs,
        };

        const response = await fetch(`${this.OPENMANUS_API_URL}/api/execute_task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskRequest),
        });

        if (!response.ok) {
          throw new Error(`OpenManus API请求失败: ${response.status}`);
        }

        const taskResponse: OpenManusTaskResponse = await response.json();
        const taskId = taskResponse.task_id;

        let attempts = 0;
        const maxAttempts = 60;

        while (attempts < maxAttempts) {
          await new Promise((res) => setTimeout(res, 5000));

          const statusResponse = await fetch(`${this.OPENMANUS_API_URL}/api/task_status/${taskId}`);

          if (!statusResponse.ok) {
            throw new Error(`获取任务状态失败: ${statusResponse.status}`);
          }

          const status = await statusResponse.json();

          if (status.status === 'completed') {
            return {
              success: true,
              task_type: taskType,
              task_id: taskId,
              result: status.result,
              progress: status.progress,
              timestamp: new Date().toISOString(),
            };
          } else if (status.status === 'failed') {
            throw new Error(`OpenManus任务执行失败: ${status.error}`);
          }

          attempts++;
        }

        throw new Error('OpenManus任务执行超时');
      } catch (error) {
        console.error('OpenManus任务执行错误:', error);
        return {
          success: false,
          task_type: taskType,
          error: error instanceof Error ? error.message : '任务执行失败',
          timestamp: new Date().toISOString(),
        };
      }
    }

    // 仅创建OpenManus任务并立即返回pending结果（供前端展示进度）
    static async createOpenManusTask(argumentsStr: string, taskType: string): Promise<object> {
      const args = JSON.parse(argumentsStr);
      const { task_description, ...otherArgs } = args;

      try {
        const taskRequest: OpenManusTaskRequest = {
          task_description,
          agent_type: 'manus',
          max_steps: 20,
          ...otherArgs,
        };

        const response = await fetch(`${this.OPENMANUS_API_URL}/api/execute_task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskRequest),
        });

        if (!response.ok) {
          throw new Error(`OpenManus API请求失败: ${response.status}`);
        }

        const taskResponse: OpenManusTaskResponse = await response.json();

        return {
          success: true,
          task_type: taskType,
          task_id: taskResponse.task_id,
          status: taskResponse.status || 'pending',
          message: '任务已创建',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error('创建OpenManus任务失败:', error);
        return {
          success: false,
          task_type: taskType,
          error: error instanceof Error ? error.message : '任务创建失败',
          status: 'error',
          timestamp: new Date().toISOString(),
        };
      }
    }
  }