/**
 * DemoGuard — blocks write actions for viewer (demo) accounts.
 *
 * Usage (wrap any button or trigger):
 *   <DemoGuard><button onClick={doSomething}>Create</button></DemoGuard>
 *
 * Or use the hook to wrap handlers imperatively:
 *   const guard = useDemoBlock();
 *   <button onClick={guard(doSomething)}>Create</button>
 */
import { useState } from "react";
import { Eye, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useIsViewer } from "../../store/auth";

export function useDemoBlock() {
  const isViewer = useIsViewer();
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  function guard<T extends unknown[]>(fn?: (...args: T) => unknown) {
    return (...args: T) => {
      if (isViewer) { setShow(true); return; }
      fn?.(...args);
    };
  }

  const Toast = show ? (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-amber-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl animate-fade-in">
      <Eye className="w-4 h-4 text-amber-300 flex-shrink-0" />
      <span><Trans i18nKey="demo_guard.read_only" t={t} components={{ signup: <a href="/register" className="underline text-amber-300 hover:text-white" /> }} /></span>
      <button type="button" onClick={() => setShow(false)} aria-label={t("common.close")} className="ml-1 text-amber-300 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;

  return { guard, Toast, isViewer };
}

interface DemoGuardProps {
  children: React.ReactElement;
}

/** Wraps a single interactive element and blocks its click for viewers. */
export function DemoGuard({ children }: DemoGuardProps) {
  const { guard, Toast } = useDemoBlock();
  return (
    <>
      {Toast}
      {/* Clone child and override onClick */}
      {(() => {
        const child = children as React.ReactElement<{ onClick?: (...args: unknown[]) => unknown; className?: string }>;
        return (
          <child.type
            {...child.props}
            onClick={guard(child.props.onClick)}
          />
        );
      })()}
    </>
  );
}
