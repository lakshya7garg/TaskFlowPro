import React from 'react';
import {
  GitFork,
  LayoutGrid,
  Network,
  Clock,
  History,
  RotateCcw,
  Plus,
  Sparkles,
  Layers
} from 'lucide-react';

export default function Navbar({
  currentView,
  setCurrentView,
  criticalPathActive,
  onToggleCriticalPath,
  criticalPathDuration,
  onOpenAuditLogs,
  onResetDemo,
  onNewTask,
  tasksCount = 0
}) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <GitFork className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-white">
                TaskFlow <span className="text-teal-400">Pro</span>
              </h1>
              <span className="text-[10px] font-semibold bg-teal-500/10 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded-full">
                DAG Engine
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Dependency-Aware Kanban & Graph Workflow Platform
            </p>
          </div>
        </div>

        {/* View Switcher (Kanban vs DAG Graph) */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => setCurrentView('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentView === 'kanban'
                ? 'bg-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Kanban</span>
          </button>
          <button
            onClick={() => setCurrentView('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentView === 'graph'
                ? 'bg-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>DAG Graph</span>
          </button>
        </div>

        {/* Right Tools & Actions */}
        <div className="flex items-center gap-2">
          {/* Critical Path Toggle Button */}
          <button
            onClick={onToggleCriticalPath}
            title="Toggle Critical Path analysis"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              criticalPathActive
                ? 'bg-amber-500/20 border-amber-500/80 text-amber-300 glow-amber'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <Clock className={`w-3.5 h-3.5 ${criticalPathActive ? 'text-amber-400' : 'text-slate-400'}`} />
            <span className="hidden md:inline">Critical Path</span>
            {criticalPathActive && criticalPathDuration > 0 && (
              <span className="bg-amber-500 text-slate-950 font-bold text-[10px] px-1.5 py-0.2 rounded-full ml-1">
                {criticalPathDuration}d
              </span>
            )}
          </button>

          {/* Audit Logs Button */}
          <button
            onClick={onOpenAuditLogs}
            title="View Schedule Propagation Audit Logs"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
          >
            <History className="w-4 h-4 text-indigo-400" />
          </button>

          {/* Reset Demo Data Button */}
          <button
            onClick={onResetDemo}
            title="Reset to Initial Seed Demo State (9 tasks + diamond graph)"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-teal-300 hover:border-slate-700 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* New Task Button */}
          <button
            onClick={onNewTask}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-lg shadow-teal-600/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </button>
        </div>
      </div>
    </header>
  );
}
