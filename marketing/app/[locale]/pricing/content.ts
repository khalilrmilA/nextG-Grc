// All copy for the pricing page, in one place per language.
// Source of truth: MARKETING_SPEC.md §2 "Packages" (2026-10-19). Prices are on
// request for every offer; do not add figures, customers or certifications here.
// In the app, the "Growth" offer corresponds to the plan "Professional".

export type PlanId = "growth" | "enterprise" | "elite";
export type TextCell = "upTo10" | "upTo25" | "upTo100" | "unlimited";
/** true = included, false = not included, string = short text cell */
export type Cell = boolean | TextCell;

export type CategoryId =
  | "risk" | "compliance" | "audit" | "thirdParties" | "secops"
  | "reporting" | "ai" | "admin" | "support";

export type RowId =
  | "riskRegister" | "riskScenarios" | "riskAcceptances" | "threatProfiles" | "riskAppetite"
  | "frameworks" | "saudi" | "gapAnalysis" | "crossMapping" | "customFrameworks" | "controlEffectiveness"
  | "audits" | "policies" | "docGenerator" | "ocr"
  | "thirdPartyCount" | "prescreen" | "vendorPortal" | "assets"
  | "incidents" | "threatLibrary" | "scanners" | "cve"
  | "pdfReports" | "reportBuilder" | "raci" | "regulatory"
  | "aiGeneration" | "aiAssistant"
  | "contributors" | "freeRoles" | "mfa" | "ldap" | "tamperLog" | "languages"
  | "emailSupport" | "onboarding" | "prioritySupport";

/** Comparison table structure (language-independent). Cells are [Growth, Enterprise, Elite]. */
export const TABLE: { id: CategoryId; rows: { id: RowId; cells: [Cell, Cell, Cell] }[] }[] = [
  { id: "risk", rows: [
    { id: "riskRegister",    cells: [true, true, true] },
    { id: "riskScenarios",   cells: [true, true, true] },
    { id: "riskAcceptances", cells: [true, true, true] },
    { id: "threatProfiles",  cells: [false, false, true] },
    { id: "riskAppetite",    cells: [false, false, true] },
  ] },
  { id: "compliance", rows: [
    { id: "frameworks",           cells: ["upTo10", "unlimited", "unlimited"] },
    { id: "saudi",                cells: [true, true, true] },
    { id: "gapAnalysis",          cells: [true, true, true] },
    { id: "crossMapping",         cells: [true, true, true] },
    { id: "customFrameworks",     cells: [true, true, true] },
    { id: "controlEffectiveness", cells: [false, false, true] },
  ] },
  { id: "audit", rows: [
    { id: "audits",       cells: [true, true, true] },
    { id: "policies",     cells: [true, true, true] },
    { id: "docGenerator", cells: [true, true, true] },
    { id: "ocr",          cells: [false, false, true] },
  ] },
  { id: "thirdParties", rows: [
    { id: "thirdPartyCount", cells: ["upTo100", "unlimited", "unlimited"] },
    { id: "prescreen",       cells: [true, true, true] },
    { id: "vendorPortal",    cells: [true, true, true] },
    { id: "assets",          cells: [false, false, true] },
  ] },
  { id: "secops", rows: [
    { id: "incidents",     cells: [true, true, true] },
    { id: "threatLibrary", cells: [true, true, true] },
    { id: "scanners",      cells: [false, false, true] },
    { id: "cve",           cells: [false, false, true] },
  ] },
  { id: "reporting", rows: [
    { id: "pdfReports",    cells: [true, true, true] },
    { id: "reportBuilder", cells: [false, false, true] },
    { id: "raci",          cells: [false, false, true] },
    { id: "regulatory",    cells: [true, true, true] },
  ] },
  { id: "ai", rows: [
    { id: "aiGeneration", cells: [true, true, true] },
    { id: "aiAssistant",  cells: [false, true, true] },
  ] },
  { id: "admin", rows: [
    { id: "contributors", cells: ["upTo25", "unlimited", "unlimited"] },
    { id: "freeRoles", cells: [true, true, true] },
    { id: "mfa",       cells: [true, true, true] },
    { id: "ldap",      cells: [false, false, true] },
    { id: "tamperLog", cells: [false, false, true] },
    { id: "languages", cells: [true, true, true] },
  ] },
  { id: "support", rows: [
    { id: "emailSupport",    cells: [true, true, true] },
    { id: "onboarding",      cells: [false, true, true] },
    { id: "prioritySupport", cells: [false, true, true] },
  ] },
];

