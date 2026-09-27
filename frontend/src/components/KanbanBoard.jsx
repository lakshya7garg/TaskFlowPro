import React from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import KanbanColumn from './KanbanColumn';

const COLUMNS = ['backlog', 'in_progress', 'review', 'done'];

export default function KanbanBoard({
  tasks,
  onTaskMove,
  onTaskClick,
  onAddTask,
  criticalPathTaskIds = []
}) {
  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const task = tasks.find(t => t.id === draggableId);
    if (!task) return;

    onTaskMove({
      taskId: draggableId,
      task,
      sourceColumn: source.droppableId,
      destinationColumn: destination.droppableId,
      destinationIndex: destination.index
    });
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 pt-1 h-full items-start">
        {COLUMNS.map(columnId => {
          const columnTasks = tasks
            .filter(t => (t.column_status || 'backlog') === columnId)
            .sort((a, b) => (a.position || 0) - (b.position || 0));

          return (
            <KanbanColumn
              key={columnId}
              columnId={columnId}
              tasks={columnTasks}
              onTaskClick={onTaskClick}
              onAddTask={onAddTask}
              criticalPathTaskIds={criticalPathTaskIds}
            />
          );
        })}
      </div>
    </DragDropContext>
  );
}
