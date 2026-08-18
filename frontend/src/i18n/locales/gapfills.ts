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
  ocr: {
    page: "Page", chars_short: "{{n}} chars", download_pdf: "Download PDF",
    empty_page: "— no text on this page —", err_pdf: "Could not generate the PDF. Please try again.",
  },
  settings: { no_sessions: "No active sessions." },
  vulnerabilities: { validate: "Validate", confirm_delete: "Delete this vulnerability?" },
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
  ocr: {
    page: "Page", chars_short: "{{n}} caractères", download_pdf: "Télécharger le PDF",
    empty_page: "— aucun texte sur cette page —", err_pdf: "Impossible de générer le PDF. Veuillez réessayer.",
  },
  settings: { no_sessions: "Aucune session active." },
  vulnerabilities: { validate: "Valider", confirm_delete: "Supprimer cette vulnérabilité ?" },
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
  ocr: {
    page: "صفحة", chars_short: "{{n}} حرف", download_pdf: "تنزيل PDF",
    empty_page: "— لا يوجد نص في هذه الصفحة —", err_pdf: "تعذّر إنشاء ملف PDF. يُرجى المحاولة مرة أخرى.",
  },
  settings: { no_sessions: "لا توجد جلسات نشطة." },
  vulnerabilities: { validate: "تحقّق", confirm_delete: "حذف هذه الثغرة؟" },
  dashboard: {
    overview: "نظرة عامة", no_frameworks: "لا توجد أطر عمل", start_assessment: "بدء التقييم",
    create_assessment_desc: "أنشئ تقييمًا لبدء تتبّع امتثالك لهذا الإطار.",
  },
};
