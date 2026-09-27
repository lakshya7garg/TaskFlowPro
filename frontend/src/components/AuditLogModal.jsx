import React, { useEffect, useState } from 'react';
import { X, History, ArrowRight, Clock, RefreshCw } from 'lucide-react';
import { fetchAuditLogs } from '../services/api';
import { formatDateDisplay } from '../utils/dateUtils';

export default function AuditLogModal({ isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLogs();
      setLogs(data || []);
    } catch (err) {
      console.warn('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="font-semibold text-sm text-slate-100">
                Schedule Propagation Audit Log
              </h3>
              <p className="text-xs text-slate-400">
                Tracking max-slack date propagation events and diamond convergence calculations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              disabled={loading}
              title="Refresh logs"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Table */}
        <div className="p-5 overflow-y-auto flex-1">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl">
              <Clock className="w-8 h-8 opacity-20 mx-auto mb-2" />
              <p className="text-xs">No schedule propagation events recorded yet.</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Reschedule an upstream task (e.g. extending Task A) to see topological propagation events here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {logs.map((log) => {
                let parsedDetails = null;
                try {
                  parsedDetails = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                } catch {
                  parsedDetails = { reason: log.details };
                }

                return (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-slate-200 flex items-center gap-2">
                        <span>{log.task_title || 'Task'}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {log.action}
                        </span>
                      </div>

                      {parsedDetails?.reason && (
                        <p className="text-[11px] text-slate-400 mt-1">
                          {parsedDetails.reason}
                        </p>
                      )}

                      <div className="text-[10px] text-slate-500 mt-1">
                        Triggered by: <span className="text-slate-300">{log.triggered_by_title || 'Manual adjustment'}</span> • {new Date(log.created_at).toLocaleTimeString()}
                      </div>
                    </div>

                    {/* Date Shift Badge */}
                    <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 flex-shrink-0">
                      <span className="text-slate-400 font-mono">
                        {formatDateDisplay(log.old_end_date)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-teal-400" />
                      <span className="text-emerald-400 font-semibold font-mono">
                        {formatDateDisplay(log.new_end_date)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
