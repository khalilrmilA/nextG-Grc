/**
 * Commercial packages (2026-10-19): marketing display names for the stored tier
 * values and the plan-limit (HTTP 402 "plan_limit") / usage-banner strings.
 *
 *   professional (and legacy starter, and any trial) -> Growth
 *   enterprise                                        -> Enterprise
 *   elite                                             -> Elite
 *
 * Merged DESTRUCTIVELY in i18n/index.ts on purpose: the plan-name keys below
 * replace the older "Professional" / "Starter" labels everywhere they are
 * rendered (sidebar badge, Settings, Company Admin, Super Admin pickers). The
 * stored tier values are unchanged.
 */
const bundle: { en: Record<string, any>; fr: Record<string, any>; ar: Record<string, any> } = {
  en: {
    plan: { starter: "Growth", professional: "Growth", enterprise: "Enterprise", elite: "Elite" },
    layout_ui: { plans: { starter: "Growth", professional: "Growth", enterprise: "Enterprise", elite: "Elite" } },
    superadmin: {
      tier_starter: "Starter (legacy, = Growth)",
      tier_professional: "Growth",
      tier_enterprise: "Enterprise",
      tier_elite: "Elite",
      lic_plan_enterprise: "Enterprise — unlimited users, frameworks & third parties + AI assistant",
      lic_plan_elite: "Elite — Enterprise + the full Elite Pack",
      lic_plan_hint: "Enterprise is the default for self-hosted clients. Only Elite unlocks the Elite Pack (AD/LDAP SSO, MFA, CVE base, RACI, archiving…).",
    },
    trial_banner: {
      banner_admin: "Your trial runs on the Growth plan. Contact us to choose Growth, Enterprise or Elite before it ends.",
    },
    plan_limits: {
      title: "Plan limit reached",
      max_contributors: "Your {{plan}} plan allows {{max}} contributors and {{current}} are already in use. Viewers, executives and auditors are free. Contact us to upgrade.",
      max_frameworks: "Your {{plan}} plan allows {{max}} active frameworks and {{current}} are already in use. Existing assessments keep working. Contact us to upgrade.",
      max_vendors: "Your {{plan}} plan allows {{max}} third parties and {{current}} are already registered. Contact us to upgrade.",
      enterprise_title: "Enterprise feature",
      copilot_locked: "The AI GRC assistant is included in the Enterprise and Elite plans. Contact us to upgrade.",
      banner_near: "You are close to the limits of your {{plan}} plan: {{items}}.",
      banner_over: "Your organization is above the limits of its {{plan}} plan: {{items}}. Everything existing keeps working; new additions are blocked.",
      item_contributors: "contributors {{used}}/{{max}}",
      item_frameworks: "active frameworks {{used}}/{{max}}",
      item_vendors: "third parties {{used}}/{{max}}",
      contact: "Contact us to upgrade",
      dismiss: "Dismiss",
    },
  },
  fr: {
    plan: { starter: "Croissance", professional: "Croissance", enterprise: "Entreprise", elite: "Élite" },
    layout_ui: { plans: { starter: "Croissance", professional: "Croissance", enterprise: "Entreprise", elite: "Élite" } },
    superadmin: {
      tier_starter: "Starter (ancienne offre, = Croissance)",
      tier_professional: "Croissance",
      tier_enterprise: "Entreprise",
      tier_elite: "Élite",
      lic_plan_enterprise: "Entreprise — utilisateurs, référentiels et tiers illimités + assistant IA",
      lic_plan_elite: "Élite — Entreprise + l'intégralité du Pack Élite",
      lic_plan_hint: "Entreprise est la valeur par défaut pour les clients auto-hébergés. Seule l'offre Élite débloque le Pack Élite (SSO AD/LDAP, MFA, base CVE, RACI, archivage…).",
    },
    trial_banner: {
      banner_admin: "Votre essai correspond à l'offre Croissance. Contactez-nous pour choisir Croissance, Entreprise ou Élite avant sa fin.",
    },
    plan_limits: {
      title: "Limite de l'offre atteinte",
      max_contributors: "Votre offre {{plan}} permet {{max}} contributeurs et {{current}} sont déjà utilisés. Les lecteurs, dirigeants et auditeurs sont gratuits. Contactez-nous pour changer d'offre.",
      max_frameworks: "Votre offre {{plan}} permet {{max}} référentiels actifs et {{current}} sont déjà utilisés. Les évaluations existantes continuent de fonctionner. Contactez-nous pour changer d'offre.",
      max_vendors: "Votre offre {{plan}} permet {{max}} tiers et {{current}} sont déjà enregistrés. Contactez-nous pour changer d'offre.",
      enterprise_title: "Fonctionnalité Entreprise",
      copilot_locked: "L'assistant IA GRC est inclus dans les offres Entreprise et Élite. Contactez-nous pour changer d'offre.",
      banner_near: "Vous approchez des limites de votre offre {{plan}} : {{items}}.",
      banner_over: "Votre organisation dépasse les limites de son offre {{plan}} : {{items}}. Tout l'existant continue de fonctionner ; les nouveaux ajouts sont bloqués.",
      item_contributors: "contributeurs {{used}}/{{max}}",
      item_frameworks: "référentiels actifs {{used}}/{{max}}",
      item_vendors: "tiers {{used}}/{{max}}",
      contact: "Contactez-nous pour changer d'offre",
      dismiss: "Masquer",
    },
  },
  ar: {
    plan: { starter: "النمو", professional: "النمو", enterprise: "المؤسسات", elite: "النخبة" },
    layout_ui: { plans: { starter: "النمو", professional: "النمو", enterprise: "المؤسسات", elite: "النخبة" } },
    superadmin: {
      tier_starter: "Starter (قديمة، = النمو)",
      tier_professional: "النمو",
      tier_enterprise: "المؤسسات",
      tier_elite: "النخبة",
      lic_plan_enterprise: "المؤسسات — مستخدمون وأطر وأطراف ثالثة بلا حدود + مساعد الذكاء الاصطناعي",
      lic_plan_elite: "النخبة — المؤسسات + حزمة النخبة كاملة",
      lic_plan_hint: "خطة المؤسسات هي الخيار الافتراضي للعملاء ذوي الاستضافة الذاتية. وحدها خطة النخبة تفتح حزمة النخبة (SSO عبر AD/LDAP، MFA، قاعدة CVE، RACI، الأرشفة…).",
    },
    trial_banner: {
      banner_admin: "فترتك التجريبية على خطة النمو. تواصل معنا لاختيار النمو أو المؤسسات أو النخبة قبل انتهائها.",
    },
    plan_limits: {
      title: "تم بلوغ حد الخطة",
      max_contributors: "تسمح خطة {{plan}} بـ {{max}} من المساهمين، وقد تم استخدام {{current}} بالفعل. المشاهدون والمديرون التنفيذيون والمدققون مجانيون. تواصل معنا للترقية.",
      max_frameworks: "تسمح خطة {{plan}} بـ {{max}} من الأطر النشطة، وقد تم استخدام {{current}} بالفعل. تستمر التقييمات الحالية في العمل. تواصل معنا للترقية.",
      max_vendors: "تسمح خطة {{plan}} بـ {{max}} من الأطراف الثالثة، وقد تم تسجيل {{current}} بالفعل. تواصل معنا للترقية.",
      enterprise_title: "ميزة خطة المؤسسات",
      copilot_locked: "مساعد الذكاء الاصطناعي للحوكمة والمخاطر والامتثال مضمّن في خطتي المؤسسات والنخبة. تواصل معنا للترقية.",
      banner_near: "أنت قريب من حدود خطة {{plan}}: {{items}}.",
      banner_over: "تجاوزت مؤسستك حدود خطة {{plan}}: {{items}}. يستمر كل ما هو موجود في العمل، بينما تُمنع الإضافات الجديدة.",
      item_contributors: "المساهمون {{used}}/{{max}}",
      item_frameworks: "الأطر النشطة {{used}}/{{max}}",
      item_vendors: "الأطراف الثالثة {{used}}/{{max}}",
      contact: "تواصل معنا للترقية",
      dismiss: "إخفاء",
    },
  },
};

export default bundle;
