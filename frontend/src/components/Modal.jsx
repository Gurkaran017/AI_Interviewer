import React from 'react';

const Modal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", type = "danger" }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden transform animate-in zoom-in slide-in-from-bottom-8 duration-500 ease-out">
        <div className={`h-2 w-full ${type === 'danger' ? 'bg-rose-500' : 'bg-teal-500'}`}></div>
        
        <div className="p-8 sm:p-10 text-center">
          <div className={`w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center text-2xl ${type === 'danger' ? 'bg-rose-50/80 text-rose-500' : 'bg-teal-50/80 text-teal-500'}`}>
            {type === 'danger' ? '🗑️' : '⚠️'}
          </div>
          
          <h3 className="text-2xl font-black text-slate-900 mb-2 tracking-tight uppercase px-2">{title}</h3>
          <p className="text-slate-500 font-medium leading-relaxed mb-10 px-4">
            {message}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <button 
              onClick={onClose}
              className="flex-1 py-4 bg-slate-100 text-slate-600 font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all active:scale-95"
            >
              {cancelText}
            </button>
            <button 
              onClick={() => { onConfirm(); onClose(); }}
              className={`flex-1 py-4 text-white font-black text-[11px] uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-xl ${type === 'danger' ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20' : 'bg-teal-600 hover:bg-teal-500 shadow-teal-500/20'}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;