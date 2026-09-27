import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import KanbanBoard from './components/KanbanBoard';
import DependencyGraphView from './components/DependencyGraphView';
import TaskModal from './components/TaskModal';
import AuditLogModal from './components/AuditLogModal';
import Toast from './components/Toast';
import {
  fetchTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  fetchCriticalPath,
  resetDemoData
} from './services/api';
import { Sparkles, Info, RefreshCw } from 'lucide-react';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('kanban'); // 'kanban' | 'graph'
  const [selectedTask, setSelectedTask] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [criticalPathActive, setCriticalPathActive] = useState(false);
  const [criticalPathData, setCriticalPathData] = useState({ criticalPathTaskIds: [], totalDurationDays: 0 });
  const [toasts, setToasts] = useState([]);

  // Toast Helper
  const addToast = useCallback(({ type = 'info', title = '', message = '' }) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Load Tasks
  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks();
      setTasks(data || []);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Connection Error',
        message: err.message || 'Could not load tasks from server.'
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Load Critical Path
  const loadCriticalPath = useCallback(async () => {
    try {
      const cp = await fetchCriticalPath();
      setCriticalPathData(cp);
    } catch (err) {
      console.warn('Could not compute critical path:', err);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadCriticalPath();
  }, [loadTasks, loadCriticalPath]);

  // Drag and Drop Handler with DAG blocking enforcement
  const handleTaskMove = async ({ taskId, task, sourceColumn, destinationColumn, destinationIndex }) => {
    // Edge case check: blocked task dragged to in_progress / review / done
    if (destinationColumn !== 'backlog' && task.dependency_status === 'blocked') {
      const unmet = (task.prerequisites || []).filter(p => p.prereq_column_status !== 'done');
      const unmetNames = unmet.map(p => `"${p.prereq_title}" (${p.prereq_column_status.replace('_', ' ')})`).join(', ');

      addToast({
        type: 'error',
        title: 'Action Blocked by DAG Engine',
        message: `Task "${task.title}" is BLOCKED. You cannot move it to "${destinationColumn.replace('_', ' ')}" until prerequisites are done: ${unmetNames || 'Incomplete prerequisites'}.`
      });
      return;
    }

    // Optimistic UI update
    const previousTasks = [...tasks];
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          column_status: destinationColumn,
          position: destinationIndex
        };
      }
      return t;
    });
    setTasks(updated);

    try {
      await moveTask(taskId, destinationColumn, destinationIndex);
      // Refetch to sync downstream cascade statuses (e.g. dependent tasks transitioning from blocked -> ready or ready -> blocked)
      await loadTasks();
      await loadCriticalPath();
    } catch (err) {
      // Revert optimistic update on failure
      setTasks(previousTasks);
      addToast({
        type: 'error',
        title: 'Move Rejected',
        message: err.message
      });
    }
  };

  // Task Modal Handlers
  const handleOpenTask = (task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleNewTask = (columnId = 'backlog') => {
    setSelectedTask({
      title: '',
      description: '',
      column_status: typeof columnId === 'string' ? columnId : 'backlog',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      base_duration_days: 1,
      prerequisites: [],
      dependents: []
    });
    setIsModalOpen(true);
  };

  const handleSaveTask = async (taskData) => {
    try {
      if (taskData.id) {
        await updateTask(taskData.id, taskData);
        addToast({ type: 'success', title: 'Task Updated', message: `Saved changes to "${taskData.title}".` });
      } else {
        await createTask(taskData);
        addToast({ type: 'success', title: 'Task Created', message: `Created "${taskData.title}".` });
      }
      setIsModalOpen(false);
      await loadTasks();
      await loadCriticalPath();
    } catch (err) {
      addToast({ type: 'error', title: 'Save Failed', message: err.message });
      throw err;
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task? Downstream dependencies will be updated.')) {
      return;
    }

    try {
      await deleteTask(taskId);
      addToast({ type: 'info', title: 'Task Deleted', message: 'Task deleted and graph recomputed.' });
      setIsModalOpen(false);
      await loadTasks();
      await loadCriticalPath();
    } catch (err) {
      addToast({ type: 'error', title: 'Delete Failed', message: err.message });
    }
  };

  const handleResetDemo = async () => {
    if (!window.confirm('Reset database to initial demo state? (9 tasks with diamond convergence graph)')) {
      return;
    }

    try {
      await resetDemoData();
      addToast({
        type: 'success',
        title: 'Demo State Reset',
        message: 'Loaded 9 realistic tasks with diamond convergence graph.'
      });
      await loadTasks();
      await loadCriticalPath();
    } catch (err) {
      addToast({ type: 'error', title: 'Reset Error', message: err.message });
    }
  };

  const handleToggleCriticalPath = () => {
    const nextState = !criticalPathActive;
    setCriticalPathActive(nextState);
    if (nextState) {
      addToast({
        type: 'info',
        title: 'Critical Path Active',
        message: `Highlighting longest dependency chain (${criticalPathData.totalDurationDays} days total duration).`
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Navigation Header */}
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        criticalPathActive={criticalPathActive}
        onToggleCriticalPath={handleToggleCriticalPath}
        criticalPathDuration={criticalPathData.totalDurationDays}
        onOpenAuditLogs={() => setIsAuditModalOpen(true)}
        onResetDemo={handleResetDemo}
        onNewTask={() => handleNewTask('backlog')}
        tasksCount={tasks.length}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
        
        {/* Banner with quick stats and DAG engine indicator */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-4">
            <span className="text-slate-400">
              Total Tasks: <strong className="text-slate-200">{tasks.length}</strong>
            </span>
            <span className="text-slate-400">
              Ready: <strong className="text-emerald-400">{tasks.filter(t => t.dependency_status === 'ready').length}</strong>
            </span>
            <span className="text-slate-400">
              Blocked: <strong className="text-rose-400">{tasks.filter(t => t.dependency_status === 'blocked').length}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Gemini AI Suggestions: <span className="text-slate-200">Active</span>
            </span>
            <span>•</span>
            <span>Cycle Prevention: <span className="text-teal-400 font-medium">Enforced</span></span>
          </div>
        </div>

        {/* View Rendering */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-teal-500 mb-3" />
            <p className="text-sm font-medium">Loading DAG Engine and tasks...</p>
          </div>
        ) : currentView === 'kanban' ? (
          <div className="flex-1">
            <KanbanBoard
              tasks={tasks}
              onTaskMove={handleTaskMove}
              onTaskClick={handleOpenTask}
              onAddTask={handleNewTask}
              criticalPathTaskIds={criticalPathActive ? criticalPathData.criticalPathTaskIds : []}
            />
          </div>
        ) : (
          <div className="flex-1">
            <DependencyGraphView
              tasks={tasks}
              onTaskClick={handleOpenTask}
              criticalPathTaskIds={criticalPathActive ? criticalPathData.criticalPathTaskIds : []}
            />
          </div>
        )}
      </main>

      {/* Task Edit / Create Modal */}
      <TaskModal
        task={selectedTask}
        allTasks={tasks}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onGraphUpdate={async () => {
          await loadTasks();
          await loadCriticalPath();
        }}
        addToast={addToast}
      />

      {/* Audit Log Modal */}
      <AuditLogModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />

      {/* Toast Notifications */}
      <Toast toasts={toasts} onClose={removeToast} />
    </div>
  );
}
