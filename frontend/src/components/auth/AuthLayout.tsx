import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Sparkles, Globe2 } from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";

const FEATURE_ICONS = [ShieldCheck, Sparkles, Globe2];

export default function AuthLayout({ children, maxWidth = "max-w-sm" }: { children: ReactNode; maxWidth?: string }) {
  const { t } = useTranslation();

  const features = [
    t("public.login.brand_feature_1"),
    t("public.login.brand_feature_2"),
    t("public.login.brand_feature_3"),
  ];

  const stats = [
    { value: t("public.login.brand_stat_1_value"), label: t("public.login.brand_stat_1_label") },
    { value: t("public.login.brand_stat_2_value"), label: t("public.login.brand_stat_2_label") },
    { value: t("public.login.brand_stat_3_value"), label: t("public.login.brand_stat_3_label") },
  ];

  return (
    <div className="auth-shell min-h-screen w-full flex bg-white">
      {/* ── Brand panel (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[42%] relative overflow-hidden bg-slate-950">
        <div className="absolute inset-0 hex-pattern opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/50 via-slate-950/80 to-slate-950" />
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-600/30 rounded-full blur-3xl animate-blob-slow" />
        <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-indigo-500/20 rounded-full blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute top-1/3 -right-10 w-72 h-72 bg-cyan-400/10 rounded-full blur-3xl animate-blob-slow animation-delay-1000" />
        <div className="noise-bg absolute inset-0" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div>
            <img
              src="/logo-vertical.png"
              alt={t("auth_layout.logo_alt")}
              className="h-16 w-auto object-contain bg-white/95 rounded-xl p-2.5 shadow-lg shadow-black/30 mb-14"
            />

            <h1 className="text-3xl xl:text-[2.5rem] font-bold text-white leading-tight mb-5">
              {t("public.login.brand_headline_lead")}{" "}
              <span className="bg-gradient-to-r from-sky-400 to-blue-400 bg-clip-text text-transparent">
                {t("public.login.brand_headline_accent")}
              </span>
            </h1>
            <p className="text-slate-300 text-base leading-relaxed max-w-md">
              {t("public.login.brand_subtitle")}
            </p>

            <ul className="mt-10 space-y-4">
              {features.map((feature, i) => {
                const Icon = FEATURE_ICONS[i];
                return (
                  <li key={feature} className="flex items-center gap-3.5 text-slate-200 text-sm">
                    <span className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 border border-white/10">
                      <Icon className="w-4 h-4 text-sky-400" />
                    </span>
                    {feature}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center gap-10 pt-8 border-t border-white/10">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile-only compact brand header */}
        <div className="lg:hidden relative overflow-hidden bg-slate-950 py-8 px-6 flex justify-center">
          <div className="absolute inset-0 hex-pattern opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-br from-blue-950/50 via-slate-950/80 to-slate-950" />
          <img
            src="/logo-vertical.png"
            alt={t("auth_layout.logo_alt")}
            className="relative z-10 h-14 w-auto object-contain bg-white/95 rounded-xl p-2 shadow-lg"
          />
        </div>

        <div className="flex justify-end p-6">
          <LanguageSwitcher />
        </div>

        <div className="flex-1 flex items-start lg:items-center justify-center px-6 pt-4 lg:pt-0 pb-12">
          <div className={`w-full ${maxWidth}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
