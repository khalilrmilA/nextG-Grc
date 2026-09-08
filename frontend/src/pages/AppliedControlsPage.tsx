/**
 * AppliedControlsPage — objectif 5, « Tableau de bord des contrôles ».
 *
 * The clause asks for four things about the deployed measures: leur état, les
 * résultats des évaluations d'efficacité, des alertes sur les contrôles
 * obsolètes, et un historique des modifications — accessible from the controls
 * page itself. The register was effectively READ-ONLY from the UI:
 * appliedControlsApi.update and .delete had no caller anywhere in the app, the
 * validate/reject endpoints had no client wrapper at all, and the only screen
 * that ever called GET /dashboards/controls was AnalyticsPage — a card in a
 * different navigation group, which does not make a dashboard accessible from
 * the controls page. The LOCATION is the rule.
 *
 * So this page now carries the whole objective: the module dashboard, the
 * obsolescence alert list, the register-wide change history, and the four
 * write actions (edit, delete, validate, reject) gated to the same roles the
 * server enforces.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronRight, Clock, Filter,
  History, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, X, XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { appliedControlsApi, riskScenariosApi } from "@/api/endpoints";
// The api lane's appliedControlsApi has no wrapper for validate / reject /
// obsolescence / the register-wide history, and its delete() sends no `reason`
// (the route requires one, min 3 chars, so that wrapper answers 422 as it
// stands). endpoints.ts belongs to another lane — the missing wrappers are
// listed under needs_integration. apiClient is the very instance every wrapper
// in endpoints.ts is built on, so these calls keep the token refresh, the 402
// upsell dispatch and the outage handling that the "no raw fetch" rule exists
// to protect.
import { apiClient } from "@/api/client";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";
import { hasAnyRole, useAuthStore } from "@/store/auth";
import i18n from "@/i18n";

/* ── French and Arabic for the strings this page introduced ──────────────────
 * Every t() call added for objectif 5 carries an English `defaultValue`, and a
 * defaultValue is used for ALL languages — so without this block a French or
 * Arabic user reads the obsolescence panel, the sign-off column and the change
 * history in English. The tender is French and the product is Arabic-first, so
 * that is a defect, not a rough edge.
 *
 * Registered through i18n.addResourceBundle exactly as i18n/index.ts already
 * does for eliteLocales and gapfills, and NON-DESTRUCTIVELY (last argument
 * false): the locale files are another lane's in this wave, and when that lane
 * adds these keys for real its values are already in the store and win over
 * these. Registered at module scope, i.e. before the first render, so no lookup
 * can miss them. See needs_integration — this belongs in locales/*.ts.
 */
