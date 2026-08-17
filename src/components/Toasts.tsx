import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";

export function Toasts() {
  const { dismissToast, resolveApproval, selectApproval, setCenterView, toasts } = useWorkbench(
    useShallow((state) => ({
      dismissToast: state.dismissToast,
      resolveApproval: state.resolveApproval,
      selectApproval: state.selectApproval,
      setCenterView: state.setCenterView,
      toasts: state.toasts,
    })),
  );

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => useWorkbench.getState().dismissToast(toast.id), 6000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role="status">
          <div className="toast-head">
            <strong>{toast.title}</strong>
            <button
              type="button"
              className="toast-close"
              title="关闭"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={12} />
            </button>
          </div>
          {toast.detail && <small className="toast-detail">{toast.detail}</small>}
          {toast.kind === "approval" && toast.approvalId && (
            <div className="toast-actions">
              <button
                type="button"
                onClick={() => {
                  selectApproval(toast.approvalId!);
                  setCenterView("approvals");
                  dismissToast(toast.id);
                }}
              >
                去处理
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void resolveApproval(toast.approvalId!, "approve_once");
                  dismissToast(toast.id);
                }}
              >
                批准一次
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
