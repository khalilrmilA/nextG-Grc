import { Crown } from "lucide-react";
import { useTranslation } from "react-i18next";
import MfaPanel from "@/components/MfaPanel";

// Two-Factor (TOTP) also lives in Settings → Security; this standalone page reuses
// the same MfaPanel so both stay in sync.
export default function MfaSetupPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{t("mfa.title", "Two-Factor Authentication")}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
            <Crown className="w-3 h-3" /> {t("mfa.elite", "Elite Pack")}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">{t("mfa.subtitle", "Protect your account with a time-based one-time password (TOTP) from an authenticator app")}</p>
      </div>
      <MfaPanel />
    </div>
  );
}
