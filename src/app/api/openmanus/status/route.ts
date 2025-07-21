import { NextRequest, NextResponse } from 'next/server';

const OPENMANUS_API_URL = process.env.OPENMANUS_API_URL || 'http://127.0.0.1:8001';

// 任务状态缓存（用于减少API调用频率）
const statusCache = new Map<string, { status: any; timestamp: number }>();
const CACHE_DURATION = 2000; // 2秒缓存

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get('task_id');
    
    if (!taskId) {
      return NextResponse.json(
        { error: '缺少task_id参数' },
        { status: 400 }
      );
    }

    console.log(`🔍 查询任务状态: ${taskId}`);

    // 检查缓存
    const cached = statusCache.get(taskId);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log(`📋 使用缓存的任务状态: ${taskId}`);
      return NextResponse.json({
        success: true,
        fromCache: true,
        ...cached.status
      });
    }

    // 查询OpenManus API
    const response = await fetch(`${OPENMANUS_API_URL}/api/task_status/${taskId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({
          success: false,
          error: '任务不存在',
          task_id: taskId,
          status: 'not_found'
        }, { status: 404 });
      }
      throw new Error(`OpenManus API错误: ${response.status} ${response.statusText}`);
    }

    const statusData = await response.json();
    
    // 标准化响应格式
    const normalizedStatus = {
      success: true,
      task_id: taskId,
      status: statusData.status || 'unknown',
      result: statusData.result || null,
      error: statusData.error || null,
      progress: statusData.progress || null,
      steps_completed: statusData.steps_completed || 0,
      total_steps: statusData.total_steps || 0,
      created_at: statusData.created_at,
      updated_at: statusData.updated_at || new Date().toISOString(),
      timestamp: new Date().toISOString()
    };

    // 更新缓存
    statusCache.set(taskId, {
      status: normalizedStatus,
      timestamp: now
    });

    // 清理过期缓存（避免内存泄漏）
    if (statusCache.size > 100) {
      const expiredKeys = [];
      for (const [key, value] of statusCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION * 10) {
          expiredKeys.push(key);
        }
      }
      expiredKeys.forEach(key => statusCache.delete(key));
    }

    console.log(`✅ 任务状态查询成功: ${taskId} -> ${normalizedStatus.status}`);
    return NextResponse.json(normalizedStatus);

  } catch (error) {
    console.error('❌ 任务状态查询失败:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '查询失败',
      task_id: request.url ? new URL(request.url).searchParams.get('task_id') : null,
      status: 'error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// 批量查询多个任务状态
export async function POST(request: NextRequest) {
  try {
    const { task_ids }: { task_ids: string[] } = await request.json();
    
    if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
      return NextResponse.json(
        { error: '无效的task_ids格式' },
        { status: 400 }
      );
    }

    console.log(`🔍 批量查询任务状态:`, task_ids);

    const results = await Promise.allSettled(
      task_ids.map(async (taskId) => {
        // 检查缓存
        const cached = statusCache.get(taskId);
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          return { task_id: taskId, ...cached.status };
        }

        // 查询API
        const response = await fetch(`${OPENMANUS_API_URL}/api/task_status/${taskId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) {
          throw new Error(`任务${taskId}查询失败: ${response.status}`);
        }

        const statusData = await response.json();
        const normalizedStatus = {
          success: true,
          task_id: taskId,
          status: statusData.status || 'unknown',
          result: statusData.result || null,
          error: statusData.error || null,
          timestamp: new Date().toISOString()
        };

        // 更新缓存
        statusCache.set(taskId, {
          status: normalizedStatus,
          timestamp: now
        });

        return normalizedStatus;
      })
    );

    const taskStatuses = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          task_id: task_ids[index],
          error: result.reason?.message || '查询失败',
          status: 'error',
          timestamp: new Date().toISOString()
        };
      }
    });

    console.log(`✅ 批量查询完成，成功${taskStatuses.filter(t => t.success).length}/${task_ids.length}个`);

    return NextResponse.json({
      success: true,
      total: task_ids.length,
      results: taskStatuses,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ 批量查询失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '批量查询失败',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 