export const PLAN_ORDER: PlanId[] = ["growth", "enterprise", "elite"];

export interface PricingCopy {
  hero: { badge: string; title: string; intro: string };
  priceLabel: string;
  popular: string;
  plans: Record<PlanId, { name: string; tagline: string; bullets: string[]; cta: string }>;
  table: {
    title: string;
    subtitle: string;
    featureCol: string;
    included: string;
    notIncluded: string;
    scrollHint: string;
    categories: Record<CategoryId, string>;
    rows: Record<RowId, string>;
    text: Record<TextCell, string>;
  };
  footnote: string;
  options: { title: string; subtitle: string; items: { title: string; body: string }[] };
  demo: { title: string; body: string; bullets: string[]; primary: string; secondary: string };
  faq: { title: string; items: { q: string; a: string; trial?: boolean }[]; trialLink: string };
}

const en: PricingCopy = {
  hero: {
    badge: "Pricing",
    title: "Simple, transparent pricing",
    intro:
      "Every offer runs the same platform. What changes is depth: how many capabilities you use and the size of your organisation. Prices are agreed with our team; volume discounts and annual or multi-year contracts are available.",
  },
  priceLabel: "Price on request · based on your contributors and scope",
  popular: "Most popular",
  plans: {
    growth: {
      name: "Growth",
      tagline: "For compliance teams getting structured",
      bullets: [
        "Up to 10 active frameworks from the 85+ library, incl. the 8 Saudi frameworks",
        "Up to 25 contributors · up to 100 third parties",
        "Risk register, scenarios & heatmap, risk acceptances",
        "Compliance assessments, AI gap analysis, cross-framework mapping, action plan",
        "Custom frameworks: fork, edit, build or generate with AI",
        "Audits, findings and the external auditor portal",
        "Policies with approval workflow and employee acknowledgement",
        "AI document generator — 27 document types",
        "Third-party risk: AI prescreen, AI contract review, vendor portal with e-signature",
        "Incidents, vulnerabilities, threat library, applied controls, exceptions",
        "Regulatory updates",
        "5 built-in PDF reports",
        "MFA, 13 roles, activity log",
        "English, French and Arabic (RTL)",
        "Email support",
      ],
      cta: "Get started",
    },
    enterprise: {
      name: "Enterprise",
      tagline: "For organisations running GRC at scale",
      bullets: [
        "Everything in Growth",
        "Unlimited frameworks, contributors and third parties",
        "AI GRC assistant (chat on your own risk, compliance and vendor data)",
        "Multiple frameworks assessed together with shared evidence",
        "Dedicated onboarding",
        "Priority support",
      ],
      cta: "Get started",
    },
    elite: {
      name: "Elite",
      tagline: "For regulated and critical-infrastructure organisations",
      bullets: [
        "Everything in Enterprise",
        "Active Directory / LDAP sign-in with group → role mapping",
        "Asset valuation (CIA), asset cartography & lifecycle with end-of-life alerts",
        "Vulnerability scanner connectors (Tenable, Nessus, Qualys, OpenVAS) & impact scoring",
        "CVE knowledge base with daily NVD sync",
        "Threat profiles, scenario versioning, risk appetite & treatment plans",
        "Control effectiveness evaluation (5 criteria)",
        "Report builder (Excel / PDF), scheduled reports, 9 dashboards",
        "RACI governance, document repository, archiving & retention",
        "OCR document capture (FR / EN / AR)",
        "Tamper-evident, hash-chained activity log",
      ],
      cta: "Contact sales",
    },
  },
  table: {
    title: "Compare the offers",
    subtitle: "Every capability, offer by offer.",
    featureCol: "Capability",
    included: "Included",
    notIncluded: "Not included",
    scrollHint: "Scroll sideways to see every offer",
    categories: {
      risk: "Risk",
      compliance: "Compliance",
      audit: "Audit & policies",
      thirdParties: "Third parties & assets",
      secops: "Security operations",
      reporting: "Reporting & governance",
      ai: "AI",
      admin: "Security & administration",
      support: "Support",
    },
    rows: {
      riskRegister: "Risk register & heatmap",
      riskScenarios: "Risk scenarios",
      riskAcceptances: "Risk acceptances",
      threatProfiles: "Threat profiles & scenario versioning",
      riskAppetite: "Risk appetite & treatment plans",
      frameworks: "Frameworks from the 85+ library",
      saudi: "8 Saudi frameworks in official English + Arabic",
      gapAnalysis: "AI gap analysis",
      crossMapping: "Cross-framework mapping",
      customFrameworks: "Custom frameworks & AI builder",
      controlEffectiveness: "Control effectiveness evaluation",
      audits: "Audits & external auditor portal",
      policies: "Policies, approval & acknowledgement",
      docGenerator: "AI document generator (27 types)",
      ocr: "OCR document capture",
      thirdPartyCount: "Third parties",
      prescreen: "AI prescreen & contract review",
      vendorPortal: "Vendor portal with e-signature",
      assets: "Asset valuation, cartography & lifecycle",
      incidents: "Incidents & vulnerabilities",
      threatLibrary: "Threat library",
      scanners: "Scanner connectors & impact scoring",
      cve: "CVE knowledge base",
      pdfReports: "5 built-in PDF reports",
      reportBuilder: "Report builder, scheduling & 9 dashboards",
      raci: "RACI, document repository & archiving",
      regulatory: "Regulatory updates",
      aiGeneration: "AI document generation & analysis",
      aiAssistant: "AI GRC assistant",
      contributors: "Contributors",
      freeRoles: "Viewers, executives, auditors & employees — free and unlimited",
      mfa: "MFA & 13 roles",
      ldap: "Active Directory / LDAP sign-in",
      tamperLog: "Tamper-evident activity log",
      languages: "English, French & Arabic (RTL)",
      emailSupport: "Email support",
      onboarding: "Dedicated onboarding",
      prioritySupport: "Priority support",
    },
    text: { upTo10: "Up to 10", upTo25: "Up to 25", upTo100: "Up to 100", unlimited: "Unlimited" },
  },
  footnote:
    "Each offer includes everything in the previous one. GRC Eye helps you meet regulatory requirements; it does not by itself make you compliant. Options are priced by scope and available with any offer.",
  options: {
    title: "Options",
    subtitle: "Add-ons available with any offer, priced by scope.",
    items: [
      {
        title: "Private edition",
        body: "A yearly licence per installation, available with every offer including Elite. On-premises or air-gapped: Docker, VMware OVA appliance or offline installer, offline licence keys. With a local AI model: zero data egress.",
      },
      {
        title: "Bring your own AI model",
        body: "Connect your own Ollama or OpenAI-compatible endpoint so AI runs where you decide.",
      },
      {
        title: "Onboarding, training & regulation loading",
        body: "Guided setup, team training, and loading of your national or internal frameworks.",
      },
    ],
  },
  demo: {
    title: "Not sure which offer fits?",
    body: "Tell us how many people you have, which frameworks you must meet and where your data must stay. We demo the platform on sample data and recommend an offer.",
    bullets: [
      "A 30-minute demo",
      "An offer sized to your contributors and scope",
      "A free framework-coverage review, whatever you decide",
    ],
    primary: "Contact sales",
    secondary: "Explore frameworks",
  },
  faq: {
    title: "Pricing questions",
    trialLink: "Start your 14-day trial",
    items: [
      {
        q: "How is the price set?",
        a: "By the number of contributors, the offer you choose, any options (private edition, your own AI model) and the contract length. Annual and multi-year contracts are available.",
      },
      {
        q: "Who counts as a user?",
        a: "Only contributors: the people who edit in GRC Eye, such as administrators, the CISO, risk, compliance, policy and vendor managers, control and business owners, and security analysts. Read-only viewers and executives, auditors (including the external auditor portal), employees who only read and acknowledge policies, and third parties using the vendor portal are free and unlimited on every offer; third parties need no account.",
      },
      {
        q: "Can I change offer later?",
        a: "Yes. You can upgrade at any time; your data and configuration stay in place.",
      },
      {
        q: "Is there a trial?",
        a: "Yes, a 14-day trial.",
        trial: true,
      },
      {
        q: "Can GRC Eye run on our own infrastructure?",
        a: "Yes, with the Private edition option: a yearly licence per installation, on-premises or air-gapped, available with every offer.",
      },
      {
        q: "Which languages are supported?",
        a: "English, French and Arabic, including the Saudi frameworks in their official Arabic wording.",
      },
    ],
  },
};

