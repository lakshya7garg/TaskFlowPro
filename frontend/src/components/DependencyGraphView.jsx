import React, { useMemo } from 'react';
import { Lock, CheckCircle2, Clock, GitFork, ArrowRight } from 'lucide-react';

export default function DependencyGraphView({
  tasks = [],
  onTaskClick,
  criticalPathTaskIds = []
}) {
  // Build topological layer layout for clean horizontal DAG visualization
  const { nodeLayout, edges } = useMemo(() => {
    if (!tasks || tasks.length === 0) {
      return { nodeLayout: [], edges: [] };
    }

    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const inDegrees = new Map();
    const downstream = new Map();

    for (const t of tasks) {
      inDegrees.set(t.id, 0);
      downstream.set(t.id, []);
    }

    const edgeList = [];
    for (const t of tasks) {
      for (const p of t.prerequisites || []) {
        edgeList.push({
          id: `${p.prereq_id}->${t.id}`,
          from: p.prereq_id,
          to: t.id,
          isCritical: criticalPathTaskIds.includes(p.prereq_id) && criticalPathTaskIds.includes(t.id)
        });
        if (downstream.has(p.prereq_id)) {
          downstream.get(p.prereq_id).push(t.id);
        }
        inDegrees.set(t.id, (inDegrees.get(t.id) || 0) + 1);
      }
    }

    // Compute layer depth (X rank) using longest path from root
    const layer = new Map();
    const queue = [];

    for (const t of tasks) {
      if ((inDegrees.get(t.id) || 0) === 0) {
        layer.set(t.id, 0);
        queue.push(t.id);
      }
    }

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLayer = layer.get(curr) || 0;

      for (const childId of downstream.get(curr) || []) {
        const existingChildLayer = layer.get(childId) || 0;
        if (currLayer + 1 > existingChildLayer) {
          layer.set(childId, currLayer + 1);
          queue.push(childId);
        }
      }
    }

    // Default any disconnected tasks
    for (const t of tasks) {
      if (!layer.has(t.id)) layer.set(t.id, 0);
    }

    // Group tasks by layer
    const maxLayer = Math.max(0, ...Array.from(layer.values()));
    const layers = Array.from({ length: maxLayer + 1 }, () => []);

    for (const t of tasks) {
      const l = layer.get(t.id) || 0;
      layers[l].push(t);
    }

    // Calculate (X, Y) coordinates for SVG
    const colWidth = 260;
    const rowHeight = 120;
    const paddingX = 40;
    const paddingY = 40;

    const layout = [];
    const coordMap = new Map();

    layers.forEach((layerTasks, colIndex) => {
      const totalColHeight = layerTasks.length * rowHeight;
      const startY = paddingY + Math.max(0, (500 - totalColHeight) / 2);

      layerTasks.forEach((t, rowIndex) => {
        const x = paddingX + colIndex * colWidth;
        const y = startY + rowIndex * rowHeight;
        coordMap.set(t.id, { x, y, width: 200, height: 80 });
        layout.push({
          task: t,
          x,
          y,
          width: 200,
          height: 80,
          isCritical: criticalPathTaskIds.includes(t.id)
        });
      });
    });

    const renderedEdges = edgeList.map(e => {
      const fromPos = coordMap.get(e.from);
      const toPos = coordMap.get(e.to);
      if (!fromPos || !toPos) return null;

      const startX = fromPos.x + fromPos.width;
      const startY = fromPos.y + fromPos.height / 2;
      const endX = toPos.x;
      const endY = toPos.y + toPos.height / 2;
      const controlX = startX + (endX - startX) / 2;

      const path = `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;

      return {
        ...e,
        path,
        startX,
        startY,
        endX,
        endY
      };
    }).filter(Boolean);

    return { nodeLayout: layout, edges: renderedEdges };
  }, [tasks, criticalPathTaskIds]);

  const maxSvgWidth = Math.max(900, (nodeLayout.length > 0 ? Math.max(...nodeLayout.map(n => n.x + n.width)) : 800) + 80);
  const maxSvgHeight = Math.max(560, (nodeLayout.length > 0 ? Math.max(...nodeLayout.map(n => n.y + n.height)) : 500) + 80);

  const getStatusBorder = (status, isBlocked, isCritical) => {
    if (isCritical) return 'stroke-amber-400 stroke-2';
    if (isBlocked) return 'stroke-rose-500/80 stroke-1.5';
    if (status === 'done') return 'stroke-emerald-500/80 stroke-1.5';
    if (status === 'in_progress') return 'stroke-sky-500/80 stroke-1.5';
    return 'stroke-slate-700 stroke-1';
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'done': return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
      case 'in_progress': return 'bg-sky-950/80 text-sky-300 border-sky-800';
      case 'review': return 'bg-amber-950/80 text-amber-300 border-amber-800';
      default: return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="w-full bg-slate-900/40 rounded-2xl border border-slate-800/80 p-5 backdrop-blur-sm">
      {/* Visualizer Legend */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800 mb-4">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-teal-400" />
          <h3 className="font-semibold text-sm text-slate-200">DAG Dependency Graph Visualizer</h3>
          <span className="text-xs text-slate-500 ml-2">({tasks.length} Nodes, {edges.length} Edges)</span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-3 rounded bg-emerald-500/40 border border-emerald-400 inline-block" />
            <span>Done</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-3 rounded bg-sky-500/40 border border-sky-400 inline-block" />
            <span>In Progress</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-3 rounded bg-slate-800 border border-rose-500 inline-block" />
            <span>Blocked Node</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-300 font-medium">
            <span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-400 inline-block" />
            <span>Critical Path</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div className="w-full overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] border border-slate-800/60 rounded-xl bg-slate-950/60 p-4 relative">
        <svg
          width={maxSvgWidth}
          height={maxSvgHeight}
          className="min-w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Standard Arrow Marker */}
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0d9488" />
            </marker>

            {/* Critical Path Arrow Marker */}
            <marker
              id="arrow-critical"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* Render Directed Edges */}
          {edges.map(e => (
            <path
              key={e.id}
              d={e.path}
              fill="none"
              stroke={e.isCritical ? '#f59e0b' : '#14b8a6'}
              strokeWidth={e.isCritical ? '2.5' : '1.5'}
              strokeOpacity={e.isCritical ? '0.9' : '0.4'}
              markerEnd={e.isCritical ? 'url(#arrow-critical)' : 'url(#arrow)'}
              strokeDasharray={e.isCritical ? 'none' : 'none'}
              className="transition-all duration-300"
            />
          ))}

          {/* Render Nodes as foreignObjects for rich HTML/React interaction */}
          {nodeLayout.map(({ task, x, y, width, height, isCritical }) => {
            const isBlocked = task.dependency_status === 'blocked';
            return (
              <foreignObject
                key={task.id}
                x={x}
                y={y}
                width={width}
                height={height}
                className="overflow-visible cursor-pointer"
                onClick={() => onTaskClick(task)}
              >
                <div
                  className={`w-full h-full p-2.5 rounded-xl transition-all duration-200 shadow-lg flex flex-col justify-between border ${
                    isCritical
                      ? 'bg-slate-900 border-amber-400 glow-amber'
                      : isBlocked
                      ? 'bg-slate-900/95 border-rose-600/80 hover:border-rose-400'
                      : task.column_status === 'done'
                      ? 'bg-slate-900/90 border-emerald-600/60 hover:border-emerald-400'
                      : 'bg-slate-900/90 border-slate-700 hover:border-teal-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase ${getStatusBadgeClass(task.column_status)}`}>
                      {task.column_status.replace('_', ' ')}
                    </span>

                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-full flex items-center gap-0.5 ${
                        isBlocked
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {isBlocked ? <Lock className="w-2 h-2" /> : <CheckCircle2 className="w-2 h-2" />}
                      {isBlocked ? 'Blocked' : 'Ready'}
                    </span>
                  </div>

                  <div className="text-[11px] font-medium text-slate-100 truncate mt-1">
                    {task.title}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>{task.base_duration_days}d</span>
                    <span>{task.prerequisites?.length || 0} in / {task.dependents?.length || 0} out</span>
                  </div>
                </div>
              </foreignObject>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
