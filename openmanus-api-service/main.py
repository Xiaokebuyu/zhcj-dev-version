#!/usr/bin/env python3
"""
OpenManus API Service - 修复版本
为悬浮框助手提供OpenManus功能的HTTP API服务
关键修改：修复任务执行和结果返回机制
"""

import asyncio
import json
import logging
import subprocess
import sys
import uuid
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from fastapi.responses import StreamingResponse

# 添加OpenManus路径
OPENMANUS_DIR = Path(__file__).parent.parent / "OpenManus"
sys.path.insert(0, str(OPENMANUS_DIR))

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 初始化FastAPI应用
app = FastAPI(
    title="OpenManus API Service",
    description="为悬浮框助手提供OpenManus AI代理功能的API服务",
    version="1.0.0"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenManus工作目录  
WORKSPACE_DIR = OPENMANUS_DIR / "workspace"

# 导入OpenManus核心模块
try:
    from app.agent.manus import Manus
    from app.logger import logger as manus_logger
except ImportError as e:
    print(f"无法导入OpenManus模块: {e}")
    manus_logger = None

# 数据模型
class TaskRequest(BaseModel):
    """任务请求模型"""
    task_description: str = Field(..., description="任务描述")
    agent_type: str = Field(default="manus", description="代理类型: manus, react, browser, swe")
    tools: List[str] = Field(default=[], description="指定使用的工具")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文信息")
    max_steps: int = Field(default=20, description="最大执行步数")

class TaskResponse(BaseModel):
    """任务响应模型"""
    task_id: str
    status: str  # pending, running, completed, failed
    result: Optional[str] = None
    error: Optional[str] = None
    steps_completed: int = 0
    total_steps: int = 0
    created_at: str
    updated_at: str

class TaskStatus(BaseModel):
    """任务状态模型"""
    task_id: str
    status: str
    progress: float  # 0.0 - 1.0
    current_step: Optional[str] = None
    result: Optional[str] = None
    error: Optional[str] = None

# -----------------------------------------------------------------------------
# 任务日志队列支持 (用于前端实时查看执行进度)
# -----------------------------------------------------------------------------

# 每个 task_id 对应一个 asyncio.Queue，用于存储日志行
task_log_queues: Dict[str, "asyncio.Queue[str]"] = {}

class QueueLogHandler(logging.Handler):
    """将日志消息写入 asyncio.Queue，供 SSE 接口实时推送"""

    def __init__(self, queue: "asyncio.Queue[str]"):
        super().__init__()
        self.queue = queue

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            # put_nowait 避免阻塞日志线程
            if self.queue is not None:
                self.queue.put_nowait(msg)
        except Exception:  # pragma: no cover
            # 避免日志处理中的任何异常打断主流程
            pass

# 内存中的任务存储
tasks: Dict[str, TaskResponse] = {}
task_processes: Dict[str, subprocess.Popen] = {}

# 全局的OpenManus代理实例缓存
_manus_instances: Dict[str, Any] = {}

# 运行中任务索引: key->task_id
running_task_index: Dict[str, str] = {}

async def get_or_create_manus_instance(task_id: str) -> Any:
    """获取或创建OpenManus实例"""
    if manus_logger is None:
        raise Exception("OpenManus模块未正确导入")
        
    if task_id not in _manus_instances:
        try:
            # 创建新的Manus实例
            _manus_instances[task_id] = await Manus.create()
            logger.info(f"为任务 {task_id} 创建了新的Manus实例")
        except Exception as e:
            logger.error(f"创建Manus实例失败: {e}")
            raise
    
    return _manus_instances[task_id]

# 🔧 修复：改进的任务执行函数
async def execute_openmanus_task(task_id: str, task_request: TaskRequest):
    """异步执行OpenManus任务 - 修复版本"""
    manus_instance = None

    # 为该任务创建日志队列并绑定到 manus_logger
    log_queue: "asyncio.Queue[str]" = asyncio.Queue()
    task_log_queues[task_id] = log_queue
    queue_handler = QueueLogHandler(log_queue)
    queue_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))

    # 兼容 loguru.logger 与 standard logging.Logger
    sink_id = None
    if manus_logger:
        if hasattr(manus_logger, "addHandler"):
            manus_logger.addHandler(queue_handler)
        else:
            sink_id = manus_logger.add(queue_handler.emit, format="{message}")
    else:
        logger.addHandler(queue_handler)

    try:
        # 🔑 修复：确保任务状态正确更新
        logger.info(f"开始执行任务 {task_id}: {task_request.task_description}")
        
        tasks[task_id].status = "running"
        tasks[task_id].updated_at = datetime.now().isoformat()
        
        # 获取Manus实例
        manus_instance = await get_or_create_manus_instance(task_id)
        
        # 🔑 修复：改进的任务执行和结果捕获
        if manus_logger:
            manus_logger.info(f"开始执行任务 {task_id}: {task_request.task_description}")
        
        # 使用OpenManus的run方法执行任务
        try:
            # 🔑 关键修复：确保捕获任务执行结果
            result = await manus_instance.run(task_request.task_description)
            
            # 🔑 修复：更好的结果处理
            if result is not None:
                # 如果返回结果是字符串，直接使用
                if isinstance(result, str):
                    task_result = result
                # 如果返回结果是对象，转换为JSON字符串
                else:
                    task_result = json.dumps(result, ensure_ascii=False, indent=2)
            else:
                task_result = f"任务 '{task_request.task_description}' 已成功完成"
            
            # 🔑 修复：确保任务完成状态正确设置
            tasks[task_id].status = "completed"
            tasks[task_id].result = task_result
            tasks[task_id].steps_completed = tasks[task_id].total_steps
            tasks[task_id].updated_at = datetime.now().isoformat()
            
            if manus_logger:
                manus_logger.info(f"任务 {task_id} 执行完成，结果: {task_result[:200]}...")
            
            logger.info(f"✅ 任务 {task_id} 执行完成")
            
        except Exception as task_error:
            # 🔑 修复：更好的任务执行错误处理
            error_msg = f"任务执行失败: {str(task_error)}"
            logger.error(f"❌ 任务 {task_id} 执行失败: {task_error}")
            
            tasks[task_id].status = "failed"
            tasks[task_id].error = error_msg
            tasks[task_id].updated_at = datetime.now().isoformat()
            
            if manus_logger:
                manus_logger.error(f"任务 {task_id} 执行失败: {task_error}")
        
    except Exception as e:
        # 🔑 修复：改进的异常处理
        error_msg = f"任务初始化或执行过程中出错: {str(e)}"
        logger.error(f"❌ 任务 {task_id} 异常: {e}")
        
        tasks[task_id].status = "failed"
        tasks[task_id].error = error_msg
        tasks[task_id].updated_at = datetime.now().isoformat()
        
        if manus_logger:
            manus_logger.error(f"任务 {task_id} 执行失败: {e}")
    finally:
        # 🔑 修复：确保清理工作正确执行
        try:
            # 记录任务最终状态
            final_status = tasks[task_id].status
            logger.info(f"📋 任务 {task_id} 最终状态: {final_status}")
            
            # 清理Manus实例
            if manus_instance and task_id in _manus_instances:
                try:
                    await manus_instance.cleanup()
                    del _manus_instances[task_id]
                    logger.info(f"🧹 已清理任务 {task_id} 的Manus实例")
                except Exception as e:
                    logger.error(f"清理Manus实例失败: {e}")

            # 任务结束后写入队列终止标记
            try:
                await log_queue.put("[任务结束]")
            except Exception:
                pass

            # 移除日志处理器
            if manus_logger:
                if hasattr(manus_logger, "removeHandler"):
                    manus_logger.removeHandler(queue_handler)
                elif sink_id is not None:
                    manus_logger.remove(sink_id)
            else:
                logger.removeHandler(queue_handler)

            # 从运行索引移除
            key = f"{task_request.agent_type}:{task_request.task_description}:{json.dumps(task_request.context or {}, sort_keys=True)}"
            if running_task_index.get(key) == task_id:
                running_task_index.pop(key, None)
                
        except Exception as cleanup_error:
            logger.error(f"任务 {task_id} 清理过程中出错: {cleanup_error}")

