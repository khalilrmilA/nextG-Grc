/**
 * Gap-fill translations.
 *
 * Recently-added feature strings (MFA/CVE/OCR/vulnerability actions/active sessions/
 * action plan/upload history) shipped with inline t("key", "English default") fallbacks
 * that were never added to the main locale files — so they rendered English in the FR/AR
 * UI. A per-language audit (EN/FR/AR) found exactly these 27 keys missing from every
 * locale source. They are merged on top of the main bundles via addResourceBundle with
 * deep=true, overwrite=false in i18n/index.ts — purely additive, never clobbers an
 * existing translation. Placeholders ({{n}}) preserved; proper nouns (CVE/PDF/OCR) kept.
 */
export const gapEn = {
  common: { category: "Category", error_generic: "Something went wrong. Please try again.", saving: "Saving…" },
  action_plan: { mark_done: "Mark as Done", mark_in_progress: "Start", reopen: "Reopen", start: "Start" },
  compliance: {
    doc_history_title: "Upload History", doc_history_empty: "No documents uploaded yet.",
    doc_history_hidden: "Hidden from auditor", doc_history_latest: "LATEST", doc_history_preview: "Preview",
  },
  cve: {
    count_label: "CVEs", load_more: "Load more", showing: "Showing",
    col_notes: "Notes", notes_label: "Internal notes",
    notes_placeholder: "Why this CVE matters (or doesn't) for our environment...",
    linked_assets_label: "Linked assets", error_save_failed: "Failed to save",
  },
  risk_scenarios: {
    version_history: "History", snapshot_reason_placeholder: "Reason for this snapshot (optional)",
    take_snapshot: "Snapshot now", diff_from: "From version…", diff_to: "To version…",
    compare: "Compare", no_diff: "No differences between these versions.",
    no_versions: "No snapshots yet.",
  },
  asset_graph: {
    title: "Asset Cartography", subtitle: "Interactive map of org entities, business processes, and the assets that support them",
    empty: "No org entities or business processes yet. Create some on the left to see the graph.",
    legend: "Legend", type_entity: "Org Entity", type_process: "Business Process", type_asset: "Asset",
    stat_entities: "Entities", stat_processes: "Processes", stat_assets: "Assets", stat_edges: "Links",
    selected: "Selected", connections: "{{count}} direct connection(s)",
    org_entities: "Org Entities", business_processes: "Business Processes",
    entity_name_placeholder: "Entity name", entity_type_placeholder: "Type (e.g. department, branch)",
    no_parent: "No parent (top-level)", no_entities: "No entities yet.",
    process_name_placeholder: "Process name", no_entity: "No entity", no_owner: "No owner",
    no_processes: "No processes yet.",
    confirm_delete_entity: "Delete this org entity? Child entities and processes will be detached, not deleted.",
    confirm_delete_process: "Delete this business process?",
    filter_all_entities: "All entities", filter_all_asset_types: "All asset types", clear_filters: "Clear filters",
  },
  policies: {
    effective_date_label: "Effective Date", expiration_date_label: "Expiration Date",
    business_process_label: "Business Process", org_entity_label: "Org Entity",
    no_process: "None", no_entity: "None",
  },
  applied_controls: {
    linked_scenarios: "Linked Risk Scenarios",
    kpi_total: "Total Controls", kpi_implemented: "Implemented", kpi_in_progress: "In Progress", kpi_total_cost: "Total Cost",
  },
  assets: {
    eol_banner_title: "{{count}} asset(s) approaching or past end-of-life",
  },
  ocr: {
    page: "Page", chars_short: "{{n}} chars", download_pdf: "Download PDF",
    empty_page: "— no text on this page —", err_pdf: "Could not generate the PDF. Please try again.",
  },
  settings: { no_sessions: "No active sessions." },
  vulnerabilities: {
    validate: "Validate", confirm_delete: "Delete this vulnerability?",
    impact_title: "Impact Score", impact_manual: "Manual override",
    impact_recalculate: "Recalculate", impact_override_btn: "Override manually",
    impact_override_value: "Override value (0-100)", impact_justification: "Justification",
    impact_justification_required: "A justification is required to override the score",
    impact_context_default: "Default context",
  },
  dashboard: {
    overview: "Overview", no_frameworks: "No frameworks", start_assessment: "Start Assessment",
    create_assessment_desc: "Create an assessment to start tracking your compliance with this framework.",
  },
};

