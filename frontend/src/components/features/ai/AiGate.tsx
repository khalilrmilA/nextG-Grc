/**
 * AiGate — wraps AI feature pages/components.
 * - If user has no approved quota → shows a "Request Access" lock screen.
 * - If user has access → shows children + a compact usage bar at the top.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Zap, Loader2 } from "lucide-react";
import { authApi } from "@/api/endpoints";
import AiAccessRequestDialog from "./AiAccessRequestDialog";

interface AiGateProps {
  children: React.ReactNode;
  /** Feature label shown in the lock screen */
  featureLabel?: string;
}

export default function AiGate({ children, featureLabel = "AI Feature" }: AiGateProps) {
  const [showRequest, setShowRequest] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai", "access-check"],
    queryFn: authApi.checkAiAccess,
    retry: false,
    staleTime: 0, // Always consider data stale to force fresh fetches
    gcTime: 0, // Don't cache in garbage collector either
    refetchInterval: 5000, // Poll every 5 seconds for real-time token usage
    refetchIntervalInBackground: true, // Continue polling even when tab is not in focus
  });

  // Refetch when dialog closes (in case admin just approved the request)
  useEffect(() => {
    if (!showRequest) {
      refetch();
    }
  }, [showRequest, refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data?.has_access) {
    const isLimitExceeded = data && (data.tokens_used >= data.tokens_limit || data.requests_used >= data.requests_limit);

    return (
      <>
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${isLimitExceeded ? "bg-red-100" : "bg-gray-100"}`}>
            <Lock className={`w-7 h-7 ${isLimitExceeded ? "text-red-500" : "text-gray-400"}`} />
          </div>
          <h2 className={`text-lg font-semibold mb-1 ${isLimitExceeded ? "text-red-900" : "text-gray-900"}`}>
            {isLimitExceeded ? "Monthly Limit Reached" : "AI Access Required"}
          </h2>
          <p className={`text-sm mb-6 max-w-sm ${isLimitExceeded ? "text-red-600" : "text-gray-500"}`}>
            {isLimitExceeded ? (
              <>
                <strong>{featureLabel}</strong> limit has been reached for this month. Your usage will reset on {data.reset_at ? new Date(data.reset_at).toLocaleDateString() : "next month"}.
              </>
            ) : (
              <>
                <strong>{featureLabel}</strong> requires approved AI access. Submit a request and your admin will review it.
              </>
            )}
          </p>
          {!isLimitExceeded && (
            <>
              <button
                type="button"
                onClick={() => setShowRequest(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
              >
                <Zap className="w-4 h-4" /> Request AI Access
              </button>
              <p className="text-xs text-gray-400 mt-3">
                Already requested?{" "}
                <a href="/settings?tab=ai-access" className="text-blue-500 hover:underline">
                  Check status in Settings
                </a>
              </p>
            </>
          )}
        </div>
        <AiAccessRequestDialog isOpen={showRequest} onClose={() => setShowRequest(false)} feature="all" />
      </>
    );
  }

  const pct = data.percentage_used ?? 0;
  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-orange-400" : "bg-blue-500";

  return (
    <div className="flex flex-col gap-0">
      {/* Usage bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
        <Zap className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
        <div className="flex-1 flex items-center gap-2">
          <span className="font-medium text-gray-700">AI Usage</span>
          <div className="flex-1 max-w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className={pct >= 100 ? "text-red-600 font-semibold" : pct >= 80 ? "text-orange-500 font-medium" : ""}>
            {data.tokens_used.toLocaleString()} / {data.tokens_limit.toLocaleString()} tokens
          </span>
          {data.reset_at && (
            <span className="text-gray-400">· resets {new Date(data.reset_at).toLocaleDateString()}</span>
          )}
        </div>
        {pct >= 100 && (
          <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Limit Reached</span>
        )}
        {pct >= 80 && pct < 100 && (
          <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Near Limit</span>
        )}
      </div>
      {children}
    </div>
  );
}