const CONTROLS_I18N: Record<string, Record<string, string>> = {
  en: {
    all_validations: "All sign-off states",
    col_expiration: "Expiry",
    col_validation: "Sign-off",
    delete_confirm: "Removing this control removes a claimed mitigation from every risk that counted on it. The deletion is recorded with your justification.",
    delete_reason_label: "Justification",
    delete_reason_required: "A justification of at least 3 characters is required to remove a control.",
    edit_title: "Edit applied control",
    error_action_failed: "The action failed. Nothing was changed.",
    error_delete_failed: "The control could not be removed. Nothing was changed.",
    error_forbidden: "Your profile is not allowed to sign off on controls.",
    error_update_failed: "The control could not be saved. Nothing was changed.",
    expired_days_ago: "expired {{n}} day(s) ago",
    expires_in_days: "in {{n}} day(s)",
    form_expiration: "Expiry date",
    history_empty: "No change recorded yet.",
    history_failed: "The change history could not be read.",
    history_for: "Change history for this control",
    history_title: "Change history",
    history_truncated: "{{n}} older entries are held but not listed here.",
    obsolescence_evals_unavailable: "The effectiveness assessments could not be read on this server, so no assessment-related reason appears below. That is missing information, not a clean result.",
    obsolescence_failed: "The obsolescence alerts could not be loaded. The register below is unaffected.",
    obsolescence_more: "{{n}} more not listed here.",
    obsolescence_title: "Controls needing attention",
    route_not_published: "This view is not published on this server yet — the backend has not been restarted since it was added. Contact your administrator.",
    register_failed: "The control register could not be read. Nothing is missing from it — it simply could not be loaded.",
    register_truncated: "Showing {{shown}} of {{total}} controls. Every counter except the total covers the rows listed here only.",
    validation_stale: "sign-off predates the last edit",
    reason_expired: "Expired",
    reason_rejected_in_service: "Rejected but still in service",
    reason_ineffective: "Assessed ineffective",
    reason_expiring_soon: "Expiring soon",
    reason_deprecated: "Marked obsolete",
    reason_invalid_expiration: "Unreadable expiry date",
    reason_evaluation_overdue: "Assessment overdue",
    reason_unverified: "In service without sign-off",
    reason_never_evaluated: "Never assessed",
    history_action_created: "Created",
    history_action_updated: "Edited",
    history_action_status_changed: "Status changed",
    history_action_validated: "Signed off",
    history_action_rejected: "Rejected",
    history_action_evaluated: "Assessed",
    history_action_deleted: "Deleted",
  },
  fr: {
    all_validations: "Tous les états de validation",
    col_expiration: "Expiration",
    col_validation: "Validation",
    delete_confirm: "Supprimer ce contrôle retire une mesure d'atténuation revendiquée à chaque risque qui s'appuyait dessus. La suppression est enregistrée avec votre justification.",
    delete_reason_label: "Justification",
    delete_reason_required: "Une justification d'au moins 3 caractères est requise pour supprimer un contrôle.",
    edit_title: "Modifier le contrôle appliqué",
    error_action_failed: "L'action a échoué. Rien n'a été modifié.",
    error_delete_failed: "Le contrôle n'a pas pu être supprimé. Rien n'a été modifié.",
    error_forbidden: "Votre profil n'est pas autorisé à valider les contrôles.",
    error_update_failed: "Le contrôle n'a pas pu être enregistré. Rien n'a été modifié.",
    expired_days_ago: "expiré depuis {{n}} jour(s)",
    expires_in_days: "dans {{n}} jour(s)",
    form_expiration: "Date d'expiration",
    history_empty: "Aucune modification enregistrée pour l'instant.",
    history_failed: "L'historique des modifications n'a pas pu être lu.",
    history_for: "Historique des modifications de ce contrôle",
    history_title: "Historique des modifications",
    history_truncated: "{{n}} entrées plus anciennes sont conservées mais ne sont pas listées ici.",
    obsolescence_evals_unavailable: "Les évaluations d'efficacité n'ont pas pu être lues sur ce serveur : aucun motif lié à l'évaluation n'apparaît ci-dessous. Il s'agit d'une information manquante, pas d'un résultat sans anomalie.",
    obsolescence_failed: "Les alertes d'obsolescence n'ont pas pu être chargées. Le registre ci-dessous n'est pas affecté.",
    obsolescence_more: "{{n}} autres non listés ici.",
    obsolescence_title: "Contrôles nécessitant une attention",
    route_not_published: "Cette vue n'est pas encore publiée sur ce serveur — le backend n'a pas été redémarré depuis son ajout. Contactez votre administrateur.",
    register_failed: "Le registre des contrôles n'a pas pu être lu. Rien n'y manque — il n'a simplement pas pu être chargé.",
    register_truncated: "Affichage de {{shown}} contrôles sur {{total}}. Tous les compteurs, sauf le total, ne portent que sur les lignes listées ici.",
    validation_stale: "validation antérieure à la dernière modification",
    reason_expired: "Expiré",
    reason_rejected_in_service: "Rejeté mais toujours en service",
    reason_ineffective: "Évalué non performant",
    reason_expiring_soon: "Expire bientôt",
    reason_deprecated: "Déclaré obsolète",
    reason_invalid_expiration: "Date d'expiration illisible",
    reason_evaluation_overdue: "Évaluation en retard",
    reason_unverified: "En service sans validation",
    reason_never_evaluated: "Jamais évalué",
    history_action_created: "Créé",
    history_action_updated: "Modifié",
    history_action_status_changed: "Statut modifié",
    history_action_validated: "Validé",
    history_action_rejected: "Rejeté",
    history_action_evaluated: "Évalué",
    history_action_deleted: "Supprimé",
  },
  ar: {
    all_validations: "جميع حالات الاعتماد",
    col_expiration: "الانتهاء",
    col_validation: "الاعتماد",
    delete_confirm: "حذف هذا الضابط يزيل إجراء تخفيف مُعلَناً عن كل خطر كان يعتمد عليه. ويُسجَّل الحذف مع التبرير الذي تُدخله.",
    delete_reason_label: "التبرير",
    delete_reason_required: "يلزم تبرير من 3 أحرف على الأقل لحذف ضابط.",
    edit_title: "تعديل الضابط المطبق",
    error_action_failed: "فشل الإجراء. لم يتغيّر شيء.",
    error_delete_failed: "تعذّر حذف الضابط. لم يتغيّر شيء.",
    error_forbidden: "ملفك الشخصي غير مخوَّل لاعتماد الضوابط.",
    error_update_failed: "تعذّر حفظ الضابط. لم يتغيّر شيء.",
    expired_days_ago: "منتهٍ منذ {{n}} يوم",
    expires_in_days: "خلال {{n}} يوم",
    form_expiration: "تاريخ الانتهاء",
    history_empty: "لم تُسجَّل أي تعديلات بعد.",
    history_failed: "تعذّرت قراءة سجل التعديلات.",
    history_for: "سجل تعديلات هذا الضابط",
    history_title: "سجل التعديلات",
    history_truncated: "توجد {{n}} إدخالات أقدم محفوظة وغير مدرجة هنا.",
    obsolescence_evals_unavailable: "تعذّرت قراءة تقييمات الفعالية على هذا الخادم، لذا لا يظهر أدناه أي سبب متعلق بالتقييم. هذه معلومات ناقصة، وليست نتيجة خالية من الملاحظات.",
    obsolescence_failed: "تعذّر تحميل تنبيهات التقادم. السجل أدناه غير متأثر.",
    obsolescence_more: "و{{n}} أخرى غير مدرجة هنا.",
    obsolescence_title: "ضوابط تحتاج إلى متابعة",
    route_not_published: "هذه الواجهة غير منشورة على هذا الخادم بعد — لم يُعَد تشغيل الخادم منذ إضافتها. يرجى مراجعة المسؤول.",
    register_failed: "تعذّرت قراءة سجل الضوابط. لا ينقصه شيء — لكنه لم يُحمَّل فحسب.",
    register_truncated: "عرض {{shown}} ضابطاً من أصل {{total}}. جميع المؤشرات، عدا الإجمالي، تخص الصفوف المدرجة هنا فقط.",
    validation_stale: "الاعتماد أقدم من آخر تعديل",
    reason_expired: "منتهي الصلاحية",
    reason_rejected_in_service: "مرفوض ولا يزال قيد الخدمة",
    reason_ineffective: "مُقيَّم كغير فعّال",
    reason_expiring_soon: "على وشك الانتهاء",
    reason_deprecated: "مُعلن كمتقادم",
    reason_invalid_expiration: "تاريخ انتهاء غير مقروء",
    reason_evaluation_overdue: "التقييم متأخر",
    reason_unverified: "قيد الخدمة دون اعتماد",
    reason_never_evaluated: "لم يُقيَّم قط",
    history_action_created: "أُنشئ",
    history_action_updated: "عُدِّل",
    history_action_status_changed: "تغيّرت الحالة",
    history_action_validated: "اعتُمد",
    history_action_rejected: "رُفض",
    history_action_evaluated: "قُيِّم",
    history_action_deleted: "حُذف",
  },
};

/** The three performance levels are raw French enum values in the database
 *  (performant / moyennement_performant / non_performant) and were absent from
 *  moduledash.vocab, so vocab() printed "moyennement performant" to an English
 *  or Arabic reader. */
const PERFORMANCE_VOCAB: Record<string, Record<string, string>> = {
  en: { performant: "Effective", moyennement_performant: "Partly effective", non_performant: "Ineffective" },
  fr: { performant: "Performant", moyennement_performant: "Moyennement performant", non_performant: "Non performant" },
  ar: { performant: "فعّال", moyennement_performant: "فعّال جزئياً", non_performant: "غير فعّال" },
};

/** The six NIST CSF 2.0 functions, which `csf_function` stores raw. Verified
 *  absent from moduledash.vocab in all three locale files, so the picker below
 *  fell through to its defaultValue — a capitalised English word — for a French
 *  and an Arabic reader alike. Same vocabulary chain as every other raw enum on
 *  this page, so the CSF column and the CSF picker read the same words. */
