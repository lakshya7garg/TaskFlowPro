import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  CheckCircle2,
  Calendar,
  GitFork,
  Sparkles,
  Trash2,
  Plus,
  ArrowRight,
  Clock,
  AlertTriangle,
  History,
  Info
} from 'lucide-react';
import {
  addDependency,
  removeDependency,
  fetchAiSuggestions,
  generateAiSuggestions,
  acceptAiSuggestion,
  rejectAiSuggestion,
  rescheduleTask
} from '../services/api';
import { formatDateInput } from '../utils/dateUtils';

export default function TaskModal({
  task,
  allTasks = [],
  isOpen,
  onClose,
  onSave,
  onDelete,
  onGraphUpdate,
  addToast
}) {
  const [activeTab, setActiveTab] = useState('details'); // details | dependencies | ai | schedule
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnStatus, setColumnStatus] = useState('backlog');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [baseDurationDays, setBaseDurationDays] = useState(1);
  const [selectedPrereqId, setSelectedPrereqId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [propagatingSchedule, setPropagatingSchedule] = useState(false);

  const isNew = !task?.id;

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setColumnStatus(task.column_status || 'backlog');
      setStartDate(formatDateInput(task.start_date));
      setEndDate(formatDateInput(task.end_date));
      setBaseDurationDays(task.base_duration_days || 1);
      setSelectedPrereqId('');

      if (task.id) {
        loadSuggestions(task.id);
      }
    }
  }, [task]);

  const loadSuggestions = async (taskId) => {
    try {
      const sugs = await fetchAiSuggestions(taskId);
      setSuggestions(sugs || []);
    } catch (err) {
      console.warn('Could not load suggestions:', err);
    }
  };

  if (!isOpen) return null;

  // Available candidate tasks to add as prerequisites (excluding self and already direct prerequisites)
  const existingPrereqIds = new Set((task?.prerequisites || []).map(p => p.prereq_id));
  const candidatePrereqs = allTasks.filter(
    t => t.id !== task?.id && !existingPrereqIds.has(t.id)
  );

  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      addToast({ type: 'error', title: 'Validation Error', message: 'Task title is required.' });
      return;
    }

    try {
      await onSave({
        id: task?.id,
        title: title.trim(),
        description: description.trim(),
        column_status: columnStatus,
        start_date: startDate || null,
        end_date: endDate || null,
        base_duration_days: parseInt(baseDurationDays, 10) || 1
      });
    } catch (err) {
      // Toast handled by parent
    }
  };

  const handleAddDependency = async () => {
    if (!selectedPrereqId) return;

    try {
      const res = await addDependency(task.id, selectedPrereqId, 'manual');
      addToast({
        type: 'success',
        title: 'Dependency Established',
        message: res.message || 'Dependency added successfully.'
      });
      setSelectedPrereqId('');
      if (onGraphUpdate) await onGraphUpdate();
    } catch (err) {
      if (err.cycleDetected) {
        addToast({
          type: 'error',
          title: 'Cycle Detection Reject',
          message: err.message
        });
      } else {
        addToast({
          type: 'error',
          title: 'Failed to Add Dependency',
          message: err.message
        });
      }
    }
  };

  const handleRemoveDependency = async (depId) => {
    try {
      await removeDependency(depId);
      addToast({
        type: 'info',
        title: 'Dependency Removed',
        message: 'Prerequisite dependency removed. Status recomputed.'
      });
      if (onGraphUpdate) await onGraphUpdate();
    } catch (err) {
      addToast({ type: 'error', title: 'Error', message: err.message });
    }
  };

  const handleGenerateAiSuggestions = async () => {
    if (!task?.id) return;
    setLoadingAi(true);
    try {
      const res = await generateAiSuggestions(task.id);
      addToast({
        type: 'success',
        title: 'AI Analysis Complete',
        message: res.message
      });
      await loadSuggestions(task.id);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'AI Suggestion Error',
        message: err.message
      });
    } finally {
      setLoadingAi(false);
    }
  };

  const handleAcceptSuggestion = async (sugId) => {
    try {
      const res = await acceptAiSuggestion(sugId);
      addToast({
        type: 'success',
        title: 'Suggestion Accepted',
        message: res.message
      });
      await loadSuggestions(task.id);
      if (onGraphUpdate) await onGraphUpdate();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Acceptance Rejected',
        message: err.message
      });
    }
  };

  const handleRejectSuggestion = async (sugId) => {
    try {
      await rejectAiSuggestion(sugId);
      addToast({
        type: 'info',
        title: 'Suggestion Rejected',
        message: 'Marked as rejected.'
      });
      await loadSuggestions(task.id);
    } catch (err) {
      addToast({ type: 'error', title: 'Error', message: err.message });
    }
  };

  const handlePropagateScheduleNow = async () => {
    if (!task?.id || !endDate) return;
    setPropagatingSchedule(true);
    try {
      const res = await rescheduleTask(task.id, startDate, endDate, 1);
      addToast({
        type: 'success',
        title: 'No-Compounding Schedule Propagated',
        message: res.message
      });
      if (onGraphUpdate) await onGraphUpdate();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Schedule Propagation Failed',
        message: err.message
      });
    } finally {
      setPropagatingSchedule(false);
    }
  };

  const isBlocked = task?.dependency_status === 'blocked';
  const unmetPrereqs = (task?.prerequisites || []).filter(p => p.prereq_column_status !== 'done');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                isBlocked
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}
            >
              {isBlocked ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  Blocked ({unmetPrereqs.length} prerequisite(s) pending)
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ready to Start
                </>
              )}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {isNew ? 'New Task' : `ID: ${task.id.slice(0, 8)}...`}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        {!isNew && (
          <div className="flex border-b border-slate-800 bg-slate-950/40 px-5 gap-4">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-teal-400 text-teal-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Task Details
            </button>
            <button
              onClick={() => setActiveTab('dependencies')}
              className={`py-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'dependencies'
                  ? 'border-teal-400 text-teal-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitFork className="w-3.5 h-3.5" />
              DAG Dependencies ({task?.prerequisites?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`py-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'ai'
                  ? 'border-teal-400 text-teal-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              AI Suggestions
              {suggestions.filter(s => s.status === 'pending').length > 0 && (
                <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded-full text-[10px]">
                  {suggestions.filter(s => s.status === 'pending').length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'details' && (
            <form onSubmit={handleSaveDetails} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Design DB Schema & System Architecture"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed task specifications and requirements..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Column Status
                  </label>
                  <select
                    value={columnStatus}
                    onChange={(e) => setColumnStatus(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Base Duration (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={baseDurationDays}
                    onChange={(e) => setBaseDurationDays(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              {/* Schedule Propagation Action */}
              {!isNew && (
                <div className="mt-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">Schedule Propagation:</span> Shifting dates calculates max-slack across converging DAG paths without compounding.
                  </div>
                  <button
                    type="button"
                    onClick={handlePropagateScheduleNow}
                    disabled={propagatingSchedule || !endDate}
                    className="flex-shrink-0 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-indigo-100 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {propagatingSchedule ? 'Propagating...' : 'Propagate Schedule'}
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 mt-2 border-t border-slate-800 flex items-center justify-between">
                {!isNew ? (
                  <button
                    type="button"
                    onClick={() => onDelete(task.id)}
                    className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 py-2 px-3 rounded-lg hover:bg-rose-950/40 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Task
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-slate-400 hover:text-white px-4 py-2 rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="text-xs bg-teal-600 hover:bg-teal-500 text-white font-medium px-5 py-2 rounded-xl shadow-lg transition-colors"
                  >
                    {isNew ? 'Create Task' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeTab === 'dependencies' && (
            <div className="flex flex-col gap-5">
              {/* Add New Prerequisite Section */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-teal-400" />
                  Add Prerequisite Dependency
                </h4>
                <div className="flex gap-2">
                  <select
                    value={selectedPrereqId}
                    onChange={(e) => setSelectedPrereqId(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  >
                    <option value="">Select a prerequisite task this task depends on...</option>
                    {candidatePrereqs.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.column_status.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddDependency}
                    disabled={!selectedPrereqId}
                    className="bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    Add Edge
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
                  <Info className="w-3 h-3 text-slate-400" />
                  Cycle check DFS runs before persisting. Adding a circular dependency will be automatically rejected.
                </p>
              </div>

              {/* Current Direct Prerequisites */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                  Direct Prerequisites ({task?.prerequisites?.length || 0})
                </h4>

                {(!task?.prerequisites || task.prerequisites.length === 0) ? (
                  <div className="text-xs text-slate-500 bg-slate-950/40 p-4 rounded-xl border border-dashed border-slate-800 text-center">
                    No prerequisites configured. This task is ready to start anytime.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {task.prerequisites.map(p => {
                      const isPrereqDone = p.prereq_column_status === 'done';
                      return (
                        <div
                          key={p.dependency_id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`w-2.5 h-2.5 rounded-full ${
                                isPrereqDone ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'
                              }`}
                            />
                            <div>
                              <div className="text-xs font-semibold text-slate-200">
                                {p.prereq_title}
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                                <span>Status: <strong className={isPrereqDone ? 'text-emerald-400' : 'text-rose-300'}>{p.prereq_column_status}</strong></span>
                                <span>•</span>
                                <span className="capitalize text-slate-400 font-mono text-[10px]">source: {p.source}</span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveDependency(p.dependency_id)}
                            title="Remove dependency"
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Downstream Dependents */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                  Downstream Dependents ({task?.dependents?.length || 0})
                </h4>

                {(!task?.dependents || task.dependents.length === 0) ? (
                  <div className="text-xs text-slate-500 bg-slate-950/40 p-4 rounded-xl border border-dashed border-slate-800 text-center">
                    No downstream tasks depend on this task yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {task.dependents.map(d => (
                      <div
                        key={d.dependency_id}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-xs font-medium text-slate-200">{d.dependent_title}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 capitalize">{d.dependent_column_status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="flex flex-col gap-5">
              <div className="p-4 bg-gradient-to-r from-teal-950/40 to-indigo-950/40 border border-teal-800/40 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-teal-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    AI-Augmented Dependency Suggestion
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Analyzes semantic meaning and prerequisite workflows with Google Gemini. Suggestions require explicit acceptance and pass cycle validation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateAiSuggestions}
                  disabled={loadingAi}
                  className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg transition-colors flex items-center gap-2 flex-shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {loadingAi ? 'Analyzing DAG...' : 'Suggest Dependencies'}
                </button>
              </div>

              {/* Suggestions List */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  AI Suggestions ({suggestions.length})
                </h4>

                {suggestions.length === 0 ? (
                  <div className="text-xs text-slate-500 bg-slate-950/40 p-6 rounded-xl border border-dashed border-slate-800 text-center">
                    No suggestions yet. Click "Suggest Dependencies" to analyze the project graph.
                  </div>
                ) : (
                  suggestions.map(sug => {
                    const isPending = sug.status === 'pending';
                    const isAccepted = sug.status === 'accepted';
                    const isRejected = sug.status === 'rejected';

                    return (
                      <div
                        key={sug.id}
                        className={`p-4 rounded-xl border transition-all ${
                          isAccepted
                            ? 'bg-emerald-950/20 border-emerald-800/50'
                            : isRejected
                            ? 'bg-slate-950/30 border-slate-800 opacity-60'
                            : 'bg-slate-950/90 border-slate-700/80 shadow-md'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                                sug.confidence === 'high'
                                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                                  : sug.confidence === 'medium'
                                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                                  : 'bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                            >
                              {sug.confidence || 'medium'} confidence
                            </span>

                            <span className="text-xs font-semibold text-slate-200">
                              Depends on: <span className="text-teal-300">{sug.suggested_prereq_title}</span>
                            </span>
                          </div>

                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                            {sug.status}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 italic mb-3 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                          "{sug.rationale || 'Suggested logical workflow sequence.'}"
                        </p>

                        {isPending && (
                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60">
                            <button
                              type="button"
                              onClick={() => handleRejectSuggestion(sug.id)}
                              className="text-xs text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAcceptSuggestion(sug.id)}
                              className="text-xs bg-teal-600 hover:bg-teal-500 text-white font-medium px-4 py-1.5 rounded-lg shadow transition-colors flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Accept & Link Edge
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
