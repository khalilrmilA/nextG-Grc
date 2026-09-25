/**
 * FR/AR strings for the 2026-09-25 fixes (incident editing, MFA disable
 * confirmation, "create framework from scratch"). English lives in the t()
 * defaults at the call sites. Merged non-destructively in i18n/index.ts, so an
 * existing translation in the main locale files always wins.
 */
export const fixFr = {
  vulnerabilities: {
    interval_daily: "Quotidienne", interval_weekly: "Hebdomadaire", interval_monthly: "Mensuelle", interval_hours: "Toutes les {{count}} h",
    conn_update_failed: "Impossible de mettre à jour le connecteur", last_sync: "Dernière synchronisation", never_synced: "Jamais synchronisé",
    auto_sync: "Synchronisation automatique", file_import_only: "Import de fichier uniquement — exportez le rapport et utilisez Importer.",
    tool_demo: "Démo (simulée)", tools_auto_pull: "Récupère les vulnérabilités automatiquement", tools_file_only: "Import de fichier uniquement",
    tool_openvas_file: "OpenVAS / Greenbone (import de fichier uniquement)", api_username: "Nom d’utilisateur API", api_password: "Mot de passe API",
    openvas_note: "OpenVAS utilise le protocole GMP, pas HTTP : il ne peut pas être interrogé. Exportez le rapport (XML ou CSV) et utilisez Importer.",
  },
  frameworks: { create_from_scratch: "Créer de zéro" },
  mfa: {
    disable_prompt: "Saisissez le code à 6 chiffres actuel de votre application d’authentification pour désactiver la double authentification.",
    disable_confirm: "Désactiver la double authentification",
    invalid_code: "Code invalide",
  },
  incidents: {
    saved: "Incident enregistré", status_updated: "Statut mis à jour",
    error_update_failed: "Échec de la mise à jour de l’incident", error_delete_failed: "Échec de la suppression de l’incident",
    confirm_delete: "Supprimer définitivement cet incident ?", reported_by: "Signalé par", created_on: "Créé", updated_on: "Mis à jour",
    read_only_notice: "Lecture seule : seuls les analystes sécurité, les RSSI et les administrateurs peuvent modifier les incidents.",
    advance_to: "Passer à", section_overview: "Vue d’ensemble", section_timeline: "Chronologie", section_impact: "Périmètre et impact",
    section_response: "Réponse et résolution", section_breach: "Notification de violation", unassigned: "Non assigné",
    form_tags: "Étiquettes", comma_separated: "Séparées par des virgules", form_contained_at: "Contenu le", form_resolved_at: "Résolu le",
    form_affected_users: "Utilisateurs affectés (nombre)", form_financial_impact: "Impact financier", form_data_types: "Types de données affectés",
    data_types_placeholder: "ex. données personnelles, données de carte bancaire", form_business_impact: "Impact métier",
    linked_counts: "Également liés : {{risks}} risque(s), {{controls}} contrôle(s), {{vendors}} tiers",
    form_containment_actions: "Actions de confinement", form_root_cause: "Cause racine", form_remediation_actions: "Actions de remédiation",
    form_lessons_learned: "Retours d’expérience", form_post_mortem_url: "URL du post-mortem", form_notification_sent_at: "Notification envoyée le",
    form_regulatory_reference: "Référence réglementaire", regulatory_reference_placeholder: "ex. numéro de dossier auprès du régulateur",
  },
};

export const fixAr = {
  vulnerabilities: {
    interval_daily: "يوميًا", interval_weekly: "أسبوعيًا", interval_monthly: "شهريًا", interval_hours: "كل {{count}} ساعة",
    conn_update_failed: "تعذّر تحديث الموصل", last_sync: "آخر مزامنة", never_synced: "لم تتم المزامنة بعد",
    auto_sync: "مزامنة تلقائية", file_import_only: "استيراد الملفات فقط — صدّر التقرير واستخدم الاستيراد.",
    tool_demo: "تجريبي (محاكاة)", tools_auto_pull: "يجلب النتائج تلقائيًا", tools_file_only: "استيراد الملفات فقط",
    tool_openvas_file: "OpenVAS / Greenbone (استيراد الملفات فقط)", api_username: "اسم مستخدم API", api_password: "كلمة مرور API",
    openvas_note: "يستخدم OpenVAS بروتوكول GMP وليس HTTP، لذا لا يمكن جلب نتائجه. صدّر التقرير (XML أو CSV) واستخدم الاستيراد.",
  },
  frameworks: { create_from_scratch: "إنشاء من الصفر" },
  mfa: {
    disable_prompt: "أدخل الرمز الحالي المكوّن من 6 أرقام من تطبيق المصادقة لإيقاف المصادقة الثنائية.",
    disable_confirm: "إيقاف المصادقة الثنائية",
    invalid_code: "رمز غير صالح",
  },
  incidents: {
    saved: "تم حفظ الحادث", status_updated: "تم تحديث الحالة",
    error_update_failed: "تعذّر تحديث الحادث", error_delete_failed: "تعذّر حذف الحادث",
    confirm_delete: "حذف هذا الحادث نهائيًا؟", reported_by: "أبلغ عنه", created_on: "تاريخ الإنشاء", updated_on: "آخر تحديث",
    read_only_notice: "للقراءة فقط: لا يمكن تعديل الحوادث إلا لمحللي الأمن ومسؤولي أمن المعلومات والمسؤولين.",
    advance_to: "الانتقال إلى", section_overview: "نظرة عامة", section_timeline: "التسلسل الزمني", section_impact: "النطاق والأثر",
    section_response: "الاستجابة والمعالجة", section_breach: "الإخطار بالاختراق", unassigned: "غير مُسند",
    form_tags: "الوسوم", comma_separated: "مفصولة بفواصل", form_contained_at: "تاريخ الاحتواء", form_resolved_at: "تاريخ الحل",
    form_affected_users: "المستخدمون المتأثرون (العدد)", form_financial_impact: "الأثر المالي", form_data_types: "أنواع البيانات المتأثرة",
    data_types_placeholder: "مثال: بيانات شخصية، بيانات بطاقات الدفع", form_business_impact: "الأثر على الأعمال",
    linked_counts: "مرتبط أيضًا بـ: {{risks}} خطر، {{controls}} ضابط، {{vendors}} طرف ثالث",
    form_containment_actions: "إجراءات الاحتواء", form_root_cause: "السبب الجذري", form_remediation_actions: "إجراءات المعالجة",
    form_lessons_learned: "الدروس المستفادة", form_post_mortem_url: "رابط تحليل ما بعد الحادث", form_notification_sent_at: "تاريخ إرسال الإخطار",
    form_regulatory_reference: "المرجع التنظيمي", regulatory_reference_placeholder: "مثال: رقم الملف لدى الجهة التنظيمية",
  },
};