@app.post("/api/execute_task", response_model=TaskResponse)
async def execute_task(task_request: TaskRequest, background_tasks: BackgroundTasks):
    """执行OpenManus任务 - 修复版本"""
    try:
        key = f"{task_request.agent_type}:{task_request.task_description}:{json.dumps(task_request.context or {}, sort_keys=True)}"

        # 🔑 修复：改进的幂等性检查
        if key in running_task_index:
            existing_id = running_task_index[key]
            if existing_id in tasks and tasks[existing_id].status in {"pending", "running"}:
                logger.info(f"复用已存在任务 {existing_id} 作为幂等返回")
                return tasks[existing_id]

        # 创建新任务
        task_id = str(uuid.uuid4())

        # 🔑 修复：改进的任务初始化
        task_response = TaskResponse(
            task_id=task_id,
            status="pending",
            steps_completed=0,
            total_steps=task_request.max_steps,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
            result=None,
            error=None
        )

        tasks[task_id] = task_response
        running_task_index[key] = task_id

        # 🔑 修复：确保后台任务正确启动
        logger.info(f"📝 创建新任务: {task_id} - {task_request.task_description}")
        background_tasks.add_task(execute_openmanus_task, task_id, task_request)

        return task_response
        
    except Exception as e:
        logger.error(f"❌ 创建任务失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/task_status/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    """获取任务状态 - 修复版本"""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task = tasks[task_id]
    
    # 🔑 修复：改进的进度计算
    progress = 0.0
    if task.total_steps > 0:
        progress = min(1.0, task.steps_completed / task.total_steps)
    
    # 如果任务已完成，确保进度为1.0
    if task.status == "completed":
        progress = 1.0
    
    # 🔑 修复：返回更详细的状态信息
    status_response = TaskStatus(
        task_id=task_id,
        status=task.status,
        progress=progress,
        result=task.result,
        error=task.error,
        current_step=f"Step {task.steps_completed}/{task.total_steps}" if task.status == "running" else None
    )
    
    logger.debug(f"📊 任务 {task_id} 状态查询: {task.status}, 进度: {progress:.2f}")
    return status_response

@app.get("/api/available_tools", response_model=List[Dict[str, str]])
async def get_available_tools():
    """获取可用工具列表"""
    tools = [
        {
            "name": "browser_use",
            "description": "网页自动化工具，支持页面导航、元素交互、内容提取"
        },
        {
            "name": "python_execute", 
            "description": "Python代码执行工具，支持数据分析、计算、文件处理"
        },
        {
            "name": "str_replace_editor",
            "description": "文件编辑工具，支持文件查看、创建、文本替换"
        },
        {
            "name": "web_search",
            "description": "网络搜索工具，支持多引擎搜索"
        }
    ]
    return tools

@app.get("/api/health")
async def health_check():
    """健康检查 - 修复版本"""
    # 🔑 修复：更详细的健康检查信息
    health_info = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "openmanus_dir": str(OPENMANUS_DIR),
        "manus_available": manus_logger is not None,
        "active_instances": len(_manus_instances),
        "active_tasks": len(tasks),
        "running_tasks": len([t for t in tasks.values() if t.status in {"pending", "running"}]),
        "completed_tasks": len([t for t in tasks.values() if t.status == "completed"]),
        "failed_tasks": len([t for t in tasks.values() if t.status == "failed"])
    }
    
    logger.debug(f"🏥 健康检查: {health_info}")
    return health_info

@app.delete("/api/task/{task_id}")
async def cancel_task(task_id: str):
    """取消任务 - 修复版本"""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 🔑 修复：改进的任务取消逻辑
    task = tasks[task_id]
    
    if task.status in {"completed", "failed"}:
        return {"message": f"任务 {task_id} 已经结束，状态: {task.status}"}
    
    # 如果任务正在运行，清理Manus实例
    if task_id in _manus_instances:
        try:
            await _manus_instances[task_id].cleanup()
            del _manus_instances[task_id]
            logger.info(f"🧹 已清理被取消任务 {task_id} 的Manus实例")
        except Exception as e:
            logger.error(f"清理被取消任务的Manus实例失败: {e}")
    
    # 更新任务状态
    task.status = "failed"
    task.error = "任务被用户取消"
    task.updated_at = datetime.now().isoformat()
    
    logger.info(f"🛑 任务 {task_id} 已被取消")
    
    return {"message": f"任务 {task_id} 已取消"}

# 🔧 新增：批量查询任务状态的接口
@app.get("/api/tasks/status", response_model=List[TaskStatus])
async def get_all_tasks_status():
    """获取所有任务状态"""
    result = []
    for task_id, task in tasks.items():
        progress = 0.0
        if task.total_steps > 0:
            progress = min(1.0, task.steps_completed / task.total_steps)
        if task.status == "completed":
            progress = 1.0
            
        result.append(TaskStatus(
            task_id=task_id,
            status=task.status,
            progress=progress,
            result=task.result,
            error=task.error,
            current_step=f"Step {task.steps_completed}/{task.total_steps}" if task.status == "running" else None
        ))
    
    return result

# -----------------------------------------------------------------------------
# 日志流 (Server-Sent Events) 接口
# -----------------------------------------------------------------------------

@app.get("/api/task_logs/{task_id}")
async def stream_task_logs(task_id: str):
    """以SSE形式实时推送指定任务的日志"""
    if task_id not in task_log_queues:
        raise HTTPException(status_code=404, detail="任务不存在或暂无日志")

    log_queue = task_log_queues[task_id]

    async def event_generator():
        # 不断从队列获取日志并发送给客户端
        while True:
            msg = await log_queue.get()
            yield f"data: {msg}\n\n"
            # 遇到结束标记后退出循环
            if msg.strip() == "[任务结束]":
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    # 确保工作目录存在
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    
    # 启动服务
    uvicorn.run(app, host="127.0.0.1", port=8001, reload=True)