// src/types/todo.ts

export interface TodoTask {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: number;
  completed_at?: number;
  completion_note?: string;
}

export interface TodoList {
  id: string;
  title: string;
  tasks: TodoTask[];
  created_at: number;
  updated_at: number;
  total_tasks: number;
  completed_tasks: number;
  current_task_id?: string;
}

// 全局单例管理器（进程内内存持久）
export class TodoManager {
  private static instance: TodoManager;
  private todoLists: Map<string, TodoList> = new Map();
  private activeTodoId: string | null = null;

  static getInstance(): TodoManager {
    if (!TodoManager.instance) {
      TodoManager.instance = new TodoManager();
    }
    return TodoManager.instance;
  }

  createTodoList(title: string, tasks: string[]): TodoList {
    const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const todoTasks: TodoTask[] = tasks.map((content, index) => ({
      id: `task_${todoId}_${index}`,
      content,
      status: 'pending',
      created_at: now
    }));

    const todoList: TodoList = {
      id: todoId,
      title,
      tasks: todoTasks,
      created_at: now,
      updated_at: now,
      total_tasks: tasks.length,
      completed_tasks: 0
    };

    this.todoLists.set(todoId, todoList);
    this.activeTodoId = todoId;

    // 自动开始第一个任务
    if (todoTasks.length > 0) {
      this.startTask(todoId, todoTasks[0].id);
    }

    return todoList;
  }

  startTask(todoId: string, taskId: string): boolean {
    const todoList = this.todoLists.get(todoId);
    if (!todoList) return false;

    // 单一任务原则：重置其他进行中的任务
    todoList.tasks.forEach(task => {
      if (task.status === 'in_progress') {
        task.status = 'pending';
      }
    });

    const task = todoList.tasks.find(t => t.id === taskId);
    if (!task || task.status === 'completed') return false;

    task.status = 'in_progress';
    todoList.current_task_id = taskId;
    todoList.updated_at = Date.now();
    return true;
  }

  completeTask(todoId: string, taskId: string, note?: string): TodoList | null {
    const todoList = this.todoLists.get(todoId);
    if (!todoList) return null;

    const task = todoList.tasks.find(t => t.id === taskId);
    if (!task) return null;

    // 若当前不是进行中，也允许直接标记完成
    task.status = 'completed';
    task.completed_at = Date.now();
    if (note) task.completion_note = note;

    // 简化：假设不会重复调用完成
    todoList.completed_tasks = Math.min(todoList.total_tasks, todoList.completed_tasks + 1);
    todoList.updated_at = Date.now();

    // 自动开始下一个任务
    const nextTask = todoList.tasks.find(t => t.status === 'pending');
    if (nextTask) {
      this.startTask(todoId, nextTask.id);
    } else {
      todoList.current_task_id = undefined;
    }

    return todoList;
  }

  addTask(todoId: string, content: string): TodoList | null {
    const todoList = this.todoLists.get(todoId);
    if (!todoList) return null;

    const newTask: TodoTask = {
      id: `task_${todoId}_${Date.now()}`,
      content,
      status: 'pending',
      created_at: Date.now()
    };

    todoList.tasks.push(newTask);
    todoList.total_tasks += 1;
    todoList.updated_at = Date.now();
    return todoList;
  }

  getActiveTodoList(): TodoList | null {
    return this.activeTodoId ? (this.todoLists.get(this.activeTodoId) || null) : null;
  }

  getTodoListById(todoId: string): TodoList | null {
    return this.todoLists.get(todoId) || null;
  }

  hasIncompleteTasks(todoId: string): boolean {
    const todoList = this.todoLists.get(todoId);
    if (!todoList) return false;
    return todoList.completed_tasks < todoList.total_tasks;
  }
}


