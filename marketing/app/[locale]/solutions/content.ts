/**
 * Solutions page copy, per locale.
 * Product facts must match the marketing spec (85+ frameworks, 13 roles, 27 document types,
 * no webhooks / Trust Center / Monte Carlo / SAML / SaaS "zero data egress" claims).
 * Framework badges only name frameworks that exist as built-ins in the platform.
 */
import type { Language } from "@/i18n";

export type IndustryKey = "saas" | "health" | "fintech" | "enterprise";
export type StakeholderKey = "ciso" | "compliance" | "sales" | "engineering" | "auditors";

interface Metric { value: string; label: string }

export interface IndustryCopy {
  label: string;
  headline: string;
  ceoValue: string;
  metrics: Metric[];
  points: string[];
  frameworks: string[];
}

export interface SolutionsContent {
  hero: { badge: string; titleLead: string; titleAccent: string; subtitle: string; ctaPrimary: string; ctaSecondary: string };
  roi: Metric[];
  business: { title: string; subtitle: string; items: { title: string; body: string }[] };
  industries: {
    title: string;
    subtitle: string;
    included: string;
    frameworksLabel: string;
    items: Record<IndustryKey, IndustryCopy>;
  };
  stakeholders: { title: string; subtitle: string; items: Record<StakeholderKey, { role: string; points: string[] }> };
  ai: { title: string; body: string; tags: string[]; cta: string };
  cta: { title: string; body: string; trial: string; demo: string };
}

// Framework badge labels (names as they appear in the platform library).
const FW = {
  soc2: "SOC 2 Type II",
  iso27001: "ISO 27001:2022",
  cis: "CIS Controls v8",
  hipaa: "HIPAA",
  hitrust: "HITRUST CSF",
  gdpr: "GDPR",
  nist80053: "NIST 800-53 Rev 5",
  nistCsf: "NIST CSF 2.0",
  dora: "DORA",
  pci: "PCI DSS 4.0",
  nis2: "NIS2",
  ncaEcc: "NCA ECC-2:2024",
  samaCsf: "SAMA CSF",
  pdpl: "SDAIA PDPL",
};

const FRAMEWORKS: Record<IndustryKey, string[]> = {
  saas: [FW.soc2, FW.iso27001, FW.cis],
  health: [FW.hipaa, FW.hitrust, FW.gdpr, FW.iso27001, FW.nist80053],
  fintech: [FW.dora, FW.pci, FW.nis2, FW.iso27001, FW.samaCsf, FW.ncaEcc],
  enterprise: [FW.iso27001, FW.nistCsf, FW.soc2, FW.gdpr, FW.nist80053, FW.ncaEcc, FW.pdpl],
};

