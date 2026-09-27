import React from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, X } from 'lucide-react';

export default function Toast({ toasts, onClose }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map(toast => {
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';
        const isSuccess = toast.type === 'success';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-2xl border flex items-start gap-3 transition-all duration-300 transform translate-y-0 ${
              isError
                ? 'bg-rose-950/95 border-rose-500/50 text-rose-100'
                : isWarning
                ? 'bg-amber-950/95 border-amber-500/50 text-amber-100'
                : isSuccess
                ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-100'
                : 'bg-slate-900/95 border-slate-700 text-slate-100'
            }`}
          >
            <div className="mt-0.5 flex-shrink-0">
              {isError && <XCircle className="w-5 h-5 text-rose-400" />}
              {isWarning && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {isSuccess && <CheckCircle className="w-5 h-5 text-emerald-400" />}
              {!isError && !isWarning && !isSuccess && <Info className="w-5 h-5 text-teal-400" />}
            </div>

            <div className="flex-1 text-sm">
              {toast.title && <div className="font-semibold mb-0.5">{toast.title}</div>}
              <div className="text-xs opacity-90 leading-relaxed break-words">{toast.message}</div>
            </div>

            <button
              onClick={() => onClose(toast.id)}
              className="text-slate-400 hover:text-white transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