export const gapFr = {
  common: { category: "Catégorie", error_generic: "Une erreur s'est produite. Veuillez réessayer.", saving: "Enregistrement…" },
  action_plan: { mark_done: "Marquer comme terminé", mark_in_progress: "Démarrer", reopen: "Rouvrir", start: "Démarrer" },
  compliance: {
    doc_history_title: "Historique des imports", doc_history_empty: "Aucun document importé pour le moment.",
    doc_history_hidden: "Masqué pour l'auditeur", doc_history_latest: "DERNIER", doc_history_preview: "Aperçu",
  },
  cve: {
    count_label: "CVE", load_more: "Charger plus", showing: "Affichage",
    col_notes: "Notes", notes_label: "Notes internes",
    notes_placeholder: "Pourquoi ce CVE compte (ou pas) pour notre environnement...",
    linked_assets_label: "Actifs liés", error_save_failed: "Échec de l'enregistrement",
  },
  risk_scenarios: {
    version_history: "Historique", snapshot_reason_placeholder: "Motif de cet instantané (facultatif)",
    take_snapshot: "Créer un instantané", diff_from: "Depuis la version…", diff_to: "Vers la version…",
    compare: "Comparer", no_diff: "Aucune différence entre ces versions.",
    no_versions: "Aucun instantané pour l'instant.",
  },
  asset_graph: {
    title: "Cartographie des actifs", subtitle: "Carte interactive des entités organisationnelles, processus métiers et actifs qui les soutiennent",
    empty: "Aucune entité ni processus métier pour l'instant. Créez-en à gauche pour voir le graphe.",
    legend: "Légende", type_entity: "Entité organisationnelle", type_process: "Processus métier", type_asset: "Actif",
    stat_entities: "Entités", stat_processes: "Processus", stat_assets: "Actifs", stat_edges: "Liens",
    selected: "Sélection", connections: "{{count}} connexion(s) directe(s)",
    org_entities: "Entités organisationnelles", business_processes: "Processus métiers",
    entity_name_placeholder: "Nom de l'entité", entity_type_placeholder: "Type (ex. département, agence)",
    no_parent: "Aucun parent (niveau supérieur)", no_entities: "Aucune entité pour l'instant.",
    process_name_placeholder: "Nom du processus", no_entity: "Aucune entité", no_owner: "Aucun propriétaire",
    no_processes: "Aucun processus pour l'instant.",
    confirm_delete_entity: "Supprimer cette entité ? Les entités et processus enfants seront détachés, pas supprimés.",
    confirm_delete_process: "Supprimer ce processus métier ?",
    filter_all_entities: "Toutes les entités", filter_all_asset_types: "Tous les types d'actifs", clear_filters: "Effacer les filtres",
  },
  policies: {
    effective_date_label: "Date de mise en vigueur", expiration_date_label: "Date d'expiration",
    business_process_label: "Processus métier", org_entity_label: "Entité organisationnelle",
    no_process: "Aucun", no_entity: "Aucune",
  },
  applied_controls: {
    linked_scenarios: "Scénarios de risque liés",
    kpi_total: "Total des contrôles", kpi_implemented: "Implémentés", kpi_in_progress: "En cours", kpi_total_cost: "Coût total",
  },
  assets: {
    eol_banner_title: "{{count}} actif(s) en fin de vie ou proches de la fin de vie",
  },
  ocr: {
    page: "Page", chars_short: "{{n}} caractères", download_pdf: "Télécharger le PDF",
    empty_page: "— aucun texte sur cette page —", err_pdf: "Impossible de générer le PDF. Veuillez réessayer.",
  },
  settings: { no_sessions: "Aucune session active." },
  vulnerabilities: {
    validate: "Valider", confirm_delete: "Supprimer cette vulnérabilité ?",
    impact_title: "Score d'impact", impact_manual: "Ajustement manuel",
    impact_recalculate: "Recalculer", impact_override_btn: "Ajuster manuellement",
    impact_override_value: "Valeur ajustée (0-100)", impact_justification: "Justification",
    impact_justification_required: "Une justification est requise pour ajuster le score",
    impact_context_default: "Contexte par défaut",
  },
  dashboard: {
    overview: "Vue d'ensemble", no_frameworks: "Aucun référentiel", start_assessment: "Démarrer l'évaluation",
    create_assessment_desc: "Créez une évaluation pour commencer à suivre votre conformité à ce référentiel.",
  },
};