const fr: PricingCopy = {
  hero: {
    badge: "Tarifs",
    title: "Des tarifs simples et transparents",
    intro:
      "Toutes les offres reposent sur la même plateforme. Ce qui change, c'est la profondeur : le nombre de fonctionnalités que vous utilisez et la taille de votre organisation. Les tarifs sont définis avec notre équipe ; des remises sur volume et des contrats annuels ou pluriannuels sont disponibles.",
  },
  priceLabel: "Tarif sur demande · selon vos contributeurs et votre périmètre",
  popular: "La plus choisie",
  plans: {
    growth: {
      name: "Croissance",
      tagline: "Pour les équipes conformité qui se structurent",
      bullets: [
        "Jusqu'à 10 référentiels actifs parmi plus de 85, dont les 8 référentiels saoudiens",
        "Jusqu'à 25 contributeurs · jusqu'à 100 tiers",
        "Registre des risques, scénarios et carte de chaleur, acceptations de risques",
        "Évaluations de conformité, analyse d'écarts par IA, correspondances entre référentiels, plan d'action",
        "Référentiels personnalisés : dupliquer, modifier, créer ou générer par IA",
        "Audits, constats et portail auditeur externe",
        "Politiques avec circuit d'approbation et prise de connaissance par les collaborateurs",
        "Générateur de documents par IA — 27 types de documents",
        "Risque tiers : présélection par IA, revue de contrats par IA, portail fournisseur avec signature électronique",
        "Incidents, vulnérabilités, bibliothèque de menaces, mesures appliquées, exceptions",
        "Veille réglementaire",
        "5 rapports PDF intégrés",
        "MFA, 13 rôles, journal d'activité",
        "Anglais, français et arabe (RTL)",
        "Support par e-mail",
      ],
      cta: "Démarrer",
    },
    enterprise: {
      name: "Entreprise",
      tagline: "Pour les organisations qui pilotent la GRC à grande échelle",
      bullets: [
        "Tout ce qui est inclus dans Croissance",
        "Référentiels, contributeurs et tiers illimités",
        "Assistant GRC par IA (dialogue sur vos propres données de risques, de conformité et de fournisseurs)",
        "Plusieurs référentiels évalués ensemble avec des preuves partagées",
        "Accompagnement au démarrage dédié",
        "Support prioritaire",
      ],
      cta: "Démarrer",
    },
    elite: {
      name: "Élite",
      tagline: "Pour les organisations régulées et les infrastructures critiques",
      bullets: [
        "Tout ce qui est inclus dans Entreprise",
        "Connexion Active Directory / LDAP avec correspondance groupe → rôle",
        "Valorisation des actifs (DIC), cartographie des actifs et cycle de vie avec alertes de fin de vie",
        "Connecteurs de scanners de vulnérabilités (Tenable, Nessus, Qualys, OpenVAS) et évaluation de l'impact",
        "Base de connaissances CVE avec synchronisation NVD quotidienne",
        "Profils de menaces, versionnage des scénarios, appétence au risque et plans de traitement",
        "Évaluation de l'efficacité des mesures (5 critères)",
        "Générateur de rapports (Excel / PDF), rapports planifiés, 9 tableaux de bord",
        "Gouvernance RACI, référentiel documentaire, archivage et conservation",
        "Capture de documents par OCR (FR / EN / AR)",
        "Journal d'activité infalsifiable, chaîné par hachage",
      ],
      cta: "Contacter l'équipe commerciale",
    },
  },
  table: {
    title: "Comparer les offres",
    subtitle: "Chaque fonctionnalité, offre par offre.",
    featureCol: "Fonctionnalité",
    included: "Inclus",
    notIncluded: "Non inclus",
    scrollHint: "Faites défiler horizontalement pour voir toutes les offres",
    categories: {
      risk: "Risques",
      compliance: "Conformité",
      audit: "Audit et politiques",
      thirdParties: "Tiers et actifs",
      secops: "Opérations de sécurité",
      reporting: "Rapports et gouvernance",
      ai: "IA",
      admin: "Sécurité et administration",
      support: "Support",
    },
    rows: {
      riskRegister: "Registre des risques et carte de chaleur",
      riskScenarios: "Scénarios de risque",
      riskAcceptances: "Acceptations de risques",
      threatProfiles: "Profils de menaces et versionnage des scénarios",
      riskAppetite: "Appétence au risque et plans de traitement",
      frameworks: "Référentiels parmi plus de 85",
      saudi: "8 référentiels saoudiens en version officielle anglaise + arabe",
      gapAnalysis: "Analyse d'écarts par IA",
      crossMapping: "Correspondances entre référentiels",
      customFrameworks: "Référentiels personnalisés et générateur IA",
      controlEffectiveness: "Évaluation de l'efficacité des mesures",
      audits: "Audits et portail auditeur externe",
      policies: "Politiques, approbation et prise de connaissance",
      docGenerator: "Générateur de documents par IA (27 types)",
      ocr: "Capture de documents par OCR",
      thirdPartyCount: "Tiers",
      prescreen: "Présélection et revue de contrats par IA",
      vendorPortal: "Portail fournisseur avec signature électronique",
      assets: "Valorisation, cartographie et cycle de vie des actifs",
      incidents: "Incidents et vulnérabilités",
      threatLibrary: "Bibliothèque de menaces",
      scanners: "Connecteurs de scanners et évaluation de l'impact",
      cve: "Base de connaissances CVE",
      pdfReports: "5 rapports PDF intégrés",
      reportBuilder: "Générateur de rapports, planification et 9 tableaux de bord",
      raci: "RACI, référentiel documentaire et archivage",
      regulatory: "Veille réglementaire",
      aiGeneration: "Génération et analyse de documents par IA",
      aiAssistant: "Assistant GRC par IA",
      contributors: "Contributeurs",
      freeRoles: "Lecteurs, dirigeants, auditeurs et collaborateurs — gratuits et illimités",
      mfa: "MFA et 13 rôles",
      ldap: "Connexion Active Directory / LDAP",
      tamperLog: "Journal d'activité infalsifiable",
      languages: "Anglais, français et arabe (RTL)",
      emailSupport: "Support par e-mail",
      onboarding: "Accompagnement au démarrage dédié",
      prioritySupport: "Support prioritaire",
    },
    text: { upTo10: "Jusqu'à 10", upTo25: "Jusqu'à 25", upTo100: "Jusqu'à 100", unlimited: "Illimité" },
  },
  footnote:
    "Chaque offre inclut tout ce que contient la précédente. GRC Eye vous aide à répondre aux exigences réglementaires ; il ne vous rend pas conforme à lui seul. Les options sont tarifées selon le périmètre et disponibles avec toutes les offres.",
  options: {
    title: "Options",
    subtitle: "Compléments disponibles avec toutes les offres, tarifés selon le périmètre.",
    items: [
      {
        title: "Édition privée",
        body: "Licence annuelle par installation, disponible avec toutes les offres, y compris Élite. Sur site ou en environnement isolé : Docker, appliance VMware OVA ou installeur hors ligne, clés de licence hors ligne. Avec un modèle d'IA local : aucune donnée ne sort.",
      },
      {
        title: "Votre propre modèle d'IA",
        body: "Connectez votre propre point d'accès Ollama ou compatible OpenAI pour que l'IA s'exécute là où vous le décidez.",
      },
      {
        title: "Accompagnement, formation et chargement réglementaire",
        body: "Mise en place guidée, formation de vos équipes et chargement de vos référentiels nationaux ou internes.",
      },
    ],
  },
  demo: {
    title: "Vous hésitez entre les offres ?",
    body: "Indiquez-nous la taille de vos équipes, les référentiels auxquels vous devez répondre et l'endroit où vos données doivent rester. Nous vous présentons la plateforme sur des données d'exemple et vous recommandons une offre.",
    bullets: [
      "Une démonstration de 30 minutes",
      "Une offre dimensionnée selon vos contributeurs et votre périmètre",
      "Une analyse gratuite de la couverture de vos référentiels, quelle que soit votre décision",
    ],
    primary: "Contacter l'équipe commerciale",
    secondary: "Découvrir les référentiels",
  },
  faq: {
    title: "Questions sur les tarifs",
    trialLink: "Démarrer votre essai de 14 jours",
    items: [
      {
        q: "Comment le tarif est-il établi ?",
        a: "Selon le nombre de contributeurs, l'offre choisie, les options (édition privée, votre propre modèle d'IA) et la durée du contrat. Des contrats annuels et pluriannuels sont disponibles.",
      },
      {
        q: "Qui est compté comme utilisateur ?",
        a: "Uniquement les contributeurs : les personnes qui saisissent et modifient dans GRC Eye, comme les administrateurs, le RSSI, les responsables risques, conformité, politiques et fournisseurs, les propriétaires de mesures et de processus métier, et les analystes sécurité. Les lecteurs et dirigeants en consultation seule, les auditeurs (y compris via le portail auditeur externe), les collaborateurs qui lisent et prennent connaissance des politiques, et les tiers qui utilisent le portail fournisseur sont gratuits et illimités dans toutes les offres ; les tiers n'ont besoin d'aucun compte.",
      },
      {
        q: "Puis-je changer d'offre plus tard ?",
        a: "Oui. Vous pouvez passer à une offre supérieure à tout moment ; vos données et votre configuration sont conservées.",
      },
      {
        q: "Existe-t-il une période d'essai ?",
        a: "Oui, un essai de 14 jours.",
        trial: true,
      },
      {
        q: "GRC Eye peut-il fonctionner sur notre propre infrastructure ?",
        a: "Oui, avec l'option Édition privée : une licence annuelle par installation, sur site ou en environnement isolé, disponible avec toutes les offres.",
      },
      {
        q: "Quelles langues sont disponibles ?",
        a: "L'anglais, le français et l'arabe, y compris les référentiels saoudiens dans leur version arabe officielle.",
      },
    ],
  },
};

