import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Lock, CheckCircle2, Calendar, GitFork, Sparkles, Clock, AlertCircle } from 'lucide-react';
import { formatDateDisplay } from '../utils/dateUtils';

export default function TaskCard({
  task,
  index,
  onClick,
  isCriticalPath
}) {
  const isBlocked = task.dependency_status === 'blocked';
  const hasPrereqs = task.prerequisites && task.prerequisites.length > 0;
  const hasDependents = task.dependents && task.dependents.length > 0;

  // Identify unmet prerequisites
  const unmetPrereqs = (task.prerequisites || []).filter(
    p => p.prereq_column_status !== 'done'
  );

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(task)}
          className={`group relative rounded-xl p-4 transition-all duration-200 cursor-pointer select-none border ${
            snapshot.isDragging
              ? 'bg-slate-800 border-teal-500 shadow-2xl scale-105 rotate-1 z-50'
              : isCriticalPath
              ? 'bg-slate-900/90 border-amber-500/80 hover:border-amber-400 glow-amber'
              : isBlocked
              ? 'bg-slate-900/80 border-slate-800 hover:border-rose-800/60'
              : 'bg-slate-900/90 border-slate-800 hover:border-teal-700/60 hover:shadow-lg'
          }`}
        >
          {/* Critical Path Indicator Banner */}
          {isCriticalPath && (
            <div className="absolute -top-2.5 right-3 bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              Critical Path
            </div>
          )}

          {/* Header & Badges */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                isBlocked
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}
            >
              {isBlocked ? (
                <>
                  <Lock className="w-3 h-3" />
                  Blocked ({unmetPrereqs.length})
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Ready
                </>
              )}
            </span>

            {task.base_duration_days && (
              <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                {task.base_duration_days}d
              </span>
            )}
          </div>

          {/* Title */}
          <h4 className="text-sm font-semibold text-slate-100 group-hover:text-teal-300 transition-colors line-clamp-2 leading-snug mb-1.5">
            {task.title}
          </h4>

          {/* Description */}
          {task.description && (
            <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">
              {task.description}
            </p>
          )}

          {/* Unmet Prerequisites Warning Tooltip Banner */}
          {isBlocked && unmetPrereqs.length > 0 && (
            <div className="mb-2.5 px-2.5 py-1.5 rounded-lg bg-rose-950/40 border border-rose-900/50 text-[11px] text-rose-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-rose-400" />
              <div className="truncate">
                Waiting on: <span className="font-medium text-rose-200">{unmetPrereqs.map(p => p.prereq_title).join(', ')}</span>
              </div>
            </div>
          )}

          {/* Card Footer: Dates & Graph Edge Counts */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-1 text-[11px]">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>{formatDateDisplay(task.start_date)} - {formatDateDisplay(task.end_date)}</span>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              {hasPrereqs && (
                <span
                  title={`${task.prerequisites.length} prerequisite(s)`}
                  className="flex items-center gap-1 text-slate-400 hover:text-slate-300"
                >
                  <GitFork className="w-3 h-3 rotate-180 text-teal-400" />
                  {task.prerequisites.length}
                </span>
              )}
              {hasDependents && (
                <span
                  title={`${task.dependents.length} dependent task(s)`}
                  className="flex items-center gap-1 text-slate-400 hover:text-slate-300"
                >
                  <GitFork className="w-3 h-3 text-indigo-400" />
                  {task.dependents.length}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