const CSF_VOCAB: Record<string, Record<string, string>> = {
  en: { govern: "Govern", identify: "Identify", protect: "Protect", detect: "Detect", respond: "Respond", recover: "Recover" },
  fr: { govern: "Gouverner", identify: "Identifier", protect: "Protéger", detect: "Détecter", respond: "Répondre", recover: "Rétablir" },
  ar: { govern: "الحوكمة", identify: "التحديد", protect: "الحماية", detect: "الكشف", respond: "الاستجابة", recover: "التعافي" },
};

for (const lng of ["en", "fr", "ar"]) {
  i18n.addResourceBundle(lng, "translation", {
    applied_controls: CONTROLS_I18N[lng],
    moduledash: { vocab: { ...PERFORMANCE_VOCAB[lng], ...CSF_VOCAB[lng] } },
  }, true, false);
}

/** Whether the dashboard panel is open, per browser. localStorage THROWS in
 *  some privacy modes, so a remembered preference must never take the controls
 *  register down with it — same guard the other module pages use. */
const DASH_LS_KEY = "grceye.moduledash.controls.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

const STATUS_BADGE: Record<string, string> = {
  planned: "bg-gray-100 text-gray-600 border-gray-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  implemented: "bg-green-100 text-green-700 border-green-200",
  not_applicable: "bg-gray-100 text-gray-500 border-gray-200",
  deprecated: "bg-red-100 text-red-700 border-red-200",
};

const EFFORT_BADGE: Record<string, string> = {
  very_low: "bg-green-50 text-green-600",
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  very_high: "bg-red-100 text-red-700",
};

/** validation_status — the security referent's sign-off, independent of the
 *  implementation status: a control can be "implemented" and never signed off. */
const VALIDATION_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  validated: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
};

/** obsolescence_state — computed server-side, never stored, so it cannot go
 *  stale between the write and the read. */
const OBSOLESCENCE_BADGE: Record<string, string> = {
  expired: "bg-red-100 text-red-700 border-red-200",
  expiring_soon: "bg-amber-100 text-amber-700 border-amber-200",
  deprecated: "bg-gray-200 text-gray-700 border-gray-300",
  invalid_expiration: "bg-orange-100 text-orange-700 border-orange-200",
};

/** performance_level as ControlEvaluation actually stores it — performant /
 *  moyennement_performant / non_performant (derive_performance_level, in
 *  backend/app/models/control_evaluation.py). These keys read
 *  effective / partially_effective / ineffective, which no row has ever held,
 *  so every effectiveness chip fell through to grey: the « alerte visuelle » on
 *  a control assessed NON PERFORMANT was rendered in the same neutral colour as
 *  one assessed fine. */
