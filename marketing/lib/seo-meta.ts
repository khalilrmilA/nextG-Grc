import type { Locale } from "./seo";

interface PageMeta {
  title: string;
  description: string;
  keywords: string;
  ogTitle: string;
  ogDescription: string;
}

type LocalizedPageMeta = Record<Locale, PageMeta>;

export const PAGE_META: Record<
  "home" | "blog" | "changelog" | "contact" | "faq" | "featuresLanding" | "frameworks" | "howItWorks" | "news" | "solutions",
  LocalizedPageMeta
> = {
  home: {
    en: {
      title: "GRCEye | Governance, Risk & Compliance Platform",
      description:
        "All-in-one GRC SaaS for CISOs and security teams. 70+ frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a trust center.",
      keywords:
        "GRC platform, governance risk compliance, ISO 27001, SOC 2, NIST CSF, GDPR, NIS2, DORA, risk management software, compliance automation, AI compliance, vendor risk management, TPRM, audit software, policy management",
      ogTitle: "GRCEye | Governance, Risk & Compliance Platform",
      ogDescription:
        "The all-in-one GRC SaaS platform with 70+ frameworks, AI gap analysis, risk quantification, audits, policies and vendor risk.",
    },
    fr: {
      title: "GRCEye | Plateforme de Gouvernance, Risques et Conformité",
      description:
        "La solution GRC tout-en-un pour RSSI et équipes sécurité. Plus de 70 référentiels, analyse d'écarts par IA, quantification des risques, audits, politiques, risque fournisseur et trust center.",
      keywords:
        "plateforme GRC, gouvernance risques conformité, ISO 27001, SOC 2, NIST CSF, RGPD, NIS2, DORA, logiciel gestion des risques, automatisation conformité, IA conformité, gestion risque fournisseur, TPRM, logiciel audit, gestion des politiques",
      ogTitle: "GRCEye | Plateforme de Gouvernance, Risques et Conformité",
      ogDescription:
        "La plateforme GRC tout-en-un avec plus de 70 référentiels, analyse d'écarts par IA, quantification des risques, audits, politiques et risque fournisseur.",
    },
    ar: {
      title: "GRCEye | منصة الحوكمة والمخاطر والامتثال",
      description:
        "منصة GRC شاملة لمسؤولي أمن المعلومات وفرق الأمن. أكثر من 70 معياراً، تحليل الفجوات بالذكاء الاصطناعي، تقدير المخاطر، عمليات التدقيق، السياسات، مخاطر الموردين ومركز الثقة.",
      keywords:
        "منصة GRC, حوكمة ومخاطر وامتثال, ISO 27001, SOC 2, NIST CSF, GDPR, NIS2, DORA, برنامج إدارة المخاطر, أتمتة الامتثال, الذكاء الاصطناعي للامتثال, إدارة مخاطر الموردين, برنامج التدقيق, إدارة السياسات",
      ogTitle: "GRCEye | منصة الحوكمة والمخاطر والامتثال",
      ogDescription:
        "منصة GRC شاملة تضم أكثر من 70 معياراً، تحليل فجوات بالذكاء الاصطناعي، تقدير كمي للمخاطر، تدقيق، سياسات ومخاطر موردين.",
    },
  },
  blog: {
    en: {
      title: "GRC Blog | NIS2, ISO 27001, Risk Quantification & More",
      description:
        "In-depth articles on GRC: NIS2 compliance, risk quantification, contract review with AI, auditor portals and how to build custom frameworks.",
      keywords: "GRC blog, NIS2 article, risk quantification guide, ISO 27001 tips, audit blog, compliance articles",
      ogTitle: "GRC Blog | NIS2, ISO 27001, Risk Quantification & More",
      ogDescription:
        "In-depth articles on GRC: NIS2 compliance, risk quantification, contract review with AI, auditor portals and how to build custom frameworks.",
    },
    fr: {
      title: "Blog GRC | NIS2, ISO 27001, Quantification des Risques et Plus",
      description:
        "Articles approfondis sur la GRC : conformité NIS2, quantification des risques, revue de contrats par IA, portails auditeurs et création de référentiels personnalisés.",
      keywords: "blog GRC, article NIS2, guide quantification des risques, conseils ISO 27001, blog audit, articles conformité",
      ogTitle: "Blog GRC | NIS2, ISO 27001, Quantification des Risques et Plus",
      ogDescription:
        "Articles approfondis sur la GRC : conformité NIS2, quantification des risques, revue de contrats par IA, portails auditeurs et création de référentiels personnalisés.",
    },
    ar: {
      title: "مدونة GRC | NIS2 وISO 27001 وتقدير المخاطر والمزيد",
      description:
        "مقالات معمّقة حول الحوكمة والمخاطر والامتثال: الامتثال لـNIS2، تقدير المخاطر، مراجعة العقود بالذكاء الاصطناعي، بوابات المدققين وبناء معايير مخصصة.",
      keywords: "مدونة GRC, مقال NIS2, دليل تقدير المخاطر, نصائح ISO 27001, مدونة تدقيق, مقالات الامتثال",
      ogTitle: "مدونة GRC | NIS2 وISO 27001 وتقدير المخاطر والمزيد",
      ogDescription:
        "مقالات معمّقة حول الحوكمة والمخاطر والامتثال: الامتثال لـNIS2، تقدير المخاطر، مراجعة العقود بالذكاء الاصطناعي، بوابات المدققين وبناء معايير مخصصة.",
    },
  },
  contact: {
    en: {
      title: "Contact GRCEye: Book a Demo, Sales or Support",
      description:
        "Talk to the GRCEye team. Sales, support, partnerships, demos. We typically reply within one business day.",
      keywords: "contact GRCEye, GRC demo, GRC sales contact, GRCEye support",
      ogTitle: "Contact GRCEye: Book a Demo, Sales or Support | GRCEye",
      ogDescription:
        "Talk to the GRCEye team. Sales, support, partnerships, demos. We typically reply within one business day.",
    },
    fr: {
      title: "Contacter GRCEye : Démo, Ventes ou Support",
      description:
        "Contactez l'équipe GRCEye. Ventes, support, partenariats, démonstrations. Nous répondons généralement sous un jour ouvré.",
      keywords: "contact GRCEye, démo GRC, contact ventes GRC, support GRCEye",
      ogTitle: "Contacter GRCEye : Démo, Ventes ou Support | GRCEye",
      ogDescription:
        "Contactez l'équipe GRCEye. Ventes, support, partenariats, démonstrations. Nous répondons généralement sous un jour ouvré.",
    },
    ar: {
      title: "تواصل مع GRCEye: احجز عرضاً توضيحياً أو تواصل مع المبيعات والدعم",
      description:
        "تواصل مع فريق GRCEye. المبيعات، الدعم، الشراكات، العروض التوضيحية. نرد عادةً خلال يوم عمل واحد.",
      keywords: "تواصل مع GRCEye, عرض توضيحي GRC, تواصل مبيعات GRC, دعم GRCEye",
      ogTitle: "تواصل مع GRCEye: احجز عرضاً توضيحياً أو تواصل مع المبيعات والدعم | GRCEye",
      ogDescription:
        "تواصل مع فريق GRCEye. المبيعات، الدعم، الشراكات، العروض التوضيحية. نرد عادةً خلال يوم عمل واحد.",
    },
  },
  faq: {
    en: {
      title: "GRCEye FAQ: Pricing, Security & Compliance Questions",
      description:
        "Answers to common questions about GRCEye: pricing, security, integrations, frameworks, AI features and the auditor portal.",
      keywords: "GRCEye FAQ, GRC platform pricing, GRC security, compliance software questions",
      ogTitle: "GRCEye FAQ: Pricing, Security, Frameworks & Integrations | GRCEye",
      ogDescription:
        "Answers to common questions about GRCEye: pricing, security, integrations, frameworks, AI features and the auditor portal.",
    },
    fr: {
      title: "FAQ GRCEye : Tarifs, Sécurité et Questions de Conformité",
      description:
        "Réponses aux questions fréquentes sur GRCEye : tarifs, sécurité, intégrations, référentiels, fonctionnalités IA et portail auditeur.",
      keywords: "FAQ GRCEye, tarifs plateforme GRC, sécurité GRC, questions logiciel conformité",
      ogTitle: "FAQ GRCEye : Tarifs, Sécurité, Référentiels et Intégrations | GRCEye",
      ogDescription:
        "Réponses aux questions fréquentes sur GRCEye : tarifs, sécurité, intégrations, référentiels, fonctionnalités IA et portail auditeur.",
    },
    ar: {
      title: "الأسئلة الشائعة حول GRCEye: التسعير والأمن وأسئلة الامتثال",
      description:
        "إجابات عن الأسئلة الشائعة حول GRCEye: التسعير، الأمن، التكاملات، المعايير، ميزات الذكاء الاصطناعي وبوابة المدقق.",
      keywords: "الأسئلة الشائعة GRCEye, تسعير منصة GRC, أمن GRC, أسئلة برنامج الامتثال",
      ogTitle: "الأسئلة الشائعة حول GRCEye: التسعير والأمن والمعايير والتكاملات | GRCEye",
      ogDescription:
        "إجابات عن الأسئلة الشائعة حول GRCEye: التسعير، الأمن، التكاملات، المعايير، ميزات الذكاء الاصطناعي وبوابة المدقق.",
    },
  },
  featuresLanding: {
    en: {
      title: "GRC Platform Features | Risk, Compliance & AI Tools",
      description:
        "Explore GRCEye modules: risk register, Monte Carlo quantification, multi-framework compliance, AI gap analysis, audits, policies and vendor risk.",
      keywords:
        "GRC features, risk register, Monte Carlo risk, AI compliance, gap analysis, audit management, vendor risk, TPRM, policy management, threat library",
      ogTitle: "GRC Platform Features: Risk, Compliance & AI Tools | GRCEye",
      ogDescription:
        "Explore every GRCEye module: risk register, Monte Carlo risk quantification, multi-framework compliance, AI gap analysis, audits, policies, vendor risk and more.",
    },
    fr: {
      title: "Fonctionnalités de la Plateforme GRC | Risques, Conformité et IA",
      description:
        "Découvrez les modules GRCEye : registre des risques, quantification Monte Carlo, conformité multi-référentiels, analyse d'écarts par IA, audits, politiques et risque fournisseur.",
      keywords:
        "fonctionnalités GRC, registre des risques, risque Monte Carlo, conformité IA, analyse d'écarts, gestion d'audit, risque fournisseur, TPRM, gestion des politiques, bibliothèque de menaces",
      ogTitle: "Fonctionnalités de la Plateforme GRC : Risques, Conformité et IA | GRCEye",
      ogDescription:
        "Découvrez tous les modules GRCEye : registre des risques, quantification Monte Carlo, conformité multi-référentiels, analyse d'écarts par IA, audits, politiques, risque fournisseur et plus.",
    },
    ar: {
      title: "ميزات منصة GRC | أدوات المخاطر والامتثال والذكاء الاصطناعي",
      description:
        "استكشف وحدات GRCEye: سجل المخاطر، تقدير مونت كارلو، الامتثال متعدد المعايير، تحليل الفجوات بالذكاء الاصطناعي، التدقيق، السياسات ومخاطر الموردين.",
      keywords:
        "ميزات GRC, سجل المخاطر, مخاطر مونت كارلو, امتثال بالذكاء الاصطناعي, تحليل الفجوات, إدارة التدقيق, مخاطر الموردين, إدارة السياسات, مكتبة التهديدات",
      ogTitle: "ميزات منصة GRC: المخاطر والامتثال وأدوات الذكاء الاصطناعي | GRCEye",
      ogDescription:
        "استكشف جميع وحدات GRCEye: سجل المخاطر، تقدير مونت كارلو، الامتثال متعدد المعايير، تحليل الفجوات بالذكاء الاصطناعي، التدقيق، السياسات ومخاطر الموردين.",
    },
  },
  frameworks: {
    en: {
      title: "GRC Frameworks: 70+ Built-in, Fork Any, Build Your Own",
      description:
        "GRCEye ships with 70+ compliance frameworks. Fork any to create an editable copy, or build a custom framework from scratch with the AI-powered builder.",
      keywords:
        "GRC frameworks, ISO 27001, SOC 2, GDPR, DORA, NIS2, HIPAA, custom compliance framework, framework builder, compliance mapping",
      ogTitle: "GRC Frameworks: 70+ Built-in, Fork Any, Build Your Own | GRCEye",
      ogDescription:
        "GRCEye ships with 70+ compliance frameworks. Fork any to create an editable copy, or build a custom framework from scratch with the AI-powered builder.",
    },
    fr: {
      title: "Référentiels GRC : Plus de 70 Intégrés, Dupliquez ou Créez le Vôtre",
      description:
        "GRCEye intègre plus de 70 référentiels de conformité. Dupliquez-en un pour créer une copie modifiable, ou créez un référentiel sur mesure avec le générateur par IA.",
      keywords:
        "référentiels GRC, ISO 27001, SOC 2, RGPD, DORA, NIS2, HIPAA, référentiel de conformité personnalisé, générateur de référentiel, cartographie de conformité",
      ogTitle: "Référentiels GRC : Plus de 70 Intégrés, Dupliquez ou Créez le Vôtre | GRCEye",
      ogDescription:
        "GRCEye intègre plus de 70 référentiels de conformité. Dupliquez-en un pour créer une copie modifiable, ou créez un référentiel sur mesure avec le générateur par IA.",
    },
    ar: {
      title: "معايير GRC: أكثر من 70 معياراً مدمجاً، انسخ أياً منها أو أنشئ معيارك الخاص",
      description:
        "توفر GRCEye أكثر من 70 معياراً للامتثال. انسخ أي معيار لإنشاء نسخة قابلة للتعديل، أو أنشئ معياراً مخصصاً من الصفر باستخدام أداة البناء المدعومة بالذكاء الاصطناعي.",
      keywords:
        "معايير GRC, ISO 27001, SOC 2, GDPR, DORA, NIS2, HIPAA, معيار امتثال مخصص, أداة بناء المعايير, مطابقة الامتثال",
      ogTitle: "معايير GRC: أكثر من 70 معياراً مدمجاً، انسخ أياً منها أو أنشئ معيارك الخاص | GRCEye",
      ogDescription:
        "توفر GRCEye أكثر من 70 معياراً للامتثال. انسخ أي معيار لإنشاء نسخة قابلة للتعديل، أو أنشئ معياراً مخصصاً من الصفر باستخدام أداة البناء المدعومة بالذكاء الاصطناعي.",
    },
  },
  howItWorks: {
    en: {
      title: "How GRCEye Works: AI-Powered GRC Explained",
      description:
        "GRCEye AI: vendor chat, contract review, document generation, gap analysis. All on-premise. Zero data egress. See exactly how each AI feature works.",
      keywords:
        "how GRC works, AI contract review, AI document generator, GRC AI assistant, vendor risk AI, compliance gap analysis AI",
      ogTitle: "How GRCEye Works: AI-Powered GRC Explained | GRCEye",
      ogDescription:
        "GRCEye AI: vendor chat, contract review, document generation, gap analysis. All on-premise. Zero data egress. See exactly how each AI feature works.",
    },
    fr: {
      title: "Comment Fonctionne GRCEye : L'IA au Service de la GRC",
      description:
        "IA GRCEye : chat fournisseur, revue de contrats, génération de documents, analyse d'écarts. Tout en local, sans fuite de données. Découvrez le fonctionnement de chaque fonctionnalité IA.",
      keywords:
        "fonctionnement GRC, revue de contrats IA, générateur de documents IA, assistant IA GRC, IA risque fournisseur, analyse d'écarts de conformité IA",
      ogTitle: "Comment Fonctionne GRCEye : L'IA au Service de la GRC | GRCEye",
      ogDescription:
        "IA GRCEye : chat fournisseur, revue de contrats, génération de documents, analyse d'écarts. Tout en local, sans fuite de données. Découvrez le fonctionnement de chaque fonctionnalité IA.",
    },
    ar: {
      title: "كيف تعمل GRCEye: شرح الحوكمة والمخاطر والامتثال المدعومة بالذكاء الاصطناعي",
      description:
        "ذكاء GRCEye الاصطناعي: محادثة الموردين، مراجعة العقود، توليد المستندات، تحليل الفجوات. كله محلياً بدون تسرّب بيانات. تعرّف بالضبط على كيفية عمل كل ميزة ذكاء اصطناعي.",
      keywords:
        "كيف يعمل GRC, مراجعة العقود بالذكاء الاصطناعي, مولّد المستندات بالذكاء الاصطناعي, مساعد GRC الذكي, ذكاء اصطناعي لمخاطر الموردين, تحليل فجوات الامتثال بالذكاء الاصطناعي",
      ogTitle: "كيف تعمل GRCEye: شرح الحوكمة والمخاطر والامتثال المدعومة بالذكاء الاصطناعي | GRCEye",
      ogDescription:
        "ذكاء GRCEye الاصطناعي: محادثة الموردين، مراجعة العقود، توليد المستندات، تحليل الفجوات. كله محلياً بدون تسرّب بيانات. تعرّف بالضبط على كيفية عمل كل ميزة ذكاء اصطناعي.",
    },
  },
  news: {
    en: {
      title: "Regulatory News & Framework Updates",
      description:
        "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
      keywords:
        "EU AI Act news, NIST CSF 2.0, GDPR enforcement, NIS2 deadline, ISO 27001 update, DORA news, regulatory updates",
      ogTitle: "Regulatory News & Framework Updates | GRCEye",
      ogDescription:
        "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
    },
    fr: {
      title: "Actualités Réglementaires et Mises à Jour des Référentiels",
      description:
        "Suivez les dernières évolutions réglementaires GRC : AI Act européen, NIST CSF 2.0, application du RGPD, échéances NIS2, mises à jour ISO 27001 et jalons DORA.",
      keywords:
        "actualités AI Act européen, NIST CSF 2.0, application RGPD, échéance NIS2, mise à jour ISO 27001, actualités DORA, mises à jour réglementaires",
      ogTitle: "Actualités Réglementaires et Mises à Jour des Référentiels | GRCEye",
      ogDescription:
        "Suivez les dernières évolutions réglementaires GRC : AI Act européen, NIST CSF 2.0, application du RGPD, échéances NIS2, mises à jour ISO 27001 et jalons DORA.",
    },
    ar: {
      title: "الأخبار التنظيمية وتحديثات المعايير",
      description:
        "تابع أحدث التغييرات التنظيمية في مجال الحوكمة والمخاطر والامتثال: قانون الاتحاد الأوروبي للذكاء الاصطناعي، NIST CSF 2.0، تطبيق GDPR، مواعيد NIS2 النهائية، تحديثات ISO 27001 ومحطات DORA.",
      keywords:
        "أخبار قانون الذكاء الاصطناعي الأوروبي, NIST CSF 2.0, تطبيق GDPR, الموعد النهائي NIS2, تحديث ISO 27001, أخبار DORA, التحديثات التنظيمية",
      ogTitle: "الأخبار التنظيمية وتحديثات المعايير | GRCEye",
      ogDescription:
        "تابع أحدث التغييرات التنظيمية في مجال الحوكمة والمخاطر والامتثال: قانون الاتحاد الأوروبي للذكاء الاصطناعي، NIST CSF 2.0، تطبيق GDPR، مواعيد NIS2 النهائية، تحديثات ISO 27001 ومحطات DORA.",
    },
  },
  changelog: {
    en: {
      title: "Changelog | What's New in GRCEye",
      description:
        "The full GRCEye release timeline: risk quantification, TPRM, asset cartography, MFA, on-premises licensing and every major feature shipped since launch.",
      keywords: "GRCEye changelog, GRC platform updates, product release notes, what's new GRCEye",
      ogTitle: "Changelog | What's New in GRCEye",
      ogDescription:
        "The full GRCEye release timeline: risk quantification, TPRM, asset cartography, MFA, on-premises licensing and every major feature shipped since launch.",
    },
    fr: {
      title: "Journal des Mises à Jour | Nouveautés GRCEye",
      description:
        "La chronologie complète des versions GRCEye : quantification des risques, TPRM, cartographie des actifs, MFA, licences on-premise et toutes les fonctionnalités majeures livrées depuis le lancement.",
      keywords: "journal des modifications GRCEye, mises à jour plateforme GRC, notes de version, nouveautés GRCEye",
      ogTitle: "Journal des Mises à Jour | Nouveautés GRCEye",
      ogDescription:
        "La chronologie complète des versions GRCEye : quantification des risques, TPRM, cartographie des actifs, MFA, licences on-premise et toutes les fonctionnalités majeures livrées depuis le lancement.",
    },
    ar: {
      title: "سجل التحديثات | ما الجديد في GRCEye",
      description:
        "الجدول الزمني الكامل لإصدارات GRCEye: تقدير المخاطر، إدارة مخاطر الموردين، رسم خرائط الأصول، المصادقة الثنائية، الترخيص المحلي وكل ميزة رئيسية تم إطلاقها منذ الانطلاق.",
      keywords: "سجل تحديثات GRCEye, تحديثات منصة GRC, ملاحظات الإصدار, ما الجديد في GRCEye",
      ogTitle: "سجل التحديثات | ما الجديد في GRCEye",
      ogDescription:
        "الجدول الزمني الكامل لإصدارات GRCEye: تقدير المخاطر، إدارة مخاطر الموردين، رسم خرائط الأصول، المصادقة الثنائية، الترخيص المحلي وكل ميزة رئيسية تم إطلاقها منذ الانطلاق.",
    },
  },
  solutions: {
    en: {
      title: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise",
      description:
        "GRCEye cuts compliance costs 40%, shortens enterprise deals 3-5 weeks, and gives boards a live risk score, for SaaS, FinTech, Healthcare & Enterprise.",
      keywords:
        "GRC for SaaS, GRC for FinTech, GRC for Healthcare, compliance cost reduction, CEO GRC platform, enterprise GRC solution",
      ogTitle: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise | GRCEye",
      ogDescription:
        "GRCEye cuts compliance costs 40%, shortens enterprise deals 3-5 weeks, and gives boards a live risk score, for SaaS, FinTech, Healthcare & Enterprise.",
    },
    fr: {
      title: "Solutions GRC pour SaaS, FinTech, Santé et Grands Comptes",
      description:
        "GRCEye réduit les coûts de conformité de 40 %, raccourcit les cycles de vente de 3 à 5 semaines, et donne aux conseils d'administration un score de risque en temps réel, pour SaaS, FinTech, Santé et Grands Comptes.",
      keywords:
        "GRC pour SaaS, GRC pour FinTech, GRC pour la santé, réduction des coûts de conformité, plateforme GRC pour dirigeants, solution GRC entreprise",
      ogTitle: "Solutions GRC pour SaaS, FinTech, Santé et Grands Comptes | GRCEye",
      ogDescription:
        "GRCEye réduit les coûts de conformité de 40 %, raccourcit les cycles de vente de 3 à 5 semaines, et donne aux conseils d'administration un score de risque en temps réel, pour SaaS, FinTech, Santé et Grands Comptes.",
    },
    ar: {
      title: "حلول GRC لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات",
      description:
        "تخفّض GRCEye تكاليف الامتثال بنسبة 40%، وتقصّر دورات الصفقات المؤسسية بمقدار 3-5 أسابيع، وتمنح مجالس الإدارة درجة مخاطر حية، لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات.",
      keywords:
        "GRC لشركات SaaS, GRC للتقنية المالية, GRC للرعاية الصحية, خفض تكاليف الامتثال, منصة GRC للمدراء التنفيذيين, حل GRC للمؤسسات",
      ogTitle: "حلول GRC لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات | GRCEye",
      ogDescription:
        "تخفّض GRCEye تكاليف الامتثال بنسبة 40%، وتقصّر دورات الصفقات المؤسسية بمقدار 3-5 أسابيع، وتمنح مجالس الإدارة درجة مخاطر حية، لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات.",
    },
  },
};
