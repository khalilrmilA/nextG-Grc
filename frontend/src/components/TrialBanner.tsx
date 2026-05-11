import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, X, Zap } from "lucide-react";
import { useAuthStore, authSession } from "../store/auth";

export default function TrialBanner() {
  const navigate = useNavigate();
  const user = useAuthStore((u) => u);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user || user.plan !== "free_trial") return;
    // Use stored daysRemaining (already calculated from trial_ends_at by the subscription sync)
    const days = user.daysRemaining ?? null;
    setDaysRemaining(days);
    setIsExpired(days !== null && days <= 0);
  }, [user]);

  // Don't show if not in trial or dismissed
  if (!user || user.plan !== "free_trial" || dismissed) {
    return null;
  }

  const isAdmin = user.role === "tenant_admin";

  // If trial expired, show blocking modal instead of banner
  if (isExpired) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Trial Expired</h2>
          <p className="text-gray-600 text-center mb-6">
            {isAdmin
              ? "Your 14-day free trial has ended. Please upgrade to continue using GRCEye."
              : "Your organization's free trial has ended. Please contact your administrator to continue using GRCEye."}
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate("/settings")}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors mb-3"
            >
              <Zap className="w-5 h-5" />
              Upgrade Now
            </button>
          )}
          <button
            onClick={() => {
              authSession.logout();
              navigate("/login");
            }}
            className="w-full border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              Free Trial — {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {isAdmin
                ? "Upgrade to Professional to keep using GRCEye after your trial ends."
                : "Contact your administrator to upgrade your organization's plan."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin && (
            <button
              onClick={() => navigate("/settings")}
              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Zap className="w-4 h-4" />
              Upgrade
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="inline-flex items-center justify-center w-8 h-8 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
