import React from 'react';
import { CheckCircle, Circle, Clock } from 'lucide-react';
import { TodoList, TodoTask } from '@/types/todo';

interface TodoDisplayProps {
  todoList: TodoList;
  isCollapsed?: boolean;
}

export function TodoDisplay({ todoList, isCollapsed = false }: TodoDisplayProps) {
  const getTaskIcon = (task: TodoTask) => {
    switch (task.status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'pending':
        return <Circle className="w-4 h-4 text-gray-400" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTaskStyle = (task: TodoTask) => {
    const baseStyle = 'flex items-center gap-2 p-2 rounded text-sm';
    switch (task.status) {
      case 'completed':
        return `${baseStyle} bg-green-50 text-green-800 line-through`;
      case 'in_progress':
        return `${baseStyle} bg-blue-50 text-blue-800 font-medium`;
      case 'pending':
        return `${baseStyle} bg-gray-50 text-gray-600`;
      default:
        return baseStyle;
    }
  };

  const progress = todoList.total_tasks > 0
    ? (todoList.completed_tasks / todoList.total_tasks) * 100
    : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center min-w-0">
          <h3 className="font-medium text-gray-900 truncate pr-2">{todoList.title}</h3>
          <span className="text-[11px] text-gray-500 flex-shrink-0">
            {todoList.completed_tasks}/{todoList.total_tasks}
          </span>
        </div>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!isCollapsed && (
        <div className="space-y-1">
          {todoList.tasks.map((task) => (
            <div key={task.id} className={getTaskStyle(task)}>
              {getTaskIcon(task)}
              <span className="flex-1">{task.content}</span>
            </div>
          ))}
        </div>
      )}

      {todoList.completed_tasks === todoList.total_tasks && todoList.total_tasks > 0 && (
        <div className="mt-2 p-2 bg-green-100 border border-green-200 rounded text-green-800 text-xs">
          🎉 所有任务已完成！
        </div>
      )}
    </div>
  );
}


