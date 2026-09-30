/**
 * UI strings for the audit_docs screens (i18n sweep 2026-09-28): keys for text that
 * used to be hard-coded English, plus FR/AR for keys that lacked them. Merged
 * non-destructively in i18n/index.ts — an existing translation always wins.
 *
 * Arabic plural keys: i18next asks Intl.PluralRules("ar") for one of six categories
 * (zero/one/two/few/many/other); a missing category falls back to the ENGLISH string,
 * so every count-driven key used on these screens carries the full Arabic set here.
 */
const bundle: { en: Record<string, any>; fr: Record<string, any>; ar: Record<string, any> } = {
  en: {
    "audit_plan_ui": {
      "controls_count": "{{count}} controls",
      "controls_count_one": "{{count}} control",
      "controls_count_other": "{{count}} controls"
    },
    "auditor_portal": {
      "logo_alt": "GRC Eye — Governance, Risk & Compliance Platform"
    },
    "auditor": {
      "title": "Audit Portal",
      "subtitle": "The engagements you were appointed to, and the documents that go with them",
      "stat_engagements": "Engagements",
      "stat_reviewed": "Items reviewed",
      "stat_open_findings": "Open findings",
      "engagements": "My engagements",
      "no_engagements": "No engagement assigned yet",
      "no_engagements_hint": "The audit team will appoint you to an engagement. It will appear here.",
      "open_checklist": "Open checklist",
      "company_documents": "Company documents",
      "no_documents": "No documents yet",
      "no_documents_hint": "The audited entity has not published any policy or procedure yet.",
      "back_to_portal": "Back to portal",
      "evidence_needs_engagement": "Evidence can only be attached from an audit engagement."
    },
    "audit_report": {
      "statuses": {
        "distributed": "Distributed"
      },
      "nonconformities_count": "{{count}} non-conformities"
    },
    "audits": {
      "register_truncated": "Only the {{n}} most recent engagements are shown; the figures above cover those alone. Narrow the filters to see the rest.",
      "show_withdrawn": "Also show withdrawn engagements"
    },
    "audit_grid": {
      "seed_replace": "Replace the existing lines"
    },
    "ocr_ui": {
      "lang_fra_eng": "French + English",
      "lang_fra": "French",
      "lang_eng": "English",
      "lang_ara_fra": "Arabic + French",
      "lang_ara_eng": "Arabic + English",
      "lang_ara": "Arabic"
    },
    "ocr": {
      "tidy": "Tidy spacing",
      "tidy_hint": "Collapse odd letter-spacing from the PDF text layer (e.g. 'SI MUL ATI ON' → 'SIMULATION')"
    },
    "reports_ui": {
      "last_status_sent": "Sent to {{sent}}/{{total}} recipients",
      "last_status_no_recipients": "No recipients",
      "last_status_unknown_type": "Unknown report type",
      "last_status_refused": "Refused",
      "last_status_generation_error": "Generation error"
    },
    "reports": {
      "history_title": "Report archive",
      "history_subtitle": "Every generated report is archived with its version number and a SHA-256 fingerprint of the file served.",
      "no_history": "No report has been generated yet."
    },
    "support_ui": {
      "support_replied": "Support replied",
      "end_chat": "End chat",
      "support_sender": "Support — {{name}}",
      "chat_badge": "Chat"
    },
    "policies_ui": {
      "categories": {
        "security": "Security",
        "hr": "HR",
        "data_governance": "Data Governance",
        "vendor_risk": "Vendor Risk",
        "bcp_dr": "BCP / DR",
        "legal_compliance": "Legal & Compliance",
        "privacy": "Privacy",
        "physical_security": "Physical Security"
      },
      "review_months": "{{n}} months"
    },
    "policies": {
      "restore_confirm": "Restore version {{num}} as the current version?\n\nA new version is created holding its content. Nothing is deleted — the version being replaced stays in the history.",
      "restore_failed": "Could not restore that version.",
      "restore_version": "Restore this version"
    },
    "doc_generator": {
      "industries": {
        "technology": "Technology / SaaS",
        "financial": "Financial Services",
        "healthcare": "Healthcare",
        "retail": "Retail & E-commerce",
        "manufacturing": "Manufacturing",
        "professional": "Professional Services",
        "government": "Government",
        "education": "Education",
        "energy": "Energy & Utilities",
        "telecom": "Telecommunications",
        "other": "Other"
      },
      "cat_short": {
        "foundation": "Foundation",
        "policies": "Policies",
        "procedures": "Procedures",
        "plans": "Plans"
      },
      "sizes": {
        "startup": "Startup",
        "startup_sub": "1–50 employees",
        "smb": "SMB",
        "smb_sub": "51–500 employees",
        "midmarket": "Mid-Market",
        "midmarket_sub": "501–5,000 employees",
        "enterprise": "Enterprise",
        "enterprise_sub": "5,000+ employees"
      },
      "general_group": "General",
      "policy_description": "AI-generated {{doc}} for {{org}}. Industry: {{industry}}. Frameworks: {{frameworks}}.",
      "delete_failed": "Delete failed: {{detail}}",
      "summary_regenerated": "Regenerated with AI",
      "summary_initial": "Initial version",
      "summary_edited": "Edited in Doc Generator",
      "summary_approved": "Approved in Doc Generator",
      "org_placeholder": "Acme Corp",
      "country_placeholder": "US, France, UK…",
      "requirements_placeholder": "e.g. We process EU personal data (GDPR), we have PCI scope for card payments…",
      "no_content": "No content found for this document.",
      "load_failed": "Failed to load document content."
    },
    "recommendations": {
      "rollup_done": "{{count}} recommendations updated.",
      "days_late": "{{count}} days late"
    }
  },
  fr: {
    "audit_plan_ui": {
      "controls_count": "{{count}} contrôle(s)",
      "controls_count_one": "{{count}} contrôle",
      "controls_count_many": "{{count}} contrôles",
      "controls_count_other": "{{count}} contrôles"
    },
    "auditor_portal": {
      "logo_alt": "GRC Eye — Plateforme de gouvernance, risques et conformité"
    },
    "auditor": {
      "title": "Portail d'audit",
      "subtitle": "Les missions auxquelles vous avez été affecté(e) et les documents associés",
      "stat_engagements": "Missions",
      "stat_reviewed": "Éléments revus",
      "stat_open_findings": "Constats ouverts",
      "engagements": "Mes missions",
      "no_engagements": "Aucune mission assignée pour le moment",
      "no_engagements_hint": "L'équipe d'audit vous affectera à une mission. Elle apparaîtra ici.",
      "open_checklist": "Ouvrir la checklist",
      "company_documents": "Documents de l'entreprise",
      "no_documents": "Aucun document pour le moment",
      "no_documents_hint": "L'entité auditée n'a encore publié aucune politique ni procédure.",
      "back_to_portal": "Retour au portail",
      "evidence_needs_engagement": "Les preuves ne peuvent être jointes que depuis une mission d'audit."
    },
    "audit_report": {
      "statuses": {
        "distributed": "Diffusé"
      },
      "nonconformities_count": "{{count}} non-conformités"
    },
    "audits": {
      "register_truncated": "Seules les {{n}} missions les plus récentes sont affichées ; les chiffres ci-dessus ne portent que sur celles-ci. Affinez les filtres pour voir les autres.",
      "show_withdrawn": "Afficher aussi les missions retirées"
    },
    "audit_grid": {
      "seed_replace": "Remplacer les lignes existantes"
    },
    "ocr_ui": {
      "lang_fra_eng": "Français + Anglais",
      "lang_fra": "Français",
      "lang_eng": "Anglais",
      "lang_ara_fra": "Arabe + Français",
      "lang_ara_eng": "Arabe + Anglais",
      "lang_ara": "Arabe"
    },
    "ocr": {
      "tidy": "Nettoyer les espacements",
      "tidy_hint": "Corrige l'espacement anormal des lettres dans la couche texte du PDF (ex. « SI MUL ATI ON » → « SIMULATION »)"
    },
    "reports_ui": {
      "last_status_sent": "Envoyé à {{sent}}/{{total}} destinataires",
      "last_status_no_recipients": "Aucun destinataire",
      "last_status_unknown_type": "Type de rapport inconnu",
      "last_status_refused": "Refusé",
      "last_status_generation_error": "Erreur de génération"
    },
    "reports": {
      "history_title": "Archive des rapports",
      "history_subtitle": "Chaque rapport généré est archivé avec son numéro de version et l'empreinte SHA-256 du fichier délivré.",
      "no_history": "Aucun rapport n'a encore été généré."
    },
    "support_ui": {
      "support_replied": "Le support a répondu",
      "end_chat": "Terminer la discussion",
      "support_sender": "Support — {{name}}",
      "chat_badge": "Discussion"
    },
    "policies_ui": {
      "categories": {
        "security": "Sécurité",
        "hr": "RH",
        "data_governance": "Gouvernance des données",
        "vendor_risk": "Risque fournisseurs",
        "bcp_dr": "PCA / PRA",
        "legal_compliance": "Juridique et conformité",
        "privacy": "Protection de la vie privée",
        "physical_security": "Sécurité physique"
      },
      "review_months": "{{n}} mois"
    },
    "policies": {
      "restore_confirm": "Restaurer la version {{num}} comme version courante ?\n\nUne nouvelle version est créée avec son contenu. Rien n'est supprimé — la version remplacée reste dans l'historique.",
      "restore_failed": "Impossible de restaurer cette version.",
      "restore_version": "Restaurer cette version"
    },
    "doc_generator": {
      "industries": {
        "technology": "Technologie / SaaS",
        "financial": "Services financiers",
        "healthcare": "Santé",
        "retail": "Commerce de détail et e-commerce",
        "manufacturing": "Industrie manufacturière",
        "professional": "Services professionnels",
        "government": "Secteur public",
        "education": "Éducation",
        "energy": "Énergie et services publics",
        "telecom": "Télécommunications",
        "other": "Autre"
      },
      "cat_short": {
        "foundation": "Fondamentaux",
        "policies": "Politiques",
        "procedures": "Procédures",
        "plans": "Plans"
      },
      "sizes": {
        "startup": "Start-up",
        "startup_sub": "1 à 50 employés",
        "smb": "PME",
        "smb_sub": "51 à 500 employés",
        "midmarket": "ETI",
        "midmarket_sub": "501 à 5 000 employés",
        "enterprise": "Grande entreprise",
        "enterprise_sub": "Plus de 5 000 employés"
      },
      "general_group": "Général",
      "policy_description": "Document généré par IA — {{doc}} — pour {{org}}. Secteur : {{industry}}. Référentiels : {{frameworks}}.",
      "delete_failed": "Échec de la suppression : {{detail}}",
      "summary_regenerated": "Régénéré par IA",
      "summary_initial": "Version initiale",
      "summary_edited": "Modifié dans le générateur de documents",
      "summary_approved": "Approuvé dans le générateur de documents",
      "org_placeholder": "Société Exemple",
      "country_placeholder": "France, Tunisie, Maroc…",
      "requirements_placeholder": "ex. Nous traitons des données personnelles de l'UE (RGPD), nous avons un périmètre PCI pour les paiements par carte…",
      "no_content": "Aucun contenu trouvé pour ce document.",
      "load_failed": "Impossible de charger le contenu du document."
    },
    "recommendations": {
      "rollup_done": "{{count}} recommandations mises à jour.",
      "days_late": "{{count}} jours de retard"
    }
  },
  ar: {
    "audit_plan_ui": {
      "controls_count": "عدد الضوابط: {{count}}",
      "controls_count_zero": "لا توجد ضوابط",
      "controls_count_one": "ضابط واحد",
      "controls_count_two": "ضابطان",
      "controls_count_few": "{{count}} ضوابط",
      "controls_count_many": "{{count}} ضابطًا",
      "controls_count_other": "{{count}} ضابط"
    },
    "auditor_portal": {
      "logo_alt": "GRC Eye — منصة الحوكمة والمخاطر والامتثال"
    },
    "auditor": {
      "title": "بوابة التدقيق",
      "subtitle": "المهام التي عُيّنت لها والمستندات المرتبطة بها",
      "stat_engagements": "المهام",
      "stat_reviewed": "البنود المراجَعة",
      "stat_open_findings": "الملاحظات المفتوحة",
      "engagements": "مهامي",
      "no_engagements": "لم تُسند إليك أي مهمة بعد",
      "no_engagements_hint": "سيعيّنك فريق التدقيق في مهمة، وستظهر هنا.",
      "open_checklist": "فتح قائمة التحقق",
      "company_documents": "مستندات الشركة",
      "no_documents": "لا توجد مستندات بعد",
      "no_documents_hint": "لم تنشر الجهة الخاضعة للتدقيق أي سياسة أو إجراء بعد.",
      "back_to_portal": "العودة إلى البوابة",
      "evidence_needs_engagement": "لا يمكن إرفاق الأدلة إلا من خلال مهمة تدقيق."
    },
    "audit_report": {
      "statuses": {
        "distributed": "موزّع"
      },
      "nonconformities_count_zero": "لا توجد حالات عدم مطابقة",
      "nonconformities_count_two": "حالتا عدم مطابقة",
      "nonconformities_count_few": "{{count}} حالات عدم مطابقة",
      "nonconformities_count_many": "{{count}} حالة عدم مطابقة",
      "nonconformities_count": "{{count}} حالات عدم مطابقة"
    },
    "audits": {
      "register_truncated": "تُعرض فقط أحدث {{n}} مهمة؛ الأرقام أعلاه تخصها وحدها. ضيّق عوامل التصفية لعرض البقية.",
      "show_withdrawn": "إظهار المهام المسحوبة أيضاً"
    },
    "audit_grid": {
      "seed_replace": "استبدال البنود الموجودة"
    },
    "ocr_ui": {
      "lang_fra_eng": "الفرنسية + الإنجليزية",
      "lang_fra": "الفرنسية",
      "lang_eng": "الإنجليزية",
      "lang_ara_fra": "العربية + الفرنسية",
      "lang_ara_eng": "العربية + الإنجليزية",
      "lang_ara": "العربية"
    },
    "ocr": {
      "tidy": "تنظيم المسافات",
      "tidy_hint": "دمج الأحرف المتباعدة بشكل غير طبيعي في الطبقة النصية لملف PDF (مثال: 'SI MUL ATI ON' ← 'SIMULATION')"
    },
    "reports_ui": {
      "last_status_sent": "أُرسل إلى {{sent}}/{{total}} من المستلمين",
      "last_status_no_recipients": "لا يوجد مستلمون",
      "last_status_unknown_type": "نوع تقرير غير معروف",
      "last_status_refused": "مرفوض",
      "last_status_generation_error": "خطأ في الإنشاء"
    },
    "reports": {
      "history_title": "أرشيف التقارير",
      "history_subtitle": "يُؤرشف كل تقرير يتم إنشاؤه مع رقم إصداره وبصمة SHA-256 للملف المُسلَّم.",
      "no_history": "لم يتم إنشاء أي تقرير بعد."
    },
    "support_ui": {
      "support_replied": "ردّ فريق الدعم",
      "end_chat": "إنهاء المحادثة",
      "support_sender": "الدعم — {{name}}",
      "chat_badge": "محادثة"
    },
    "policies_ui": {
      "categories": {
        "security": "الأمن",
        "hr": "الموارد البشرية",
        "data_governance": "حوكمة البيانات",
        "vendor_risk": "مخاطر الموردين",
        "bcp_dr": "استمرارية الأعمال / التعافي من الكوارث",
        "legal_compliance": "الشؤون القانونية والامتثال",
        "privacy": "الخصوصية",
        "physical_security": "الأمن المادي"
      },
      "review_months": "{{n}} شهرًا"
    },
    "policies": {
      "restore_confirm": "استعادة الإصدار {{num}} كإصدار حالي؟\n\nسيُنشأ إصدار جديد يتضمن محتواه. لن يُحذف شيء — يبقى الإصدار المستبدَل في السجل.",
      "restore_failed": "تعذّرت استعادة هذا الإصدار.",
      "restore_version": "استعادة هذا الإصدار"
    },
    "doc_generator": {
      "industries": {
        "technology": "التكنولوجيا / SaaS",
        "financial": "الخدمات المالية",
        "healthcare": "الرعاية الصحية",
        "retail": "التجزئة والتجارة الإلكترونية",
        "manufacturing": "التصنيع",
        "professional": "الخدمات المهنية",
        "government": "القطاع الحكومي",
        "education": "التعليم",
        "energy": "الطاقة والمرافق",
        "telecom": "الاتصالات",
        "other": "أخرى"
      },
      "cat_short": {
        "foundation": "التأسيسية",
        "policies": "السياسات",
        "procedures": "الإجراءات",
        "plans": "الخطط"
      },
      "sizes": {
        "startup": "شركة ناشئة",
        "startup_sub": "1–50 موظفًا",
        "smb": "شركة صغيرة ومتوسطة",
        "smb_sub": "51–500 موظف",
        "midmarket": "شركة متوسطة الحجم",
        "midmarket_sub": "501–5,000 موظف",
        "enterprise": "مؤسسة كبيرة",
        "enterprise_sub": "أكثر من 5,000 موظف"
      },
      "general_group": "عام",
      "policy_description": "مستند مُنشأ بالذكاء الاصطناعي — {{doc}} — لصالح {{org}}. القطاع: {{industry}}. الأطر المرجعية: {{frameworks}}.",
      "delete_failed": "فشل الحذف: {{detail}}",
      "summary_regenerated": "أُعيد إنشاؤه بالذكاء الاصطناعي",
      "summary_initial": "الإصدار الأولي",
      "summary_edited": "عُدّل في مولّد المستندات",
      "summary_approved": "اعتُمد في مولّد المستندات",
      "org_placeholder": "شركة المثال",
      "country_placeholder": "تونس، الإمارات، السعودية…",
      "requirements_placeholder": "مثال: نعالج بيانات شخصية لمواطني الاتحاد الأوروبي (GDPR)، ولدينا نطاق PCI لمدفوعات البطاقات…",
      "no_content": "لم يُعثر على أي محتوى لهذا المستند.",
      "load_failed": "تعذّر تحميل محتوى المستند."
    },
    "recommendations": {
      "days_late_zero": "غير متأخرة",
      "days_late_two": "متأخرة بيومين",
      "days_late_few": "متأخرة بـ {{count}} أيام",
      "days_late_many": "متأخرة بـ {{count}} يومًا",
      "rollup_done_zero": "لم يتم تحديث أي توصية.",
      "rollup_done_two": "تم تحديث توصيتين.",
      "rollup_done_few": "تم تحديث {{count}} توصيات.",
      "rollup_done_many": "تم تحديث {{count}} توصية.",
      "rollup_done": "تم تحديث {{count}} توصيات.",
      "days_late": "متأخرة بـ {{count}} أيام"
    }
  },
};
export default bundle;