const en: SolutionsContent = {
  hero: {
    badge: "SaaS · FinTech · Healthcare · Enterprise",
    titleLead: "Compliance that",
    titleAccent: "pays for itself",
    subtitle:
      "GRC Eye replaces compliance consultants, audit scrambles, and manual reporting with an automated programme that cuts costs, accelerates enterprise deals, and gives your board a live view of risk.",
    ctaPrimary: "Start free, no credit card",
    ctaSecondary: "Book a demo",
  },
  roi: [
    { value: "40%", label: "Reduction in compliance costs" },
    { value: "3–5 wks", label: "Faster enterprise sales cycles" },
    { value: "5 days", label: "Average audit duration (vs 6 weeks)" },
    { value: "85+", label: "Frameworks covered out of the box" },
  ],
  business: {
    title: "The business case, in four lines",
    subtitle:
      "GRC is not an IT cost. It is a revenue driver, a risk buffer, and a board-confidence tool, when it is automated.",
    items: [
      {
        title: "Compliance costs 40% less",
        body: "Replace consultant fees, spreadsheet hours, and last-minute audit scrambles with a continuous automated programme. Most customers recover the platform cost within the first audit cycle.",
      },
      {
        title: "Enterprise deals close faster",
        body: "With evidence, policies and compliance reports ready to share, security questionnaires stop stalling deals. Customers have reported 3–5 week shorter sales cycles once their compliance posture was documented.",
      },
      {
        title: "Board reporting in 30 seconds",
        body: "Stop waiting two days for a compliance status update. Generate a board-ready PDF (risk exposure, compliance score, open gaps, audit findings) in a single click.",
      },
      {
        title: "Regulatory risk is visible, not buried",
        body: "When a new regulation hits (DORA, NIS2, EU AI Act, NCA ECC), GRC Eye maps your existing controls to the new framework. Your gaps are visible before the regulator knocks.",
      },
    ],
  },
  industries: {
    title: "Built for your industry",
    subtitle: "Pre-loaded frameworks, control mappings, and risk templates for every regulated sector.",
    included: "What's included",
    frameworksLabel: "Frameworks",
    items: {
      saas: {
        label: "SaaS & Technology",
        headline: "Turn SOC 2 and ISO 27001 into a sales asset",
        ceoValue:
          "Every enterprise deal that asks for SOC 2 evidence is either closed faster or lost to a competitor who had its evidence ready. GRC Eye gets you audit-ready, and keeps you there.",
        metrics: [
          { value: "3–5 weeks", label: "faster enterprise deal cycles" },
          { value: "Day 1", label: "full control library live" },
          { value: "30 sec", label: "to generate a board report" },
        ],
        points: [
          "Pre-built SOC 2 Trust Services Criteria controls: nothing to build",
          "ISO 27001:2022 gap analysis in hours instead of 6–8 weeks",
          "Cross-framework mapping: reuse SOC 2 evidence for ISO 27001",
          "AI-generated security policies tailored to your product",
          "Auditor portal cuts audit duration from 6 weeks to 5 days",
        ],
        frameworks: FRAMEWORKS.saas,
      },
      health: {
        label: "Healthcare & Life Sciences",
        headline: "HIPAA and GDPR, with a complete audit trail",
        ceoValue:
          "A single HIPAA breach costs an average of $10.9M. GRC Eye keeps your compliance programme continuous and your evidence always audit-ready, so you're never exposed.",
        metrics: [
          { value: "$10.9M", label: "average HIPAA breach cost (avoidable)" },
          { value: "Built in", label: "breach notification tracking" },
          { value: "Every control", label: "with evidence and audit trail" },
        ],
        points: [
          "HIPAA Security Rule, Privacy Rule, and Breach Notification controls",
          "Incident management with breach notification and timeline tracking",
          "AI-generated privacy policies and procedures",
          "Role-based access: staff see only what they need",
          "Scheduled compliance reports emailed to leadership",
        ],
        frameworks: FRAMEWORKS.health,
      },
      fintech: {
        label: "Financial Services & FinTech",
        headline: "DORA, PCI DSS, NIS2 and SAMA in one platform",
        ceoValue:
          "Regulatory overlap is costing FinTechs 2–3x more than it should. GRC Eye maps controls once and satisfies multiple regulators simultaneously: one team, one tool, multiple audits.",
        metrics: [
          { value: "60%", label: "reduction in duplicate compliance work" },
          { value: "5 pillars", label: "DORA coverage out of the box" },
          { value: "Jan 2025", label: "DORA enforced. Are you ready?" },
        ],
        points: [
          "DORA digital operational resilience: all 5 pillars",
          "PCI DSS 4.0 cardholder data environment controls",
          "NIS2 Directive implementation mapped and tracked",
          "SAMA Cyber Security Framework and NCA ECC in their official English and Arabic wording",
          "Vendor risk cartography for supply chain exposure",
        ],
        frameworks: FRAMEWORKS.fintech,
      },
      enterprise: {
        label: "Enterprise",
        headline: "Multi-framework GRC that scales with complexity",
        ceoValue:
          "Large organisations waste millions on fragmented GRC tools, external consultants, and manual reporting. GRC Eye consolidates everything (85+ frameworks, 13 roles, every business unit) into one cost centre.",
        metrics: [
          { value: "40–45%", label: "lower total compliance cost" },
          { value: "85+", label: "frameworks in one platform" },
          { value: "13 roles", label: "granular access control built in" },
        ],
        points: [
          "Business perimeters and scoping for subsidiaries and business units",
          "13 built-in roles, multiple roles per user, Active Directory / LDAP sign-in",
          "85+ frameworks with cross-walk mappings: no overlap duplication",
          "Saudi NCA ECC, SAMA CSF and SDAIA PDPL in official English and Arabic",
          "Tamper-evident activity log and audit trail for user actions",
        ],
        frameworks: FRAMEWORKS.enterprise,
      },
    },
  },
  stakeholders: {
    title: "One platform: every stakeholder gets what they need",
    subtitle:
      "GRC Eye is built so the CEO has a live dashboard, the CISO has a full programme, and the auditor never needs to send an email.",
    items: {
      ciso: {
        role: "CISO",
        points: [
          "Full programme visibility across all frameworks",
          "AI gap analysis and remediation tracking",
          "Risk heatmap and board-ready PDF reports",
          "Alerts when risk appetite thresholds are breached",
        ],
      },
      compliance: {
        role: "Compliance Manager",
        points: [
          "Evidence requests sent by link, no account needed",
          "AI writes remediation steps so you fix faster",
          "Cross-framework evidence reuse: upload once",
          "Auditor portal replaces email back-and-forth",
        ],
      },
      sales: {
        role: "Sales Team",
        points: [
          "Compliance reports ready for every enterprise call",
          "Security questionnaires answered in minutes",
          "Compliance posture documented before the prospect asks",
        ],
      },
      engineering: {
        role: "Engineering",
        points: [
          "200+ fewer hours per audit cycle",
          "No more last-minute audit evidence requests",
          "Vulnerability scanner connectors: Tenable, Nessus, Qualys",
        ],
      },
      auditors: {
        role: "External Auditors",
        points: [
          "Scoped portal: no email attachments",
          "12 months of continuous evidence, not a 6-week pack",
          "Findings logged directly in the platform",
        ],
      },
    },
  },
  ai: {
    title: "Private AI on your terms",
    body: "Every AI feature in GRC Eye (document generation, contract review, gap analysis, vendor prescreening) can run where you decide: deploy the Private edition on-premises with a local model, with zero data egress, or connect your own AI endpoint. Suitable for the most sensitive regulated environments.",
    tags: ["Private edition", "Local AI model", "Bring your own AI endpoint", "Air-gap capable"],
    cta: "Try it free",
  },
  cta: {
    title: "Ready to make compliance a competitive advantage?",
    body: "Start a free 14-day trial or book a 30-minute demo with our team. Full platform access. No credit card. No consultants.",
    trial: "Start free trial",
    demo: "Book a demo",
  },
};

