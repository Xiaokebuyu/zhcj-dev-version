// src/app/api/openmanus/route.ts
// OpenManus代理API路由

import { NextRequest, NextResponse } from 'next/server';
import { OpenManusTaskRequest, OpenManusTaskResponse } from '@/utils/toolManager';

const OPENMANUS_API_URL = process.env.OPENMANUS_API_URL || 'http://127.0.0.1:8001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...data } = body;

    switch (action) {
      case 'execute_task':
        return await executeTask(data);
      case 'get_task_status':
        return await getTaskStatus(data.task_id);
      case 'cancel_task':
        return await cancelTask(data.task_id);
      case 'get_available_tools':
        return await getAvailableTools();
      case 'health_check':
        return await healthCheck();
      default:
        return NextResponse.json(
          { error: '不支持的操作' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('OpenManus API错误:', error);
    return NextResponse.json(
      { 
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    );
  }
}

// 执行OpenManus任务
async function executeTask(taskRequest: OpenManusTaskRequest): Promise<NextResponse> {
  try {
    const response = await fetch(`${OPENMANUS_API_URL}/api/execute_task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task_description: taskRequest.task_description,
        agent_type: taskRequest.agent_type || 'manus',
        tools: taskRequest.tools || [],
        context: taskRequest.context,
        max_steps: taskRequest.max_steps || 20
      })
    });

    if (!response.ok) {
      throw new Error(`OpenManus API请求失败: ${response.status} ${response.statusText}`);
    }

    const result: OpenManusTaskResponse = await response.json();
    
    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('执行OpenManus任务失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '任务执行失败'
    }, { status: 500 });
  }
}

// 获取任务状态
async function getTaskStatus(taskId: string): Promise<NextResponse> {
  try {
    const response = await fetch(`${OPENMANUS_API_URL}/api/task_status/${taskId}`);

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({
          success: false,
          error: '任务不存在'
        }, { status: 404 });
      }
      throw new Error(`获取任务状态失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取任务状态失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取状态失败'
    }, { status: 500 });
  }
}

// 取消任务
async function cancelTask(taskId: string): Promise<NextResponse> {
  try {
    const response = await fetch(`${OPENMANUS_API_URL}/api/task/${taskId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({
          success: false,
          error: '任务不存在'
        }, { status: 404 });
      }
      throw new Error(`取消任务失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    return NextResponse.json({
      success: true,
      message: result.message || '任务已取消'
    });

  } catch (error) {
    console.error('取消任务失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '取消任务失败'
    }, { status: 500 });
  }
}

// 获取可用工具列表
async function getAvailableTools(): Promise<NextResponse> {
  try {
    const response = await fetch(`${OPENMANUS_API_URL}/api/available_tools`);

    if (!response.ok) {
      throw new Error(`获取工具列表失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取工具列表失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取工具列表失败',
      data: [
        // 返回默认的工具列表作为备用
        {
          name: "browser_use",
          description: "网页自动化工具，支持页面导航、元素交互、内容提取"
        },
        {
          name: "python_execute", 
          description: "Python代码执行工具，支持数据分析、计算、文件处理"
        },
        {
          name: "str_replace_editor",
          description: "文件编辑工具，支持文件查看、创建、文本替换"
        }
      ]
    });
  }
}

// 健康检查
async function healthCheck(): Promise<NextResponse> {
  try {
    const response = await fetch(`${OPENMANUS_API_URL}/api/health`, {
      method: 'GET',
      // 设置超时时间
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`健康检查失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    return NextResponse.json({
      success: true,
      status: 'healthy',
      openmanus_service: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('OpenManus服务健康检查失败:', error);
    return NextResponse.json({
      success: false,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'OpenManus服务不可用',
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
}

// GET请求处理 - 用于健康检查
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'health') {
      return await healthCheck();
    } else if (action === 'tools') {
      return await getAvailableTools();
    } else {
      return NextResponse.json({
        message: 'OpenManus API服务正常运行',
        endpoints: [
          'POST /api/openmanus - 执行任务',
          'GET /api/openmanus?action=health - 健康检查',
          'GET /api/openmanus?action=tools - 获取工具列表'
        ],
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('OpenManus API GET请求错误:', error);
    return NextResponse.json(
      { 
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    );
  }
}