const PERFORMANCE_BADGE: Record<string, string> = {
  performant: "bg-green-100 text-green-700",
  moyennement_performant: "bg-amber-100 text-amber-700",
  non_performant: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = ["planned", "in_progress", "implemented", "not_applicable", "deprecated"];
const EFFORT_OPTIONS = ["very_low", "low", "medium", "high", "very_high"];
const CSF_FUNCTIONS = ["govern", "identify", "protect", "detect", "respond", "recover"];
const VALIDATION_OPTIONS = ["pending", "validated", "rejected"];

/** The obsolescence reasons, worst first — the server's own stable ordering. */
const REASON_LABELS: Record<string, string> = {
  expired: "Expired",
  rejected_in_service: "Rejected but still in service",
  ineffective: "Assessed ineffective",
  expiring_soon: "Expiring soon",
  deprecated: "Marked obsolete",
  invalid_expiration: "Unreadable expiry date",
  evaluation_overdue: "Assessment overdue",
  unverified: "In service without sign-off",
  never_evaluated: "Never assessed",
};

/** History actions the register-wide feed accepts. An unknown one is a 422, so
 *  the filter offers exactly these. */
const HISTORY_ACTIONS = ["created", "updated", "status_changed", "validated", "rejected", "evaluated", "deleted"];

/** DELETE /applied-controls/{id} requires reason=… with at least 3 characters. */
const MIN_DELETE_REASON = 3;

interface ObsolescenceItem {
  id: string;
  ref_id?: string | null;
  name: string;
  status: string;
  validation_status: string;
  expiration?: string | null;
  days_until_expiration?: number | null;
  reasons: string[];
  performance_level?: string | null;
  remediation_status?: string | null;
  last_evaluated_at?: string | null;
  next_evaluation_at?: string | null;
}

interface ObsolescenceResponse {
  window_days: number;
  total_controls: number;
  total_flagged: number;
  counts: Record<string, number>;
  /** false ⇒ control_evaluations could not be read: the effectiveness reasons
   *  are ABSENT from this answer, not zero. The panel has to say so rather than
   *  imply every control assessed fine. */
  evaluations_available: boolean;
  items: ObsolescenceItem[];
}

interface HistoryRow {
  id: string;
  applied_control_id: string;
  action: string;
  changes: Record<string, unknown>;
  control_ref_id?: string | null;
  control_name?: string | null;
  note?: string | null;
  actor_id?: string | null;
  actor_email?: string | null;
  created_at: string;
}

/**
 * The server's own sentence for a failure, when it sent one.
 *
 * Load-bearing here rather than a nicety: EVERY write on this router commits an
 * applied_control_history row in the same transaction, and while that table is
 * not provisioned the write answers 424 with an operator-actionable message
 * ("restart the backend once to provision it"). Replacing that with a generic
 * "could not save" sends an operator looking for the wrong problem.
 */
function serverMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function statusOf(err: unknown): number {
  return (err as { response?: { status?: number } })?.response?.status ?? 0;
}

export default function AppliedControlsPage() {
  const { t } = useTranslation();

  // ── Who may do what ──────────────────────────────────────────────────────
  // ADVISORY only, never the policy: the server re-checks on every call, and it
  // resolves group-granted and delegated roles this client cannot see. So these
  // flags hide a button that would certainly 403; when one gets through anyway,
  // the 403 is shown as the server's own sentence rather than swallowed.
  // One selector returning the user OBJECT, never a derived array: useAuthStore
  // is a useSyncExternalStore, and a selector that builds a new array on every
  // call makes React re-render forever ("the result of getSnapshot should be
  // cached").
  const user = useAuthStore((u) => u);
  // The scalar `role` column is exactly what require_roles() auto-passes on.
  const isAdmin = user?.role === "tenant_admin" || user?.role === "super_admin";
  // require_roles(CISO, RISK_MANAGER, SECURITY_ANALYST, CONTROL_OWNER) on
  // POST / PATCH — admins auto-pass.
  const canEdit = isAdmin || hasAnyRole(user, ["ciso", "risk_manager", "security_analyst", "control_owner"]);
  // require_roles(CISO, RISK_MANAGER) on DELETE, validate and reject: removing a
  // control removes a claimed mitigation from every risk that counted on it,
  // and a sign-off is the security referent's decision.
  const canReferee = isAdmin || hasAnyRole(user, ["ciso", "risk_manager"]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed READ and an empty register are different facts, and the register
  // total is the server's, not the length of the page that came back.
  const [registerError, setRegisterError] = useState("");
  const [registerTotal, setRegisterTotal] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [validationFilter, setValidationFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dashOpen, setDashOpen] = useState<boolean>(readDashOpen);

  // Row-level actions
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  // « Alertes sur les contrôles obsolètes »
  const [obsolescence, setObsolescence] = useState<ObsolescenceResponse | null>(null);
  const [obsolescenceError, setObsolescenceError] = useState("");
  const [obsOpen, setObsOpen] = useState(false);

  // « Historique des modifications »
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [historyAction, setHistoryAction] = useState("");
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const emptyForm = {
    ref_id: "",
    name: "",
    description: "",
    category: "",
    csf_function: "protect",
    status: "planned",
    effort: "medium",
    progress: 0,
    cost: 0,
    recurring_cost: 0,
    eta: "",
    expiration: "",
    risk_scenario_ids: [] as string[],
  };
  const [form, setForm] = useState(emptyForm);
  const [scenarioOptions, setScenarioOptions] = useState<MultiSelectOption[]>([]);

  useEffect(() => {
    riskScenariosApi.list().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setScenarioOptions(list.map((s: any) => ({ id: s.id, label: s.name })));
    }).catch(() => setScenarioOptions([]));
  }, []);

  const load = useCallback(async () => {
    try {
      // `any` on purpose: the api lane's list() signature is typed { status? }
      // and does not yet declare validation_status / include_evaluation, which
      // the route accepts (see needs_integration). include_evaluation is what
      // puts « les résultats des évaluations d'efficacité » on the row.
      const params: any = { include_evaluation: true };
      if (statusFilter) params.status = statusFilter;
      if (validationFilter) params.validation_status = validationFilter;
      // Called through apiClient rather than appliedControlsApi.list() for one
      // reason: the wrapper returns r.data and throws the RESPONSE away, and
      // the register-wide total only exists in the X-Total-Count header. The
      // route is bounded (limit defaults to 1000), so without that header the
      // "Total Controls" tile is the size of the page that came back, not the
      // size of the register — a wrong number rather than a small one, on the
      // tile a bank reads first. Same axios instance, so the token refresh,
      // the 402 upsell and the outage handling all still apply.
      const response = await apiClient.get("/applied-controls", { params });
      const rows = Array.isArray(response.data) ? response.data : (response.data?.items ?? []);
      setItems(rows);
      const total = Number(response.headers?.["x-total-count"]);
      setRegisterTotal(Number.isFinite(total) ? total : null);
      setRegisterError("");
    } catch (err) {
      // No sample rows, ever — but an unreadable register is NOT an empty one.
      // Falling through to "No applied controls found" asserted that the
      // organisation has deployed no controls, which is a statement the server
      // never made and the opposite of what actually happened.
      setItems([]);
      setRegisterTotal(null);
      setRegisterError(
        serverMessage(err) || t("applied_controls.register_failed", {
          defaultValue: "The control register could not be read. Nothing is missing from it — it simply could not be loaded.",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, validationFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadObsolescence = useCallback(async () => {
    try {
      const { data } = await apiClient.get<ObsolescenceResponse>(
        "/applied-controls/obsolescence",
        { params: { window_days: 30 } },
      );
      setObsolescence(data);
      setObsolescenceError("");
    } catch (err) {
      // The alert list is an addition to the register, never a gate on it —
      // a failure here degrades this panel alone.
      setObsolescence(null);
      // A 404 here means the route exists in the source but not in the process
      // answering: this server has not been restarted since it was added. The
      // server's own body for that is the bare "Not Found", which sends nobody
      // anywhere, so it is replaced with the sentence an operator can act on.
      setObsolescenceError(
        statusOf(err) === 404
          ? t("applied_controls.route_not_published", {
              defaultValue:
                "This view is not published on this server yet — the backend has not been restarted since it was added. Contact your administrator.",
            })
          : serverMessage(err) || t("applied_controls.obsolescence_failed", {
              defaultValue: "The obsolescence alerts could not be loaded. The register below is unaffected.",
            }),
      );
    }
  }, [t]);

  useEffect(() => {
    loadObsolescence();
  }, [loadObsolescence]);

  const loadHistory = useCallback(async (controlId?: string, action?: string) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const params: Record<string, unknown> = { limit: 200 };
      if (controlId) params.control_id = controlId;
      if (action) params.action = action;
      const response = await apiClient.get<HistoryRow[]>("/applied-controls/history", { params });
      const rows = Array.isArray(response.data) ? response.data : [];
      setHistoryRows(rows);
      const total = Number(response.headers?.["x-total-count"]);
      setHistoryTotal(Number.isFinite(total) ? total : rows.length);
    } catch (err) {
      setHistoryRows([]);
      setHistoryTotal(0);
      // 424 while applied_control_history is not provisioned: the server's own
      // message names the fix. An empty list would be a lie — it would assert
      // that nothing has ever been changed in the register. A 404 is the other
      // shape of the same situation (route present in source, absent from the
      // running process), and "Not Found" is not actionable.
      setHistoryError(
        statusOf(err) === 404
          ? t("applied_controls.route_not_published", {
              defaultValue:
                "This view is not published on this server yet — the backend has not been restarted since it was added. Contact your administrator.",
            })
          : serverMessage(err) || t("applied_controls.history_failed", {
              defaultValue: "The change history could not be read.",
            }),
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  function openHistory(control?: any) {
    const target = control ? { id: control.id, name: control.name } : null;
    setHistoryFor(target);
    setHistoryAction("");
    setHistoryOpen(true);
    loadHistory(target?.id, "");
  }

  function toggleDash() {
    setDashOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(DASH_LS_KEY, next ? "1" : "0");
      } catch {
        // Private browsing — the panel simply reopens on the next visit.
      }
      return next;
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setShowModal(true);
  }

  function openEdit(item: any) {
    setEditingId(item.id);
    setError("");
    setForm({
      ref_id: item.ref_id || "",
      name: item.name || "",
      description: item.description || "",
      category: item.category || "",
      csf_function: item.csf_function || "protect",
      status: item.status || "planned",
      effort: item.effort || "medium",
      progress: Number.isFinite(Number(item.progress)) ? Number(item.progress) : 0,
      cost: Number(item.cost) || 0,
      recurring_cost: Number(item.recurring_cost) || 0,
      eta: item.eta || "",
      expiration: item.expiration || "",
      risk_scenario_ids: Array.isArray(item.risk_scenario_ids) ? item.risk_scenario_ids : [],
    });
    setShowModal(true);
  }

  /** Splice the row the server just returned back into the list.
   *  The write routes return the full row — derived obsolescence state and
   *  latest_evaluation included — so a refetch would only cost a round trip. */
  function replaceRow(row: any) {
    setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("applied_controls.error_name_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      if (editingId) {
        // PATCH accepts exactly these; ref_id is not editable server-side, so it
        // is deliberately not sent rather than sent and silently ignored.
        const payload: Record<string, unknown> = {
          name: form.name,
          description: form.description || null,
          category: form.category || null,
          csf_function: form.csf_function,
          status: form.status,
          progress: Math.min(100, Math.max(0, Number(form.progress) || 0)),
          effort: form.effort,
          cost: Number(form.cost) || 0,
          recurring_cost: Number(form.recurring_cost) || 0,
          // "" clears the date (the column is in _CLEARABLE_FIELDS); a bad date
          // is refused with a 422 that names the format.
          eta: form.eta || "",
          expiration: form.expiration || "",
          risk_scenario_ids: form.risk_scenario_ids,
        };
        const row = await appliedControlsApi.update(editingId, payload);
        replaceRow(row);
      } else {
        const payload: any = { ...form };
        if (!payload.eta) delete payload.eta;
        if (!payload.expiration) delete payload.expiration;
        // progress is not part of the create schema — a new control starts at 0.
        delete payload.progress;
        await appliedControlsApi.create(payload);
        setLoading(true);
        await load();
      }
      setShowModal(false);
      setEditingId(null);
      setForm(emptyForm);
      loadObsolescence();
    } catch (err: any) {
      setError(
        serverMessage(err) ||
        (editingId
          ? t("applied_controls.error_update_failed", { defaultValue: "The control could not be saved. Nothing was changed." })
          : t("applied_controls.error_create_failed")),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function runValidation(item: any, decision: "validate" | "reject", notes: string) {
    setBusyId(item.id);
    setActionError("");
    try {
      const { data } = await apiClient.post(`/applied-controls/${item.id}/${decision}`, {
        notes: notes.trim() || null,
      });
      replaceRow(data);
      setRejecting(null);
      setRejectNotes("");
      loadObsolescence();
    } catch (err) {
      const status = statusOf(err);
      setActionError(
        serverMessage(err) ||
        (status === 403
          ? t("applied_controls.error_forbidden", { defaultValue: "Your profile is not allowed to sign off on controls." })
          : t("applied_controls.error_action_failed", { defaultValue: "The action failed. Nothing was changed." })),
      );
    } finally {
      setBusyId("");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const reason = deleteReason.trim();
    // Enforced client-side too so the user is told before the round trip; the
    // server is still the authority (min_length=3 on the query parameter).
    if (reason.length < MIN_DELETE_REASON) {
      setActionError(t("applied_controls.delete_reason_required", {
        defaultValue: "A justification of at least 3 characters is required to remove a control.",
      }));
      return;
    }
    setBusyId(confirmDelete.id);
    setActionError("");
    try {
      await apiClient.delete(`/applied-controls/${confirmDelete.id}`, { params: { reason } });
      setItems((prev) => prev.filter((i) => i.id !== confirmDelete.id));
      // The register total is the server's, and one row just left the register.
      // Left alone it made the « Total Controls » tile assert a count the
      // register no longer holds AND tripped the truncation notice — "Showing 9
      // of 10 controls, every counter covers the rows listed here only" — on a
      // register that is in fact complete on screen. A stale figure a bank reads
      // as a measurement is the same defect as an invented one.
      setRegisterTotal((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
      setConfirmDelete(null);
      setDeleteReason("");
      loadObsolescence();
    } catch (err) {
      setActionError(
        serverMessage(err) ||
        t("applied_controls.error_delete_failed", { defaultValue: "The control could not be removed. Nothing was changed." }),
      );
    } finally {
      setBusyId("");
    }
  }

  const filtered = items.filter((i) =>
    i.name?.toLowerCase().includes(search.toLowerCase()) || i.ref_id?.toLowerCase().includes(search.toLowerCase())
  );

  // The server's own count when it sent one. The three tiles below it are
  // necessarily computed over the rows on this page, which is why a truncation
  // is stated rather than left to be inferred from a smaller-looking number.
  const kpiTotal = registerTotal ?? items.length;
  const registerTruncated = registerTotal != null && registerTotal > items.length;
  const kpiImplemented = items.filter((i) => i.status === "implemented").length;
  const kpiInProgress = items.filter((i) => i.status === "in_progress").length;
  const kpiTotalCost = items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

  function vocab(value: string | null | undefined): string {
    if (!value) return "—";
    // moduledash.vocab carries the raw backend enum values in all three
    // languages; the raw value is the fallback, never an invented label.
    return t(`moduledash.vocab.${value}`, { defaultValue: value.replace(/_/g, " ") });
  }

  function reasonLabel(reason: string): string {
    return t(`applied_controls.reason_${reason}`, {
      defaultValue: REASON_LABELS[reason] || reason.replace(/_/g, " "),
    });
  }

  function expiryLabel(days: number | null | undefined): string {
    if (days == null) return "";
    if (days < 0) {
      return t("applied_controls.expired_days_ago", {
        n: Math.abs(days),
        defaultValue: "expired {{n}} day(s) ago",
      });
    }
    return t("applied_controls.expires_in_days", { n: days, defaultValue: "in {{n}} day(s)" });
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("applied_controls.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("applied_controls.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openHistory()}
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <History className="w-4 h-4" /> {t("applied_controls.history_title", { defaultValue: "Change history" })}
          </button>
          {canEdit && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("applied_controls.new_control")}
            </button>
          )}
        </div>
      </div>

      {/*
        Objectif 5 — « Accessible depuis la page dédiée aux contrôles ».
        GET /dashboards/controls (état de mise en œuvre, avancement moyen, coût
        engagé) already existed, but the only screen that ever called it was
        AnalyticsPage: a card in another navigation group does not make the
        dashboard accessible from the controls page. The LOCATION is the rule.

        ModuleDashboard owns every answer that call can end in — the Elite plan
        gate as a translated upsell instead of a blank card, the role gate as an
        explicit « vue restreinte », a 424 as the operator's own message, and an
        empty register as "nothing recorded yet" rather than invented rows.
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-controls"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {dashOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
          <BarChart3 className="w-4 h-4 text-blue-600" aria-hidden="true" />
          {t("moduledash.dashboard")}
          <span className="text-xs font-normal text-gray-400">
            {dashOpen ? t("moduledash.hide") : t("moduledash.show")}
          </span>
        </button>
        {dashOpen && <div id="module-dashboard-controls"><ModuleDashboard module="controls" /></div>}
      </div>

      {/* KPI tiles (RFP mod 14.5) */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{kpiTotal}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_total", "Total Controls")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{kpiImplemented}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_implemented", "Implemented")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{kpiInProgress}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_in_progress", "In Progress")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">${kpiTotalCost.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_total_cost", "Total Cost")}</p>
          </div>
        </div>
      )}

      {registerTruncated && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status">
          {t("applied_controls.register_truncated", {
            shown: items.length,
            total: registerTotal,
            defaultValue: "Showing {{shown}} of {{total}} controls. Every counter except the total covers the rows listed here only.",
          })}
        </p>
      )}

      {registerError && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800" role="status">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">{registerError}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); load(); }}
            className="shrink-0 text-xs font-medium underline"
          >
            {t("moduledash.retry")}
          </button>
        </div>
      )}

      {/* ── « Alertes sur les contrôles obsolètes » ─────────────────────────
          One row per control that needs attention, with every reason it was
          flagged — expiry, a sign-off that never came, an effectiveness result.
          Never a silent zero: when control_evaluations could not be read the
          effectiveness reasons are ABSENT from the answer, and that is stated. */}
      {obsolescenceError ? (
        <p className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800" role="status">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{obsolescenceError}</span>
        </p>
      ) : obsolescence && obsolescence.total_flagged > 0 ? (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setObsOpen((o) => !o)}
            aria-expanded={obsOpen}
            className="w-full flex items-center gap-2 px-5 py-4 text-left hover:bg-amber-50/50 transition-colors"
          >
            {obsOpen
              ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
              : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
            <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
            <span className="text-sm font-semibold text-gray-900">
              {t("applied_controls.obsolescence_title", { defaultValue: "Controls needing attention" })}
            </span>
            <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
              {obsolescence.total_flagged} / {obsolescence.total_controls}
            </span>
            <span className="ms-auto text-xs text-gray-400">
              {t("moduledash.control_obsolete_hint")}
            </span>
          </button>

          {obsOpen && (
            <div className="border-t border-amber-100 px-5 py-4 space-y-3">
              {!obsolescence.evaluations_available && (
                <p className="flex items-start gap-2 px-3 py-2 bg-amber-50 rounded-xl text-xs text-amber-800" role="status">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t("applied_controls.obsolescence_evals_unavailable", {
                      defaultValue:
                        "The effectiveness assessments could not be read on this server, so no assessment-related reason appears below. That is missing information, not a clean result.",
                    })}
                  </span>
                </p>
              )}
              {/* Only the reasons that actually fired. The server pre-seeds
                  `counts` with every reason at 0 (a stable key set for a
                  caller that wants one), and rendering those verbatim printed
                  « 0 Évalué non performant » next to the very notice saying the
                  effectiveness assessments could NOT be read — a zero asserted
                  where the answer is unknown, which is the fabricated-figure
                  defect wearing a different hat. */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(obsolescence.counts)
                  .filter(([, n]) => Number(n) > 0)
                  .map(([reason, n]) => (
                    <span key={reason} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-700">
                      <span className="font-semibold tabular-nums">{n}</span> {reasonLabel(reason)}
                    </span>
                  ))}
              </div>
              <ul className="divide-y divide-gray-50">
                {obsolescence.items.slice(0, 25).map((item) => (
                  <li key={item.id} className="py-2.5 flex items-start gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        {item.ref_id ? <span className="font-mono text-xs text-gray-500 me-1.5">{item.ref_id}</span> : null}
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.reasons.map((r) => reasonLabel(r)).join(" · ")}
                        {item.days_until_expiration != null ? ` — ${expiryLabel(item.days_until_expiration)}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${VALIDATION_BADGE[item.validation_status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {vocab(item.validation_status)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Counted off total_flagged, not off items.length: the route
                  flags every control but returns at most `limit` of them (500),
                  so on a register with more flagged controls than that
                  items.length is itself a cut — and "475 more not listed" when
                  575 are in fact not listed is a wrong figure on an alert
                  panel, which is exactly what this screen must not produce. */}
              {obsolescence.total_flagged > 25 && (
                <p className="text-xs text-gray-400">
                  {t("applied_controls.obsolescence_more", {
                    n: obsolescence.total_flagged - 25,
                    defaultValue: "{{n}} more not listed here.",
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}

      {actionError && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError("")} title={t("common.close")} aria-label={t("common.close")}>
            <X className="w-4 h-4 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("applied_controls.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("applied_controls.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{vocab(s)}</option>)}
          </select>
          {/* « leur état » is two independent facts: implementation, and the
              security referent's sign-off. Filtering on one never answers the
              other, so both filters exist. */}
          <select
            value={validationFilter}
            onChange={(e) => setValidationFilter(e.target.value)}
            title={t("applied_controls.col_validation", { defaultValue: "Sign-off" })}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("applied_controls.all_validations", { defaultValue: "All sign-off states" })}</option>
            {VALIDATION_OPTIONS.map((v) => <option key={v} value={v}>{vocab(v)}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {registerError ? t("moduledash.error_title") : t("applied_controls.no_controls")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_ref")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_name")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("moduledash.control_state")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_validation", { defaultValue: "Sign-off" })}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("moduledash.control_evaluation")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_progress")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_expiration", { defaultValue: "Expiry" })}</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_cost")}</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item: any) => {
                  // progress is the control's OWN percentage, and it is the
                  // only thing this cell may show. The previous expression
                  // substituted 100 / 50 / 0 derived from the status whenever
                  // the field was absent, i.e. it invented a completion figure —
                  // an "in progress" control with no recorded advancement was
                  // drawn as a half-full blue bar reading 50 %. Nobody entered
                  // that number and no server sent it. Same class of defect as
                  // the DEMO_RISKS fallback: a fabricated figure a bank would
                  // read as a measurement. An absent value is now shown as
                  // absent.
                  const progress = Number.isFinite(Number(item.progress)) ? Number(item.progress) : null;
                  const evaluation = item.latest_evaluation;
                  // Absent KEY and null VALUE are different facts. ACOut always
                  // carries latest_evaluation (null when there is none), so a
                  // row without the key at all came from a server that has not
                  // been restarted since include_evaluation was added — the
                  // assessment result is UNKNOWN there, and printing "never
                  // assessed" would state something the server never said.
                  // ...and the same holds when control_evaluations could not
                  // be READ: list_controls sets latest_evaluation to null for
                  // every row in that case without saying so, so a table this
                  // server has not provisioned yet would have made the whole
                  // register read « Jamais évalué » — a clean bill of health
                  // nobody issued. The obsolescence endpoint reports that read
                  // explicitly (evaluations_available), so it is what decides
                  // between "no assessment" and "not known here".
                  const evaluationKnown =
                    "latest_evaluation" in item && obsolescence?.evaluations_available !== false;
                  const rowBusy = busyId === item.id;
                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors align-top">
                      <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ref_id || "-"}</td>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {item.name}
                        {item.category && <span className="block text-xs font-normal text-gray-400 mt-0.5">{item.category}</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                            {vocab(item.status)}
                          </span>
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${EFFORT_BADGE[item.effort] || "bg-gray-100 text-gray-600"}`}>
                            {vocab(item.effort)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${VALIDATION_BADGE[item.validation_status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {vocab(item.validation_status)}
                        </span>
                        {/* Editing a validated control deliberately does NOT reset
                            its sign-off server-side; saying the approval is older
                            than what is now on screen is the honest alternative. */}
                        {item.validation_stale && (
                          <span className="block text-xs text-amber-700 mt-1">
                            {t("applied_controls.validation_stale", { defaultValue: "sign-off predates the last edit" })}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {evaluation ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PERFORMANCE_BADGE[evaluation.performance_level] || "bg-gray-100 text-gray-600"}`}>
                              {/* Through the vocabulary chain, not a key of its
                                  own: the three levels are FRENCH enum values
                                  (performant / moyennement_performant /
                                  non_performant) and PERFORMANCE_VOCAB above
                                  registers them into moduledash.vocab in all
                                  three languages, so an English or Arabic reader
                                  no longer sees "moyennement performant". */}
                              {vocab(evaluation.performance_level)} · {evaluation.score}/10
                            </span>
                            {evaluation.is_overdue && (
                              <span className="text-xs text-amber-700">
                                {t("applied_controls.reason_evaluation_overdue", { defaultValue: REASON_LABELS.evaluation_overdue })}
                              </span>
                            )}
                          </div>
                        ) : evaluationKnown ? (
                          // Never "0/10": no assessment is missing information,
                          // not a bad score.
                          <span className="text-xs text-gray-400">
                            {t("applied_controls.reason_never_evaluated", { defaultValue: REASON_LABELS.never_evaluated })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">{t("moduledash.not_available")}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {progress == null ? (
                          <span className="text-xs text-gray-300">{t("moduledash.not_available")}</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${progress >= 100 ? "bg-green-500" : progress >= 50 ? "bg-blue-500" : "bg-gray-300"}`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 tabular-nums">{progress}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {item.obsolescence_state ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${OBSOLESCENCE_BADGE[item.obsolescence_state] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {t(`applied_controls.reason_${item.obsolescence_state}`, {
                              defaultValue: REASON_LABELS[item.obsolescence_state] || item.obsolescence_state,
                            })}
                          </span>
                        ) : item.expiration ? (
                          <span className="text-xs text-gray-500">{item.expiration}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                        {item.days_until_expiration != null && (
                          <span className="block text-xs text-gray-400 mt-0.5">{expiryLabel(item.days_until_expiration)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-700">
                        {item.cost != null ? `$${Number(item.cost).toLocaleString()}` : "-"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openHistory(item)}
                            title={t("applied_controls.history_for", { defaultValue: "Change history for this control" })}
                            aria-label={t("applied_controls.history_for", { defaultValue: "Change history for this control" })}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          {canReferee && item.validation_status !== "validated" && (
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => runValidation(item, "validate", "")}
                              title={t("moduledash.action_validate")}
                              aria-label={t("moduledash.action_validate")}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 disabled:opacity-40"
                            >
                              {rowBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                          )}
                          {canReferee && item.validation_status !== "rejected" && (
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => { setRejecting(item); setRejectNotes(""); setActionError(""); }}
                              title={t("moduledash.action_reject")}
                              aria-label={t("moduledash.action_reject")}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 disabled:opacity-40"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              title={t("moduledash.action_edit")}
                              aria-label={t("moduledash.action_edit")}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canReferee && (
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => { setConfirmDelete(item); setDeleteReason(""); setActionError(""); }}
                              title={t("moduledash.action_delete")}
                              aria-label={t("moduledash.action_delete")}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId
                  ? t("applied_controls.edit_title", { defaultValue: "Edit applied control" })
                  : t("applied_controls.modal_title")}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.ref_id")}</label>
                  <input
                    value={form.ref_id}
                    onChange={(e) => setForm({ ...form, ref_id: e.target.value })}
                    placeholder={t("applied_controls.ref_id_placeholder")}
                    /* Not editable after creation: PATCH does not accept ref_id,
                       so an editable field here would silently discard the edit. */
                    disabled={!!editingId}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.name_label")} *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_category")}</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("applied_controls.category_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_csf")}</label>
                  <select value={form.csf_function} onChange={(e) => setForm({ ...form, csf_function: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CSF_FUNCTIONS.map((f) => <option key={f} value={f}>{t(`moduledash.vocab.${f}`, { defaultValue: f.charAt(0).toUpperCase() + f.slice(1) })}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_status")}</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{vocab(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_effort")}</label>
                  <select value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {EFFORT_OPTIONS.map((ef) => <option key={ef} value={ef}>{vocab(ef)}</option>)}
                  </select>
                </div>
              </div>
              {editingId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_progress")} (%)</label>
                  {/* 0-100 is enforced server-side (Field(ge=0, le=100)); mirrored
                      here so a typo is caught before the round trip. */}
                  <input
                    type="number" min={0} max={100} value={form.progress}
                    onChange={(e) => setForm({ ...form, progress: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_cost")}</label>
                  <input type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_recurring_cost")}</label>
                  <input type="number" min={0} value={form.recurring_cost} onChange={(e) => setForm({ ...form, recurring_cost: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_eta")}</label>
                  <input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_expiration", { defaultValue: "Expiry date" })}</label>
                  {/* The obsolescence alerts and the expiry notification both read
                      this field; a date neither can parse is an expiry that never
                      fires, which is why the server refuses anything but
                      YYYY-MM-DD and flags legacy rows as invalid_expiration. */}
                  <input type="date" value={form.expiration} onChange={(e) => setForm({ ...form, expiration: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.linked_scenarios", "Linked Risk Scenarios")}</label>
                <MultiSelect
                  options={scenarioOptions}
                  selected={form.risk_scenario_ids}
                  onChange={(ids) => setForm({ ...form, risk_scenario_ids: ids })}
                  placeholder={t("risk_scenarios.select_placeholder", "Select...")}
                  emptyLabel={t("risk_scenarios.no_options", "No matches")}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? t("common.save") : t("applied_controls.new_control")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject modal — the referent's reason travels with the decision, and is
          stored on the history row so « historique des modifications » explains
          why the control was sent back. */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRejecting(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t("moduledash.action_reject")}</h2>
              <button onClick={() => setRejecting(null)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-3">{rejecting.name}</p>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ac-reject-notes">
              {t("moduledash.reject_reason")}
            </label>
            <textarea
              id="ac-reject-notes"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setRejecting(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
              <button
                type="button"
                disabled={busyId === rejecting.id}
                onClick={() => runValidation(rejecting, "reject", rejectNotes)}
                className="inline-flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {busyId === rejecting.id && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("moduledash.action_reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal — the justification is REQUIRED by the route (min 3
          chars) and is what the deletion history row carries. */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t("moduledash.action_delete")}</h2>
              <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              {t("applied_controls.delete_confirm", {
                defaultValue:
                  "Removing this control removes a claimed mitigation from every risk that counted on it. The deletion is recorded with your justification.",
              })}
            </p>
            <p className="text-sm font-medium text-gray-900 mt-2">{confirmDelete.name}</p>
            <label className="block text-sm font-medium text-gray-700 mt-4 mb-1" htmlFor="ac-delete-reason">
              {t("applied_controls.delete_reason_label", { defaultValue: "Justification" })} *
            </label>
            <input
              id="ac-delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              minLength={MIN_DELETE_REASON}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
              <button
                type="button"
                disabled={busyId === confirmDelete.id || deleteReason.trim().length < MIN_DELETE_REASON}
                onClick={handleDelete}
                className="inline-flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {busyId === confirmDelete.id && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* « Historique des modifications visible » — register-wide, or one
          control's own trail. Read from the history table directly, so changes
          to controls that have since been deleted are still visible. */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHistoryOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("applied_controls.history_title", { defaultValue: "Change history" })}
                </h2>
                {historyFor && <span className="text-sm text-gray-500">— {historyFor.name}</span>}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={historyAction}
                  onChange={(e) => { setHistoryAction(e.target.value); loadHistory(historyFor?.id, e.target.value); }}
                  className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t("common.all")}</option>
                  {HISTORY_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`applied_controls.history_action_${a}`, { defaultValue: a.replace(/_/g, " ") })}
                    </option>
                  ))}
                </select>
                <button onClick={() => setHistoryOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}><X className="w-5 h-5" /></button>
              </div>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : historyError ? (
              <p className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800" role="status">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{historyError}</span>
              </p>
            ) : historyRows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                {t("applied_controls.history_empty", { defaultValue: "No change recorded yet." })}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-gray-50">
                  {historyRows.map((row) => (
                    <li key={row.id} className="py-3">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="w-4 h-4 mt-0.5 text-gray-300 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900">
                            <span className="font-medium">
                              {t(`applied_controls.history_action_${row.action}`, { defaultValue: row.action.replace(/_/g, " ") })}
                            </span>
                            {" — "}
                            {row.control_ref_id ? <span className="font-mono text-xs text-gray-500">{row.control_ref_id} </span> : null}
                            {row.control_name}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(row.created_at).toLocaleString()}
                            {row.actor_email ? ` · ${row.actor_email}` : ""}
                          </p>
                          {row.note && <p className="text-xs text-gray-600 mt-1 italic">{row.note}</p>}
                          {row.changes && Object.keys(row.changes).length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {Object.entries(row.changes).map(([field, change]) => {
                                const pair = change as { from?: unknown; to?: unknown } | null;
                                const from = pair && typeof pair === "object" ? pair.from : undefined;
                                const to = pair && typeof pair === "object" ? pair.to : undefined;
                                return (
                                  <li key={field} className="text-xs text-gray-500">
                                    <span className="font-medium text-gray-600">{field}</span>
                                    {": "}
                                    <span className="line-through opacity-70">{from == null || from === "" ? "—" : String(from)}</span>
                                    {" → "}
                                    <span>{to == null || to === "" ? "—" : String(to)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {historyTotal > historyRows.length && (
                  <p className="text-xs text-gray-400 pt-3">
                    {t("applied_controls.history_truncated", {
                      n: historyTotal - historyRows.length,
                      defaultValue: "{{n}} older entries are held but not listed here.",
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