const ar: PricingCopy = {
  hero: {
    badge: "الأسعار",
    title: "أسعار بسيطة وشفافة",
    intro:
      "تعمل جميع العروض على المنصة نفسها. ما يتغيّر هو العمق: عدد القدرات التي تستخدمها وحجم مؤسستك. تُحدَّد الأسعار بالاتفاق مع فريقنا، وتتوفر خصومات على الكميات وعقود سنوية أو متعددة السنوات.",
  },
  priceLabel: "السعر عند الطلب · حسب عدد المساهمين والنطاق",
  popular: "الأكثر اختيارًا",
  plans: {
    growth: {
      name: "النمو",
      tagline: "لفرق الامتثال التي تبدأ في تنظيم عملها",
      bullets: [
        "حتى 10 أطر نشطة من مكتبة تضم أكثر من 85 إطارًا، بما فيها الأطر السعودية الثمانية",
        "حتى 25 مساهمًا · حتى 100 طرف ثالث",
        "سجل المخاطر والسيناريوهات والخريطة الحرارية وقبول المخاطر",
        "تقييمات الامتثال وتحليل الفجوات بالذكاء الاصطناعي والربط بين الأطر وخطة العمل",
        "أطر مخصّصة: انسخ أي إطار أو عدّله أو أنشئه أو ولّده بالذكاء الاصطناعي",
        "عمليات التدقيق والملاحظات وبوابة المدقق الخارجي",
        "سياسات مع مسار اعتماد وإقرار الموظفين بالاطلاع",
        "مولّد مستندات بالذكاء الاصطناعي — 27 نوعًا من المستندات",
        "مخاطر الأطراف الثالثة: فرز أولي بالذكاء الاصطناعي، ومراجعة العقود بالذكاء الاصطناعي، وبوابة الموردين مع التوقيع الإلكتروني",
        "الحوادث والثغرات ومكتبة التهديدات والضوابط المطبّقة والاستثناءات",
        "المستجدات التنظيمية",
        "5 تقارير PDF مدمجة",
        "المصادقة متعددة العوامل و13 دورًا وسجل النشاط",
        "الإنجليزية والفرنسية والعربية (من اليمين إلى اليسار)",
        "الدعم عبر البريد الإلكتروني",
      ],
      cta: "ابدأ الآن",
    },
    enterprise: {
      name: "المؤسسات",
      tagline: "للمؤسسات التي تدير الحوكمة والمخاطر والامتثال على نطاق واسع",
      bullets: [
        "كل ما يتضمنه عرض النمو",
        "أطر ومساهمون وأطراف ثالثة بلا حدود",
        "مساعد GRC بالذكاء الاصطناعي (محادثة حول بيانات المخاطر والامتثال والموردين الخاصة بك)",
        "تقييم عدة أطر معًا بأدلة مشتركة",
        "تهيئة مخصّصة عند الانطلاق",
        "دعم ذو أولوية",
      ],
      cta: "ابدأ الآن",
    },
    elite: {
      name: "النخبة",
      tagline: "للمؤسسات الخاضعة للتنظيم ومؤسسات البنية التحتية الحيوية",
      bullets: [
        "كل ما يتضمنه عرض المؤسسات",
        "تسجيل الدخول عبر Active Directory / LDAP مع ربط المجموعات بالأدوار",
        "تقييم الأصول (السرية والسلامة والتوافر) وخريطة الأصول ودورة حياتها مع تنبيهات نهاية العمر",
        "موصلات ماسحات الثغرات (Tenable وNessus وQualys وOpenVAS) وتقدير الأثر",
        "قاعدة معرفة CVE مع مزامنة يومية من NVD",
        "ملفات التهديدات وإدارة إصدارات السيناريوهات وشهية المخاطر وخطط المعالجة",
        "تقييم فعالية الضوابط (5 معايير)",
        "منشئ التقارير (Excel / PDF) والتقارير المجدولة و9 لوحات معلومات",
        "حوكمة RACI ومستودع المستندات والأرشفة والاحتفاظ",
        "التقاط المستندات بتقنية OCR (الفرنسية / الإنجليزية / العربية)",
        "سجل نشاط مقاوم للتلاعب ومتسلسل بالتجزئة",
      ],
      cta: "تواصل مع المبيعات",
    },
  },
  table: {
    title: "قارن بين العروض",
    subtitle: "كل قدرة، عرضًا بعرض.",
    featureCol: "القدرة",
    included: "مُضمَّن",
    notIncluded: "غير مُضمَّن",
    scrollHint: "مرّر أفقيًا لعرض جميع العروض",
    categories: {
      risk: "المخاطر",
      compliance: "الامتثال",
      audit: "التدقيق والسياسات",
      thirdParties: "الأطراف الثالثة والأصول",
      secops: "العمليات الأمنية",
      reporting: "التقارير والحوكمة",
      ai: "الذكاء الاصطناعي",
      admin: "الأمن والإدارة",
      support: "الدعم",
    },
    rows: {
      riskRegister: "سجل المخاطر والخريطة الحرارية",
      riskScenarios: "سيناريوهات المخاطر",
      riskAcceptances: "قبول المخاطر",
      threatProfiles: "ملفات التهديدات وإدارة إصدارات السيناريوهات",
      riskAppetite: "شهية المخاطر وخطط المعالجة",
      frameworks: "أطر من مكتبة تضم أكثر من 85 إطارًا",
      saudi: "8 أطر سعودية بنصّها الرسمي بالإنجليزية والعربية",
      gapAnalysis: "تحليل الفجوات بالذكاء الاصطناعي",
      crossMapping: "الربط بين الأطر",
      customFrameworks: "الأطر المخصّصة ومنشئ الأطر بالذكاء الاصطناعي",
      controlEffectiveness: "تقييم فعالية الضوابط",
      audits: "عمليات التدقيق وبوابة المدقق الخارجي",
      policies: "السياسات والاعتماد والإقرار بالاطلاع",
      docGenerator: "مولّد المستندات بالذكاء الاصطناعي (27 نوعًا)",
      ocr: "التقاط المستندات بتقنية OCR",
      thirdPartyCount: "الأطراف الثالثة",
      prescreen: "الفرز الأولي ومراجعة العقود بالذكاء الاصطناعي",
      vendorPortal: "بوابة الموردين مع التوقيع الإلكتروني",
      assets: "تقييم الأصول وخريطتها ودورة حياتها",
      incidents: "الحوادث والثغرات",
      threatLibrary: "مكتبة التهديدات",
      scanners: "موصلات الماسحات وتقدير الأثر",
      cve: "قاعدة معرفة CVE",
      pdfReports: "5 تقارير PDF مدمجة",
      reportBuilder: "منشئ التقارير والجدولة و9 لوحات معلومات",
      raci: "RACI ومستودع المستندات والأرشفة",
      regulatory: "المستجدات التنظيمية",
      aiGeneration: "توليد المستندات وتحليلها بالذكاء الاصطناعي",
      aiAssistant: "مساعد GRC بالذكاء الاصطناعي",
      contributors: "المساهمون",
      freeRoles: "المطّلعون والتنفيذيون والمدققون والموظفون — مجانًا وبلا حدود",
      mfa: "المصادقة متعددة العوامل و13 دورًا",
      ldap: "تسجيل الدخول عبر Active Directory / LDAP",
      tamperLog: "سجل نشاط مقاوم للتلاعب",
      languages: "الإنجليزية والفرنسية والعربية (من اليمين إلى اليسار)",
      emailSupport: "الدعم عبر البريد الإلكتروني",
      onboarding: "تهيئة مخصّصة عند الانطلاق",
      prioritySupport: "دعم ذو أولوية",
    },
    text: { upTo10: "حتى 10", upTo25: "حتى 25", upTo100: "حتى 100", unlimited: "بلا حدود" },
  },
  footnote:
    "يتضمن كل عرض كل ما في العرض الذي يسبقه. تساعدك GRC Eye على استيفاء المتطلبات التنظيمية، لكنها لا تجعلك ممتثلًا بمفردها. تُسعَّر الخيارات حسب النطاق وهي متاحة مع أي عرض.",
  options: {
    title: "الخيارات",
    subtitle: "إضافات متاحة مع أي عرض، تُسعَّر حسب النطاق.",
    items: [
      {
        title: "الإصدار الخاص",
        body: "ترخيص سنوي لكل تثبيت، متاح مع جميع العروض بما فيها النخبة. داخل بنيتك أو في بيئة معزولة تمامًا: Docker أو جهاز VMware OVA الافتراضي أو مثبّت دون اتصال، مع مفاتيح ترخيص دون اتصال. ومع نموذج ذكاء اصطناعي محلي: دون خروج أي بيانات.",
      },
      {
        title: "استخدم نموذج الذكاء الاصطناعي الخاص بك",
        body: "اربط نقطة Ollama الخاصة بك أو أي نقطة متوافقة مع OpenAI ليعمل الذكاء الاصطناعي حيث تقرّر.",
      },
      {
        title: "التهيئة والتدريب وتحميل الأنظمة التنظيمية",
        body: "إعداد موجَّه، وتدريب فريقك، وتحميل أطرك الوطنية أو الداخلية.",
      },
    ],
  },
  demo: {
    title: "لست متأكدًا من العرض المناسب؟",
    body: "أخبرنا بعدد العاملين لديك، والأطر التي يجب أن تستوفيها، والمكان الذي يجب أن تبقى فيه بياناتك. سنعرض لك المنصة على بيانات تجريبية ونوصي بالعرض المناسب.",
    bullets: [
      "عرض توضيحي مدته 30 دقيقة",
      "عرض مصمَّم حسب عدد المساهمين لديك ونطاقك",
      "مراجعة مجانية لتغطية الأطر، أيًّا كان قرارك",
    ],
    primary: "تواصل مع المبيعات",
    secondary: "استكشف الأطر",
  },
  faq: {
    title: "أسئلة حول الأسعار",
    trialLink: "ابدأ تجربتك لمدة 14 يومًا",
    items: [
      {
        q: "كيف يُحدَّد السعر؟",
        a: "حسب عدد المساهمين والعرض الذي تختاره والخيارات (الإصدار الخاص أو نموذج الذكاء الاصطناعي الخاص بك) ومدة العقد. تتوفر عقود سنوية ومتعددة السنوات.",
      },
      {
        q: "من يُحتسب مستخدمًا؟",
        a: "المساهمون فقط: الأشخاص الذين يُدخلون البيانات ويعدّلونها في GRC Eye، مثل المسؤولين عن المنصة، ومدير أمن المعلومات، ومديري المخاطر والامتثال والسياسات والموردين، ومالكي الضوابط والعمليات، ومحللي الأمن. أما المطّلعون والتنفيذيون الذين يكتفون بالاطلاع، والمدققون (بما في ذلك بوابة المدقق الخارجي)، والموظفون الذين يقرؤون السياسات ويقرّون بالاطلاع عليها فقط، والأطراف الثالثة التي تستخدم بوابة الموردين، فهم مجانًا وبلا حدود في جميع العروض، ولا تحتاج الأطراف الثالثة إلى أي حساب.",
      },
      {
        q: "هل يمكنني تغيير العرض لاحقًا؟",
        a: "نعم. يمكنك الترقية في أي وقت مع الاحتفاظ ببياناتك وإعداداتك.",
      },
      {
        q: "هل تتوفر فترة تجريبية؟",
        a: "نعم، تجربة لمدة 14 يومًا.",
        trial: true,
      },
      {
        q: "هل يمكن تشغيل GRC Eye على بنيتنا التحتية الخاصة؟",
        a: "نعم، من خلال خيار الإصدار الخاص: ترخيص سنوي لكل تثبيت، داخل بنيتك أو في بيئة معزولة، متاح مع جميع العروض.",
      },
      {
        q: "ما اللغات المتاحة؟",
        a: "الإنجليزية والفرنسية والعربية، بما في ذلك الأطر السعودية بنصّها العربي الرسمي.",
      },
    ],
  },
};

export const PRICING_CONTENT: Record<"en" | "fr" | "ar", PricingCopy> = { en, fr, ar };