const fr: SolutionsContent = {
  hero: {
    badge: "SaaS · FinTech · Santé · Grandes entreprises",
    titleLead: "Une conformité qui",
    titleAccent: "se rentabilise",
    subtitle:
      "GRC Eye remplace les consultants, les audits préparés dans l'urgence et le reporting manuel par un programme automatisé qui réduit les coûts, accélère les ventes aux grands comptes et donne à votre conseil d'administration une vision en temps réel des risques.",
    ctaPrimary: "Essai gratuit, sans carte bancaire",
    ctaSecondary: "Réserver une démo",
  },
  roi: [
    { value: "40 %", label: "De réduction des coûts de conformité" },
    { value: "3–5 sem.", label: "De cycle de vente grands comptes en moins" },
    { value: "5 jours", label: "Durée moyenne d'un audit (contre 6 semaines)" },
    { value: "85+", label: "Référentiels disponibles dès le départ" },
  ],
  business: {
    title: "L'intérêt business, en quatre points",
    subtitle:
      "La GRC n'est pas un coût informatique. Automatisée, elle devient un levier de revenus, un amortisseur de risques et un gage de confiance pour le conseil d'administration.",
    items: [
      {
        title: "Une conformité 40 % moins chère",
        body: "Remplacez les honoraires de consultants, les heures passées sur des tableurs et les préparations d'audit de dernière minute par un programme continu et automatisé. La plupart des clients amortissent la plateforme dès le premier cycle d'audit.",
      },
      {
        title: "Des contrats grands comptes signés plus vite",
        body: "Avec des preuves, des politiques et des rapports de conformité prêts à partager, les questionnaires de sécurité ne bloquent plus vos ventes. Des clients ont constaté des cycles de vente raccourcis de 3 à 5 semaines une fois leur posture de conformité documentée.",
      },
      {
        title: "Un reporting au conseil en 30 secondes",
        body: "Fini d'attendre deux jours un point sur la conformité. Générez en un clic un PDF prêt pour le conseil : exposition aux risques, score de conformité, écarts ouverts, constats d'audit.",
      },
      {
        title: "Le risque réglementaire mis en lumière",
        body: "Lorsqu'une nouvelle réglementation arrive (DORA, NIS2, AI Act, NCA ECC), GRC Eye rapproche vos contrôles existants du nouveau référentiel. Vos écarts sont visibles avant que le régulateur ne frappe à la porte.",
      },
    ],
  },
  industries: {
    title: "Conçu pour votre secteur",
    subtitle: "Des référentiels, des correspondances de contrôles et des modèles de risques préchargés pour chaque secteur réglementé.",
    included: "Ce qui est inclus",
    frameworksLabel: "Référentiels",
    items: {
      saas: {
        label: "SaaS & Technologie",
        headline: "Faites de SOC 2 et d'ISO 27001 un atout commercial",
        ceoValue:
          "Chaque contrat grand compte qui exige des preuves SOC 2 est soit conclu plus vite, soit perdu au profit d'un concurrent qui avait ses preuves prêtes. GRC Eye vous rend prêt pour l'audit, et vous y maintient.",
        metrics: [
          { value: "3–5 semaines", label: "de cycle de vente gagnées" },
          { value: "Jour 1", label: "bibliothèque de contrôles complète" },
          { value: "30 s", label: "pour générer un rapport au conseil" },
        ],
        points: [
          "Contrôles SOC 2 (Trust Services Criteria) prêts à l'emploi : rien à construire",
          "Analyse d'écarts ISO 27001:2022 en quelques heures au lieu de 6 à 8 semaines",
          "Correspondances entre référentiels : réutilisez vos preuves SOC 2 pour ISO 27001",
          "Politiques de sécurité générées par l'IA et adaptées à votre produit",
          "Le portail auditeur ramène la durée d'audit de 6 semaines à 5 jours",
        ],
        frameworks: FRAMEWORKS.saas,
      },
      health: {
        label: "Santé & Sciences de la vie",
        headline: "HIPAA et RGPD, avec une piste d'audit complète",
        ceoValue:
          "Une seule violation HIPAA coûte en moyenne 10,9 M$. GRC Eye maintient votre programme de conformité en continu et vos preuves toujours prêtes pour l'audit, pour ne jamais rester exposé.",
        metrics: [
          { value: "10,9 M$", label: "coût moyen d'une violation HIPAA (évitable)" },
          { value: "Intégré", label: "suivi des notifications de violation" },
          { value: "Chaque contrôle", label: "avec preuves et piste d'audit" },
        ],
        points: [
          "Contrôles HIPAA : Security Rule, Privacy Rule et Breach Notification",
          "Gestion des incidents avec notification de violation et chronologie",
          "Politiques et procédures de confidentialité générées par l'IA",
          "Accès par rôle : chacun ne voit que ce dont il a besoin",
          "Rapports de conformité planifiés, envoyés par e-mail à la direction",
        ],
        frameworks: FRAMEWORKS.health,
      },
      fintech: {
        label: "Services financiers & FinTech",
        headline: "DORA, PCI DSS, NIS2 et SAMA sur une seule plateforme",
        ceoValue:
          "Le chevauchement réglementaire coûte aux FinTech 2 à 3 fois plus que nécessaire. GRC Eye mappe les contrôles une seule fois et répond simultanément à plusieurs régulateurs : une équipe, un outil, plusieurs audits.",
        metrics: [
          { value: "60 %", label: "de travail de conformité en double en moins" },
          { value: "5 piliers", label: "de DORA couverts dès le départ" },
          { value: "Janv. 2025", label: "DORA est en vigueur. Êtes-vous prêt ?" },
        ],
        points: [
          "Résilience opérationnelle numérique DORA : les 5 piliers",
          "Contrôles PCI DSS 4.0 pour l'environnement des données de cartes",
          "Mise en œuvre de la directive NIS2 cartographiée et suivie",
          "Cadre de cybersécurité de la SAMA et NCA ECC dans leur version officielle anglaise et arabe",
          "Cartographie des risques fournisseurs pour l'exposition de la chaîne d'approvisionnement",
        ],
        frameworks: FRAMEWORKS.fintech,
      },
      enterprise: {
        label: "Grandes entreprises",
        headline: "Une GRC multi-référentiels qui suit votre complexité",
        ceoValue:
          "Les grandes organisations gaspillent des millions en outils GRC fragmentés, en consultants externes et en reporting manuel. GRC Eye regroupe tout (85+ référentiels, 13 rôles, toutes vos entités) dans un seul centre de coûts.",
        metrics: [
          { value: "40–45 %", label: "de coût total de conformité en moins" },
          { value: "85+", label: "référentiels sur une seule plateforme" },
          { value: "13 rôles", label: "contrôle d'accès fin intégré" },
        ],
        points: [
          "Périmètres métier et cadrage par filiale et par entité",
          "13 rôles intégrés, plusieurs rôles par utilisateur, connexion Active Directory / LDAP",
          "85+ référentiels avec correspondances croisées : aucun travail en double",
          "NCA ECC, SAMA CSF et SDAIA PDPL (Arabie saoudite) dans leur version officielle anglaise et arabe",
          "Journal d'activité infalsifiable et piste d'audit des actions utilisateurs",
        ],
        frameworks: FRAMEWORKS.enterprise,
      },
    },
  },
  stakeholders: {
    title: "Une plateforme : chaque partie prenante y trouve son compte",
    subtitle:
      "GRC Eye est pensé pour que le dirigeant dispose d'un tableau de bord en temps réel, le RSSI d'un programme complet, et que l'auditeur n'ait jamais besoin d'envoyer un e-mail.",
    items: {
      ciso: {
        role: "RSSI",
        points: [
          "Visibilité complète du programme sur tous les référentiels",
          "Analyse d'écarts par l'IA et suivi de la remédiation",
          "Carte de chaleur des risques et rapports PDF prêts pour le conseil",
          "Alertes en cas de dépassement des seuils d'appétence au risque",
        ],
      },
      compliance: {
        role: "Responsable conformité",
        points: [
          "Demandes de preuves envoyées par lien, sans compte",
          "L'IA rédige les étapes de remédiation pour corriger plus vite",
          "Réutilisation des preuves entre référentiels : un seul dépôt",
          "Le portail auditeur remplace les allers-retours par e-mail",
        ],
      },
      sales: {
        role: "Équipe commerciale",
        points: [
          "Rapports de conformité prêts pour chaque rendez-vous grand compte",
          "Questionnaires de sécurité remplis en quelques minutes",
          "Posture de conformité documentée avant même la question du prospect",
        ],
      },
      engineering: {
        role: "Équipes techniques",
        points: [
          "Plus de 200 heures économisées par cycle d'audit",
          "Fini les demandes de preuves de dernière minute",
          "Connecteurs de scanners de vulnérabilités : Tenable, Nessus, Qualys",
        ],
      },
      auditors: {
        role: "Auditeurs externes",
        points: [
          "Portail à périmètre restreint : aucune pièce jointe par e-mail",
          "12 mois de preuves continues, et non un dossier de 6 semaines",
          "Constats consignés directement dans la plateforme",
        ],
      },
    },
  },
  ai: {
    title: "Une IA privée à vos conditions",
    body: "Toutes les fonctions d'IA de GRC Eye (génération de documents, revue de contrats, analyse d'écarts, présélection des fournisseurs) s'exécutent là où vous le décidez : déployez l'édition privée sur site avec un modèle local, sans qu'aucune donnée ne sorte, ou connectez votre propre point d'accès IA. Adapté aux environnements réglementés les plus sensibles.",
    tags: ["Édition privée", "Modèle d'IA local", "Votre propre point d'accès IA", "Compatible air-gap"],
    cta: "Essayer gratuitement",
  },
  cta: {
    title: "Prêt à faire de la conformité un avantage concurrentiel ?",
    body: "Démarrez un essai gratuit de 14 jours ou réservez une démo de 30 minutes avec notre équipe. Accès complet à la plateforme. Sans carte bancaire. Sans consultants.",
    trial: "Démarrer l'essai gratuit",
    demo: "Réserver une démo",
  },
};

