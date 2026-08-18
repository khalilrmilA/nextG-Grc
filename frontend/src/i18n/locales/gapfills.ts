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
    vector_filter_placeholder: "CVSS vector, e.g. AV:N/AC:L/...",
  },
  risk_scenarios: {
    version_history: "History", snapshot_reason_placeholder: "Reason for this snapshot (optional)",
    take_snapshot: "Snapshot now", diff_from: "From version…", diff_to: "To version…",
    compare: "Compare", no_diff: "No differences between these versions.",
    no_versions: "No snapshots yet.",
    next_review_date_label: "Next review date", overdue: "Overdue",
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
    impact_history_title: "History", impact_history_empty: "No history yet",
  },
  dashboard: {
    overview: "Overview", no_frameworks: "No frameworks", start_assessment: "Start Assessment",
    create_assessment_desc: "Create an assessment to start tracking your compliance with this framework.",
  },
  treatment: {
    linked_scenarios: "Linked risk scenarios", select_scenarios: "Select scenario(s)…", no_scenarios: "No scenarios for this risk",
    col_scenarios: "Linked scenarios", view_all: "All", view_by_responsible: "By responsible", unassigned: "Unassigned",
    group_total: "Total", group_over_budget: "Over budget", group_avg_progress: "Avg. progress",
    col_flags: "Flags", flag_at_risk: "At risk", flag_over_budget: "Over budget",
  },
  risks: {
    target_validated: "Target validated", validate_target: "Validate target", revalidate_target: "Re-validate target",
    calculation_notes: "Calculation notes (optional)", calculation_notes_placeholder: "Assumptions, methodology, evidence…",
    validate_blocked_over_appetite: "Target still exceeds the appetite threshold — strengthen the treatment plan before validating.",
    error_validate_target_failed: "Could not validate target.",
  },
  archiving: {
    export_csv: "CSV", export_pdf: "PDF",
    rules: {
      title: "Archiving rules", subtitle: "Automatically archive matching records on a recurring schedule",
      new: "New rule", empty: "No archiving rules yet.", criteria: "Criteria", status: "Status",
      enabled: "Enabled", disabled: "Disabled", next_run: "Next run", last_run: "Last run", last_result: "Last result",
      never: "Never", delete: "Delete rule", confirm_delete: "Delete this archiving rule? This cannot be undone.",
      error_create_failed: "Could not create rule", error_criteria_required: "Add at least one condition",
      builder_mode: "Use condition builder", advanced_mode: "Edit as raw text",
      add_condition: "Add condition", remove_condition: "Remove condition",
      field_placeholder: "field, e.g. status", value_placeholder: "value, e.g. closed",
      hint: "Combine conditions with AND. Operators: = != > < >= <=. Numeric fields (e.g. age_days) compare as numbers; other fields compare as case-insensitive text.",
      criteria_preview_empty: "Add a condition to see the generated criteria",
      advanced_placeholder: "e.g. status=closed AND age_days>365",
      enabled_label: "Start enabled", retention_hint: "Leave blank for default",
    },
  },
  audits: {
    form_recurrence: "Recurrence", form_recurrence_hint: "Automatically plan the next cycle when this audit closes.",
    recurrence_none: "One-time (no recurrence)", recurrence_annual: "Annual", recurrence_semi_annual: "Semi-annual",
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
    vector_filter_placeholder: "Vecteur CVSS, ex. AV:N/AC:L/...",
  },
  risk_scenarios: {
    version_history: "Historique", snapshot_reason_placeholder: "Motif de cet instantané (facultatif)",
    take_snapshot: "Créer un instantané", diff_from: "Depuis la version…", diff_to: "Vers la version…",
    compare: "Comparer", no_diff: "Aucune différence entre ces versions.",
    no_versions: "Aucun instantané pour l'instant.",
    next_review_date_label: "Date de prochaine révision", overdue: "En retard",
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
    impact_history_title: "Historique", impact_history_empty: "Aucun historique pour l'instant",
  },
  dashboard: {
    overview: "Vue d'ensemble", no_frameworks: "Aucun référentiel", start_assessment: "Démarrer l'évaluation",
    create_assessment_desc: "Créez une évaluation pour commencer à suivre votre conformité à ce référentiel.",
  },
  treatment: {
    linked_scenarios: "Scénarios de risque liés", select_scenarios: "Sélectionner un ou plusieurs scénarios…", no_scenarios: "Aucun scénario pour ce risque",
    col_scenarios: "Scénarios liés", view_all: "Tous", view_by_responsible: "Par responsable", unassigned: "Non assigné",
    group_total: "Total", group_over_budget: "Dépassement budget", group_avg_progress: "Progression moy.",
    col_flags: "Alertes", flag_at_risk: "À risque", flag_over_budget: "Dépassement budget",
  },
  risks: {
    target_validated: "Cible validée", validate_target: "Valider la cible", revalidate_target: "Revalider la cible",
    calculation_notes: "Notes de calcul (optionnel)", calculation_notes_placeholder: "Hypothèses, méthodologie, preuves…",
    validate_blocked_over_appetite: "La cible dépasse encore le seuil d'appétence — renforcez le plan de traitement avant de valider.",
    error_validate_target_failed: "Impossible de valider la cible.",
  },
  archiving: {
    export_csv: "CSV", export_pdf: "PDF",
    rules: {
      title: "Règles d'archivage", subtitle: "Archive automatiquement les enregistrements correspondants selon un calendrier récurrent",
      new: "Nouvelle règle", empty: "Aucune règle d'archivage pour le moment.", criteria: "Critères", status: "Statut",
      enabled: "Activée", disabled: "Désactivée", next_run: "Prochaine exécution", last_run: "Dernière exécution", last_result: "Dernier résultat",
      never: "Jamais", delete: "Supprimer la règle", confirm_delete: "Supprimer cette règle d'archivage ? Cette action est irréversible.",
      error_create_failed: "Impossible de créer la règle", error_criteria_required: "Ajoutez au moins une condition",
      builder_mode: "Utiliser le générateur de conditions", advanced_mode: "Modifier en texte brut",
      add_condition: "Ajouter une condition", remove_condition: "Supprimer la condition",
      field_placeholder: "champ, ex. status", value_placeholder: "valeur, ex. closed",
      hint: "Combinez les conditions avec ET. Opérateurs : = != > < >= <=. Les champs numériques (ex. age_days) sont comparés comme des nombres ; les autres champs sont comparés comme du texte insensible à la casse.",
      criteria_preview_empty: "Ajoutez une condition pour voir les critères générés",
      advanced_placeholder: "ex. status=closed AND age_days>365",
      enabled_label: "Activer dès la création", retention_hint: "Laisser vide pour la valeur par défaut",
    },
  },
  audits: {
    form_recurrence: "Récurrence", form_recurrence_hint: "Planifie automatiquement le prochain cycle à la clôture de cet audit.",
    recurrence_none: "Ponctuel (sans récurrence)", recurrence_annual: "Annuelle", recurrence_semi_annual: "Semestrielle",
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
    vector_filter_placeholder: "متجه CVSS، مثال AV:N/AC:L/...",
  },
  risk_scenarios: {
    version_history: "السجل", snapshot_reason_placeholder: "سبب هذا اللقطة (اختياري)",
    take_snapshot: "أخذ لقطة الآن", diff_from: "من الإصدار…", diff_to: "إلى الإصدار…",
    compare: "مقارنة", no_diff: "لا توجد فروقات بين هذين الإصدارين.",
    no_versions: "لا توجد لقطات بعد.",
    next_review_date_label: "تاريخ المراجعة القادمة", overdue: "متأخرة",
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
    impact_history_title: "السجل", impact_history_empty: "لا يوجد سجل بعد",
  },
  dashboard: {
    overview: "نظرة عامة", no_frameworks: "لا توجد أطر عمل", start_assessment: "بدء التقييم",
    create_assessment_desc: "أنشئ تقييمًا لبدء تتبّع امتثالك لهذا الإطار.",
  },
  treatment: {
    linked_scenarios: "سيناريوهات المخاطر المرتبطة", select_scenarios: "اختر سيناريو واحد أو أكثر…", no_scenarios: "لا توجد سيناريوهات لهذا الخطر",
    col_scenarios: "السيناريوهات المرتبطة", view_all: "الكل", view_by_responsible: "حسب المسؤول", unassigned: "غير مسند",
    group_total: "الإجمالي", group_over_budget: "تجاوز الميزانية", group_avg_progress: "متوسط التقدم",
    col_flags: "المؤشرات", flag_at_risk: "معرض للخطر", flag_over_budget: "تجاوز الميزانية",
  },
  risks: {
    target_validated: "تم التحقق من الهدف", validate_target: "التحقق من الهدف", revalidate_target: "إعادة التحقق من الهدف",
    calculation_notes: "ملاحظات الحساب (اختياري)", calculation_notes_placeholder: "الافتراضات، المنهجية، الأدلة…",
    validate_blocked_over_appetite: "لا تزال القيمة المستهدفة تتجاوز عتبة قابلية تحمل المخاطر — يجب تعزيز خطة المعالجة قبل التحقق.",
    error_validate_target_failed: "تعذر التحقق من الهدف.",
  },
  archiving: {
    export_csv: "CSV", export_pdf: "PDF",
    rules: {
      title: "قواعد الأرشفة", subtitle: "أرشفة السجلات المطابقة تلقائيًا وفق جدول زمني متكرر",
      new: "قاعدة جديدة", empty: "لا توجد قواعد أرشفة بعد.", criteria: "المعايير", status: "الحالة",
      enabled: "مفعّلة", disabled: "معطّلة", next_run: "التشغيل القادم", last_run: "آخر تشغيل", last_result: "آخر نتيجة",
      never: "أبدًا", delete: "حذف القاعدة", confirm_delete: "هل تريد حذف قاعدة الأرشفة هذه؟ لا يمكن التراجع عن هذا الإجراء.",
      error_create_failed: "تعذّر إنشاء القاعدة", error_criteria_required: "أضف شرطًا واحدًا على الأقل",
      builder_mode: "استخدام أداة إنشاء الشروط", advanced_mode: "التحرير كنص خام",
      add_condition: "إضافة شرط", remove_condition: "إزالة الشرط",
      field_placeholder: "الحقل، مثال status", value_placeholder: "القيمة، مثال closed",
      hint: "اجمع الشروط باستخدام AND. العوامل: = != > < >= <=. تُقارَن الحقول الرقمية (مثل age_days) كأرقام؛ وتُقارَن الحقول الأخرى كنص غير حساس لحالة الأحرف.",
      criteria_preview_empty: "أضف شرطًا لعرض المعايير المُولَّدة",
      advanced_placeholder: "مثال status=closed AND age_days>365",
      enabled_label: "التفعيل عند الإنشاء", retention_hint: "اتركه فارغًا لاستخدام القيمة الافتراضية",
    },
  },
  audits: {
    form_recurrence: "التكرار", form_recurrence_hint: "خطط تلقائيًا للدورة القادمة عند إغلاق هذا التدقيق.",
    recurrence_none: "لمرة واحدة (بدون تكرار)", recurrence_annual: "سنوي", recurrence_semi_annual: "نصف سنوي",
  },
};
