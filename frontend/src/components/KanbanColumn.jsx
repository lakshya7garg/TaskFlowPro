import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Plus, ListTodo, PlayCircle, Search, CheckCircle } from 'lucide-react';
import TaskCard from './TaskCard';

const columnConfig = {
  backlog: {
    title: 'Backlog',
    icon: ListTodo,
    color: 'text-slate-400',
    border: 'border-slate-700/60',
    badge: 'bg-slate-800 text-slate-300'
  },
  in_progress: {
    title: 'In Progress',
    icon: PlayCircle,
    color: 'text-sky-400',
    border: 'border-sky-800/40',
    badge: 'bg-sky-950 text-sky-300 border border-sky-800'
  },
  review: {
    title: 'Review',
    icon: Search,
    color: 'text-amber-400',
    border: 'border-amber-800/40',
    badge: 'bg-amber-950 text-amber-300 border border-amber-800'
  },
  done: {
    title: 'Done',
    icon: CheckCircle,
    color: 'text-emerald-400',
    border: 'border-emerald-800/40',
    badge: 'bg-emerald-950 text-emerald-300 border border-emerald-800'
  }
};

export default function KanbanColumn({
  columnId,
  tasks,
  onTaskClick,
  onAddTask,
  criticalPathTaskIds = []
}) {
  const config = columnConfig[columnId] || columnConfig.backlog;
  const Icon = config.icon;

  return (
    <div className="flex flex-col rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-sm h-[calc(100vh-180px)] min-w-[300px] w-full max-w-sm flex-1">
      {/* Column Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${config.color}`} />
          <h3 className="font-semibold text-sm text-slate-200 tracking-wide">
            {config.title}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
            {tasks.length}
          </span>
        </div>

        <button
          onClick={() => onAddTask(columnId)}
          title="Add task to column"
          className="p-1 rounded-lg text-slate-400 hover:text-teal-400 hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Droppable Task List Area */}
      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-3 overflow-y-auto flex flex-col gap-3 transition-colors duration-150 ${
              snapshot.isDraggingOver
                ? 'bg-slate-800/40 rounded-b-2xl border-2 border-dashed border-teal-500/50'
                : ''
            }`}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                onClick={onTaskClick}
                isCriticalPath={criticalPathTaskIds.includes(task.id)}
              />
            ))}
            {provided.placeholder}

            {tasks.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 border border-dashed border-slate-800/60 rounded-xl m-2">
                <Icon className="w-8 h-8 opacity-20 mb-2" />
                <p className="text-xs">No tasks in {config.title.toLowerCase()}</p>
                <button
                  onClick={() => onAddTask(columnId)}
                  className="mt-3 text-xs text-teal-400 hover:text-teal-300 font-medium flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add a task
                </button>
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