const ar: SolutionsContent = {
  hero: {
    badge: "البرمجيات السحابية · التقنية المالية · الرعاية الصحية · المؤسسات الكبرى",
    titleLead: "امتثال",
    titleAccent: "يغطي تكلفته بنفسه",
    subtitle:
      "يستبدل GRC Eye الاستشاريين والتحضير المرتبك للتدقيق والتقارير اليدوية ببرنامج مؤتمت يخفض التكاليف، ويسرّع صفقات المؤسسات الكبرى، ويمنح مجلس الإدارة رؤية فورية للمخاطر.",
    ctaPrimary: "ابدأ مجانًا، دون بطاقة ائتمان",
    ctaSecondary: "احجز عرضًا توضيحيًا",
  },
  roi: [
    { value: "40%", label: "خفض في تكاليف الامتثال" },
    { value: "3–5 أسابيع", label: "تسريع لدورات البيع للمؤسسات" },
    { value: "5 أيام", label: "متوسط مدة التدقيق (مقابل 6 أسابيع)" },
    { value: "+85", label: "إطارًا جاهزًا للاستخدام" },
  ],
  business: {
    title: "الجدوى التجارية في أربعة أسطر",
    subtitle:
      "الحوكمة والمخاطر والامتثال ليست تكلفة تقنية. فعندما تكون مؤتمتة، تصبح محركًا للإيرادات وحاجزًا أمام المخاطر وأداة لتعزيز ثقة مجلس الإدارة.",
    items: [
      {
        title: "امتثال بتكلفة أقل بنسبة 40%",
        body: "استبدل أتعاب الاستشاريين وساعات العمل على جداول البيانات والتحضير المتأخر للتدقيق ببرنامج مستمر ومؤتمت. يسترد معظم العملاء تكلفة المنصة خلال أول دورة تدقيق.",
      },
      {
        title: "صفقات المؤسسات تُغلق أسرع",
        body: "مع أدلة وسياسات وتقارير امتثال جاهزة للمشاركة، لم تعد استبيانات الأمن تعطّل الصفقات. أفاد عملاء بتقليص دورات البيع بمقدار 3 إلى 5 أسابيع بعد توثيق وضعهم في الامتثال.",
      },
      {
        title: "تقارير مجلس الإدارة في 30 ثانية",
        body: "لا داعي لانتظار يومين للحصول على تحديث حالة الامتثال. أنشئ بنقرة واحدة تقرير PDF جاهزًا لمجلس الإدارة يتضمن التعرض للمخاطر ودرجة الامتثال والفجوات المفتوحة وملاحظات التدقيق.",
      },
      {
        title: "المخاطر التنظيمية واضحة لا مخفية",
        body: "عند صدور تنظيم جديد (DORA أو NIS2 أو قانون الذكاء الاصطناعي الأوروبي أو الضوابط الأساسية للأمن السيبراني)، يربط GRC Eye ضوابطك الحالية بالإطار الجديد، فتظهر فجواتك قبل أن يطرق المنظِّم بابك.",
      },
    ],
  },
  industries: {
    title: "مصمَّم لقطاعك",
    subtitle: "أطر ومطابقات ضوابط ونماذج مخاطر محمّلة مسبقًا لكل قطاع خاضع للتنظيم.",
    included: "ما الذي يتضمنه",
    frameworksLabel: "الأطر",
    items: {
      saas: {
        label: "البرمجيات السحابية والتقنية",
        headline: "اجعل SOC 2 وISO 27001 ميزة تنافسية في المبيعات",
        ceoValue:
          "كل صفقة مع مؤسسة كبرى تطلب أدلة SOC 2 إما أن تُغلق أسرع، أو تذهب إلى منافس كانت أدلته جاهزة. يجعلك GRC Eye جاهزًا للتدقيق، ويُبقيك كذلك.",
        metrics: [
          { value: "3–5 أسابيع", label: "تسريع لدورات صفقات المؤسسات" },
          { value: "اليوم الأول", label: "مكتبة ضوابط كاملة جاهزة" },
          { value: "30 ثانية", label: "لإنشاء تقرير لمجلس الإدارة" },
        ],
        points: [
          "ضوابط معايير خدمات الثقة في SOC 2 جاهزة مسبقًا: لا شيء لتبنيه",
          "تحليل فجوات ISO 27001:2022 في ساعات بدلًا من 6 إلى 8 أسابيع",
          "مطابقة بين الأطر: أعد استخدام أدلة SOC 2 لمعيار ISO 27001",
          "سياسات أمن يولّدها الذكاء الاصطناعي ومصمَّمة لمنتجك",
          "بوابة المدقق تقلّص مدة التدقيق من 6 أسابيع إلى 5 أيام",
        ],
        frameworks: FRAMEWORKS.saas,
      },
      health: {
        label: "الرعاية الصحية وعلوم الحياة",
        headline: "HIPAA واللائحة العامة لحماية البيانات، مع سجل تدقيق كامل",
        ceoValue:
          "يكلّف خرق واحد لـ HIPAA في المتوسط 10.9 مليون دولار. يحافظ GRC Eye على استمرارية برنامج الامتثال لديك وجاهزية أدلتك للتدقيق دائمًا، فلا تبقى معرَّضًا للمخاطر.",
        metrics: [
          { value: "10.9 مليون $", label: "متوسط تكلفة خرق HIPAA (يمكن تجنبه)" },
          { value: "مدمج", label: "تتبّع الإخطار بالخروقات" },
          { value: "كل ضابط", label: "مع الأدلة وسجل التدقيق" },
        ],
        points: [
          "ضوابط HIPAA: قاعدة الأمن وقاعدة الخصوصية وقاعدة الإخطار بالخروقات",
          "إدارة الحوادث مع الإخطار بالخروقات وتتبّع التسلسل الزمني",
          "سياسات وإجراءات خصوصية يولّدها الذكاء الاصطناعي",
          "وصول قائم على الأدوار: كل موظف يرى ما يحتاجه فقط",
          "تقارير امتثال مجدولة تُرسل بالبريد الإلكتروني إلى الإدارة",
        ],
        frameworks: FRAMEWORKS.health,
      },
      fintech: {
        label: "الخدمات المالية والتقنية المالية",
        headline: "DORA وPCI DSS وNIS2 وإطار ساما في منصة واحدة",
        ceoValue:
          "يكلّف تداخل المتطلبات التنظيمية شركات التقنية المالية ضعفين إلى ثلاثة أضعاف ما ينبغي. يطابق GRC Eye الضوابط مرة واحدة ويلبّي متطلبات عدة جهات تنظيمية في آن واحد: فريق واحد، أداة واحدة، عمليات تدقيق متعددة.",
        metrics: [
          { value: "60%", label: "خفض في أعمال الامتثال المكررة" },
          { value: "5 ركائز", label: "تغطية DORA جاهزة للاستخدام" },
          { value: "يناير 2025", label: "دخل DORA حيز التنفيذ. هل أنت مستعد؟" },
        ],
        points: [
          "المرونة التشغيلية الرقمية وفق DORA: الركائز الخمس كاملة",
          "ضوابط PCI DSS 4.0 لبيئة بيانات حاملي البطاقات",
          "تطبيق توجيه NIS2 مع المطابقة والمتابعة",
          "الدليل التنظيمي لأمن المعلومات في القطاع المالي (ساما) والضوابط الأساسية للأمن السيبراني (NCA) بنصّهما الرسمي بالعربية والإنجليزية",
          "خريطة مخاطر الموردين لتقييم التعرض في سلسلة الإمداد",
        ],
        frameworks: FRAMEWORKS.fintech,
      },
      enterprise: {
        label: "المؤسسات الكبرى",
        headline: "حوكمة متعددة الأطر تواكب تعقيد مؤسستك",
        ceoValue:
          "تهدر المؤسسات الكبرى الملايين على أدوات حوكمة متفرقة واستشاريين خارجيين وتقارير يدوية. يجمع GRC Eye كل شيء (أكثر من 85 إطارًا، و13 دورًا، وجميع وحدات الأعمال) في مركز تكلفة واحد.",
        metrics: [
          { value: "40–45%", label: "خفض في إجمالي تكلفة الامتثال" },
          { value: "+85", label: "إطارًا في منصة واحدة" },
          { value: "13 دورًا", label: "تحكم دقيق في الوصول مدمج" },
        ],
        points: [
          "نطاقات أعمال وتحديد للنطاق لكل شركة تابعة ووحدة أعمال",
          "13 دورًا مدمجًا، وأدوار متعددة لكل مستخدم، وتسجيل الدخول عبر Active Directory / LDAP",
          "أكثر من 85 إطارًا مع مطابقات متقاطعة: دون تكرار للعمل",
          "الضوابط الأساسية للأمن السيبراني (NCA) وإطار ساما ونظام حماية البيانات الشخصية (سدايا) بنصّها الرسمي بالعربية والإنجليزية",
          "سجل نشاط مقاوم للتلاعب وسجل تدقيق لإجراءات المستخدمين",
        ],
        frameworks: FRAMEWORKS.enterprise,
      },
    },
  },
  stakeholders: {
    title: "منصة واحدة: كل طرف معني يجد ما يحتاجه",
    subtitle:
      "صُمِّم GRC Eye ليحصل الرئيس التنفيذي على لوحة متابعة فورية، ومسؤول أمن المعلومات على برنامج متكامل، ولا يحتاج المدقق إلى إرسال أي بريد إلكتروني.",
    items: {
      ciso: {
        role: "مسؤول أمن المعلومات",
        points: [
          "رؤية كاملة للبرنامج عبر جميع الأطر",
          "تحليل الفجوات بالذكاء الاصطناعي ومتابعة المعالجة",
          "خريطة حرارية للمخاطر وتقارير PDF جاهزة لمجلس الإدارة",
          "تنبيهات عند تجاوز حدود تقبّل المخاطر",
        ],
      },
      compliance: {
        role: "مدير الامتثال",
        points: [
          "طلبات أدلة تُرسل عبر رابط، دون الحاجة إلى حساب",
          "الذكاء الاصطناعي يكتب خطوات المعالجة لتصلح أسرع",
          "إعادة استخدام الأدلة بين الأطر: ارفعها مرة واحدة",
          "بوابة المدقق تغني عن تبادل الرسائل بالبريد الإلكتروني",
        ],
      },
      sales: {
        role: "فريق المبيعات",
        points: [
          "تقارير امتثال جاهزة لكل اجتماع مع المؤسسات الكبرى",
          "الإجابة عن استبيانات الأمن في دقائق",
          "وضع امتثال موثّق قبل أن يسأل العميل المحتمل",
        ],
      },
      engineering: {
        role: "الفرق التقنية",
        points: [
          "توفير أكثر من 200 ساعة في كل دورة تدقيق",
          "لا مزيد من طلبات الأدلة في اللحظة الأخيرة",
          "موصلات لماسحات الثغرات: Tenable وNessus وQualys",
        ],
      },
      auditors: {
        role: "المدققون الخارجيون",
        points: [
          "بوابة محددة النطاق: دون مرفقات بريد إلكتروني",
          "12 شهرًا من الأدلة المستمرة، لا ملف معدّ في 6 أسابيع",
          "تسجيل الملاحظات مباشرة في المنصة",
        ],
      },
    },
  },
  ai: {
    title: "ذكاء اصطناعي خاص وفق شروطك",
    body: "تعمل جميع ميزات الذكاء الاصطناعي في GRC Eye (توليد المستندات، ومراجعة العقود، وتحليل الفجوات، والفحص المسبق للموردين) حيث تقرر: شغّل الإصدار الخاص داخل بنيتك مع نموذج محلي — دون خروج أي بيانات — أو اربط نقطة الذكاء الاصطناعي الخاصة بك. مناسب لأكثر البيئات التنظيمية حساسية.",
    tags: ["الإصدار الخاص", "نموذج ذكاء اصطناعي محلي", "نقطة ذكاء اصطناعي خاصة بك", "يعمل في بيئة معزولة"],
    cta: "جرّبه مجانًا",
  },
  cta: {
    title: "هل أنت مستعد لتحويل الامتثال إلى ميزة تنافسية؟",
    body: "ابدأ تجربة مجانية لمدة 14 يومًا أو احجز عرضًا توضيحيًا لمدة 30 دقيقة مع فريقنا. وصول كامل إلى المنصة. دون بطاقة ائتمان. دون استشاريين.",
    trial: "ابدأ التجربة المجانية",
    demo: "احجز عرضًا توضيحيًا",
  },
};

export const SOLUTIONS_CONTENT: Record<Language, SolutionsContent> = { en, fr, ar };