export const gapAr = {
  common: { category: "الفئة", error_generic: "حدث خطأ ما. يُرجى المحاولة مرة أخرى.", saving: "جارٍ الحفظ…" },
  action_plan: { mark_done: "وضع كمنجز", mark_in_progress: "بدء", reopen: "إعادة فتح", start: "بدء" },
  compliance: {
    doc_history_title: "سجل الرفع", doc_history_empty: "لم تُرفع أي وثائق بعد.",
    doc_history_hidden: "مخفي عن المدقق", doc_history_latest: "الأحدث", doc_history_preview: "معاينة",
  },
  cve: {
    count_label: "ثغرات CVE", load_more: "تحميل المزيد", showing: "عرض",
    col_notes: "ملاحظات", notes_label: "ملاحظات داخلية",
    notes_placeholder: "لماذا تهم (أو لا تهم) هذه الثغرة بيئتنا...",
    linked_assets_label: "الأصول المرتبطة", error_save_failed: "فشل الحفظ",
  },
  risk_scenarios: {
    version_history: "السجل", snapshot_reason_placeholder: "سبب هذا اللقطة (اختياري)",
    take_snapshot: "أخذ لقطة الآن", diff_from: "من الإصدار…", diff_to: "إلى الإصدار…",
    compare: "مقارنة", no_diff: "لا توجد فروقات بين هذين الإصدارين.",
    no_versions: "لا توجد لقطات بعد.",
  },
  asset_graph: {
    title: "خارطة الأصول", subtitle: "خريطة تفاعلية للكيانات التنظيمية والعمليات التجارية والأصول التي تدعمها",
    empty: "لا توجد كيانات تنظيمية أو عمليات تجارية بعد. أنشئ بعضها على اليسار لرؤية الرسم البياني.",
    legend: "المفتاح", type_entity: "كيان تنظيمي", type_process: "عملية تجارية", type_asset: "أصل",
    stat_entities: "الكيانات", stat_processes: "العمليات", stat_assets: "الأصول", stat_edges: "الروابط",
    selected: "المحدد", connections: "{{count}} اتصال مباشر",
    org_entities: "الكيانات التنظيمية", business_processes: "العمليات التجارية",
    entity_name_placeholder: "اسم الكيان", entity_type_placeholder: "النوع (مثل قسم، فرع)",
    no_parent: "بدون أصل (المستوى الأعلى)", no_entities: "لا توجد كيانات بعد.",
    process_name_placeholder: "اسم العملية", no_entity: "بدون كيان", no_owner: "بدون مالك",
    no_processes: "لا توجد عمليات بعد.",
    confirm_delete_entity: "حذف هذا الكيان؟ سيتم فصل الكيانات والعمليات الفرعية، دون حذفها.",
    confirm_delete_process: "حذف هذه العملية التجارية؟",
    filter_all_entities: "جميع الكيانات", filter_all_asset_types: "جميع أنواع الأصول", clear_filters: "مسح الفلاتر",
  },
  policies: {
    effective_date_label: "تاريخ السريان", expiration_date_label: "تاريخ الانتهاء",
    business_process_label: "العملية التجارية", org_entity_label: "الكيان التنظيمي",
    no_process: "بدون", no_entity: "بدون",
  },
  applied_controls: {
    linked_scenarios: "سيناريوهات المخاطر المرتبطة",
    kpi_total: "إجمالي الضوابط", kpi_implemented: "منفَّذة", kpi_in_progress: "قيد التنفيذ", kpi_total_cost: "التكلفة الإجمالية",
  },
  assets: {
    eol_banner_title: "{{count}} أصل يقترب من أو تجاوز نهاية العمر الافتراضي",
  },
  ocr: {
    page: "صفحة", chars_short: "{{n}} حرف", download_pdf: "تنزيل PDF",
    empty_page: "— لا يوجد نص في هذه الصفحة —", err_pdf: "تعذّر إنشاء ملف PDF. يُرجى المحاولة مرة أخرى.",
  },
  settings: { no_sessions: "لا توجد جلسات نشطة." },
  vulnerabilities: {
    validate: "تحقّق", confirm_delete: "حذف هذه الثغرة؟",
    impact_title: "درجة التأثير", impact_manual: "تعديل يدوي",
    impact_recalculate: "إعادة الحساب", impact_override_btn: "تعديل يدويًا",
    impact_override_value: "القيمة المعدَّلة (0-100)", impact_justification: "التبرير",
    impact_justification_required: "التبرير مطلوب لتعديل الدرجة",
    impact_context_default: "السياق الافتراضي",
  },
  dashboard: {
    overview: "نظرة عامة", no_frameworks: "لا توجد أطر عمل", start_assessment: "بدء التقييم",
    create_assessment_desc: "أنشئ تقييمًا لبدء تتبّع امتثالك لهذا الإطار.",
  },
};
