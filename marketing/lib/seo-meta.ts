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
  "home" | "blog" | "changelog" | "contact" | "faq" | "featuresLanding" | "frameworks" | "howItWorks" | "news" | "solutions" | "pricing",
  LocalizedPageMeta
> = {
  home: {
    en: {
      title: "GRC Eye | Governance, Risk & Compliance Platform",
      description:
        "All-in-one GRC platform for CISOs and security teams. 85+ frameworks incl. Saudi NCA, SAMA and PDPL, AI gap analysis, risk, audits, policies and vendor risk.",
      keywords:
        "GRC platform, governance risk compliance, ISO 27001, SOC 2, NIST CSF, GDPR, NIS2, DORA, risk management software, compliance automation, AI compliance, vendor risk management, TPRM, audit software, policy management",
      ogTitle: "GRC Eye | Governance, Risk & Compliance Platform",
      ogDescription:
        "The all-in-one GRC platform with 85+ frameworks, 5,000+ controls, AI gap analysis, risk management, audits, policies and vendor risk. EN, FR and AR.",
    },
    fr: {
      title: "GRC Eye | Plateforme de Gouvernance, Risques et Conformité",
      description:
        "La solution GRC tout-en-un pour RSSI et équipes sécurité. Plus de 85 référentiels dont NCA, SAMA et PDPL, analyse d'écarts par IA, risques, audits, politiques et risque fournisseur.",
      keywords:
        "plateforme GRC, gouvernance risques conformité, ISO 27001, SOC 2, NIST CSF, RGPD, NIS2, DORA, logiciel gestion des risques, automatisation conformité, IA conformité, gestion risque fournisseur, TPRM, logiciel audit, gestion des politiques",
      ogTitle: "GRC Eye | Plateforme de Gouvernance, Risques et Conformité",
      ogDescription:
        "La plateforme GRC tout-en-un avec plus de 85 référentiels, plus de 5 000 contrôles, analyse d'écarts par IA, gestion des risques, audits, politiques et risque fournisseur. FR, EN et AR.",
    },
    ar: {
      title: "GRC Eye | منصة الحوكمة والمخاطر والامتثال",
      description:
        "منصة GRC شاملة لمسؤولي أمن المعلومات وفرق الأمن. أكثر من 85 إطاراً تنظيمياً بينها ضوابط الهيئة الوطنية للأمن السيبراني وساما ونظام حماية البيانات الشخصية، تحليل الفجوات بالذكاء الاصطناعي، إدارة المخاطر، التدقيق، السياسات ومخاطر الموردين.",
      keywords:
        "منصة GRC, حوكمة ومخاطر وامتثال, ISO 27001, SOC 2, NIST CSF, GDPR, NIS2, DORA, برنامج إدارة المخاطر, أتمتة الامتثال, الذكاء الاصطناعي للامتثال, إدارة مخاطر الموردين, برنامج التدقيق, إدارة السياسات",
      ogTitle: "GRC Eye | منصة الحوكمة والمخاطر والامتثال",
      ogDescription:
        "منصة GRC شاملة تضم أكثر من 85 إطاراً وأكثر من 5,000 ضابط، تحليل فجوات بالذكاء الاصطناعي، إدارة المخاطر، تدقيق، سياسات ومخاطر موردين، بالعربية والإنجليزية والفرنسية.",
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
      title: "Contact GRC Eye: Book a Demo, Sales or Support",
      description:
        "Talk to the GRC Eye team. Sales, support, partnerships, demos. We typically reply within one business day.",
      keywords: "contact GRC Eye, GRC demo, GRC sales contact, GRC Eye support",
      ogTitle: "Contact GRC Eye: Book a Demo, Sales or Support | GRC Eye",
      ogDescription:
        "Talk to the GRC Eye team. Sales, support, partnerships, demos. We typically reply within one business day.",
    },
    fr: {
      title: "Contacter GRC Eye : Démo, Ventes ou Support",
      description:
        "Contactez l'équipe GRC Eye. Ventes, support, partenariats, démonstrations. Nous répondons généralement sous un jour ouvré.",
      keywords: "contact GRC Eye, démo GRC, contact ventes GRC, support GRC Eye",
      ogTitle: "Contacter GRC Eye : Démo, Ventes ou Support | GRC Eye",
      ogDescription:
        "Contactez l'équipe GRC Eye. Ventes, support, partenariats, démonstrations. Nous répondons généralement sous un jour ouvré.",
    },
    ar: {
      title: "تواصل مع GRC Eye: احجز عرضاً توضيحياً أو تواصل مع المبيعات والدعم",
      description:
        "تواصل مع فريق GRC Eye. المبيعات، الدعم، الشراكات، العروض التوضيحية. نرد عادةً خلال يوم عمل واحد.",
      keywords: "تواصل مع GRC Eye, عرض توضيحي GRC, تواصل مبيعات GRC, دعم GRC Eye",
      ogTitle: "تواصل مع GRC Eye: احجز عرضاً توضيحياً أو تواصل مع المبيعات والدعم | GRC Eye",
      ogDescription:
        "تواصل مع فريق GRC Eye. المبيعات، الدعم، الشراكات، العروض التوضيحية. نرد عادةً خلال يوم عمل واحد.",
    },
  },
  faq: {
    en: {
      title: "GRC Eye FAQ: Pricing, Security & Compliance Questions",
      description:
        "Answers to common questions about GRC Eye: pricing, security, integrations, frameworks, AI features and the auditor portal.",
      keywords: "GRC Eye FAQ, GRC platform pricing, GRC security, compliance software questions",
      ogTitle: "GRC Eye FAQ: Pricing, Security, Frameworks & Integrations | GRC Eye",
      ogDescription:
        "Answers to common questions about GRC Eye: pricing, security, integrations, frameworks, AI features and the auditor portal.",
    },
    fr: {
      title: "FAQ GRC Eye : Tarifs, Sécurité et Questions de Conformité",
      description:
        "Réponses aux questions fréquentes sur GRC Eye : tarifs, sécurité, intégrations, référentiels, fonctionnalités IA et portail auditeur.",
      keywords: "FAQ GRC Eye, tarifs plateforme GRC, sécurité GRC, questions logiciel conformité",
      ogTitle: "FAQ GRC Eye : Tarifs, Sécurité, Référentiels et Intégrations | GRC Eye",
      ogDescription:
        "Réponses aux questions fréquentes sur GRC Eye : tarifs, sécurité, intégrations, référentiels, fonctionnalités IA et portail auditeur.",
    },
    ar: {
      title: "الأسئلة الشائعة حول GRC Eye: التسعير والأمن وأسئلة الامتثال",
      description:
        "إجابات عن الأسئلة الشائعة حول GRC Eye: التسعير، الأمن، التكاملات، المعايير، ميزات الذكاء الاصطناعي وبوابة المدقق.",
      keywords: "الأسئلة الشائعة GRC Eye, تسعير منصة GRC, أمن GRC, أسئلة برنامج الامتثال",
      ogTitle: "الأسئلة الشائعة حول GRC Eye: التسعير والأمن والمعايير والتكاملات | GRC Eye",
      ogDescription:
        "إجابات عن الأسئلة الشائعة حول GRC Eye: التسعير، الأمن، التكاملات، المعايير، ميزات الذكاء الاصطناعي وبوابة المدقق.",
    },
  },
  featuresLanding: {
    en: {
      title: "GRC Platform Features | Risk, Compliance & AI Tools",
      description:
        "Explore GRC Eye modules: risk register and scenarios, multi-framework compliance, AI gap analysis, audits, policies, vendor risk, assets and vulnerabilities.",
      keywords:
        "GRC features, risk register, risk scenarios, AI compliance, gap analysis, audit management, vendor risk, TPRM, policy management, threat library",
      ogTitle: "GRC Platform Features: Risk, Compliance & AI Tools | GRC Eye",
      ogDescription:
        "Explore every GRC Eye module: risk register and scenarios, multi-framework compliance, AI gap analysis, audits, policies, vendor risk, asset cartography, vulnerabilities and more.",
    },
    fr: {
      title: "Fonctionnalités de la Plateforme GRC | Risques, Conformité et IA",
      description:
        "Découvrez les modules GRC Eye : registre et scénarios de risques, conformité multi-référentiels, analyse d'écarts par IA, audits, politiques, risque fournisseur, actifs et vulnérabilités.",
      keywords:
        "fonctionnalités GRC, registre des risques, scénarios de risques, conformité IA, analyse d'écarts, gestion d'audit, risque fournisseur, TPRM, gestion des politiques, bibliothèque de menaces",
      ogTitle: "Fonctionnalités de la Plateforme GRC : Risques, Conformité et IA | GRC Eye",
      ogDescription:
        "Découvrez tous les modules GRC Eye : registre et scénarios de risques, conformité multi-référentiels, analyse d'écarts par IA, audits, politiques, risque fournisseur, cartographie des actifs, vulnérabilités et plus.",
    },
    ar: {
      title: "ميزات منصة GRC | أدوات المخاطر والامتثال والذكاء الاصطناعي",
      description:
        "استكشف وحدات GRC Eye: سجل المخاطر وسيناريوهاتها، الامتثال متعدد المعايير، تحليل الفجوات بالذكاء الاصطناعي، التدقيق، السياسات، مخاطر الموردين، الأصول والثغرات.",
      keywords:
        "ميزات GRC, سجل المخاطر, سيناريوهات المخاطر, امتثال بالذكاء الاصطناعي, تحليل الفجوات, إدارة التدقيق, مخاطر الموردين, إدارة السياسات, مكتبة التهديدات",
      ogTitle: "ميزات منصة GRC: المخاطر والامتثال وأدوات الذكاء الاصطناعي | GRC Eye",
      ogDescription:
        "استكشف جميع وحدات GRC Eye: سجل المخاطر وسيناريوهاتها، الامتثال متعدد المعايير، تحليل الفجوات بالذكاء الاصطناعي، التدقيق، السياسات، مخاطر الموردين، خرائط الأصول والثغرات.",
    },
  },
  frameworks: {
    en: {
      title: "GRC Frameworks: 85+ Built-in, Fork Any, Build Your Own",
      description:
        "GRC Eye ships with 85+ frameworks, incl. 8 Saudi frameworks in official English and Arabic. Fork any into an editable copy, or build your own with the AI builder.",
      keywords:
        "GRC frameworks, ISO 27001, SOC 2, GDPR, DORA, NIS2, HIPAA, NCA ECC, SAMA CSF, PDPL, custom compliance framework, framework builder, compliance mapping",
      ogTitle: "GRC Frameworks: 85+ Built-in, Fork Any, Build Your Own | GRC Eye",
      ogDescription:
        "GRC Eye ships with 85+ frameworks, incl. 8 Saudi frameworks in official English and Arabic. Fork any into an editable copy, or build your own with the AI builder.",
    },
    fr: {
      title: "Référentiels GRC : Plus de 85 Intégrés, Dupliquez ou Créez le Vôtre",
      description:
        "GRC Eye intègre plus de 85 référentiels, dont 8 référentiels saoudiens dans leur texte officiel anglais et arabe. Dupliquez-en un pour l'adapter, ou créez le vôtre avec le générateur par IA.",
      keywords:
        "référentiels GRC, ISO 27001, SOC 2, RGPD, DORA, NIS2, HIPAA, NCA ECC, SAMA CSF, PDPL, référentiel de conformité personnalisé, générateur de référentiel, cartographie de conformité",
      ogTitle: "Référentiels GRC : Plus de 85 Intégrés, Dupliquez ou Créez le Vôtre | GRC Eye",
      ogDescription:
        "GRC Eye intègre plus de 85 référentiels, dont 8 référentiels saoudiens dans leur texte officiel anglais et arabe. Dupliquez-en un pour l'adapter, ou créez le vôtre avec le générateur par IA.",
    },
    ar: {
      title: "أطر GRC: أكثر من 85 إطاراً مدمجاً، انسخ أياً منها أو أنشئ إطارك الخاص",
      description:
        "توفر GRC Eye أكثر من 85 إطاراً للامتثال، منها 8 أطر سعودية بنصّها الرسمي العربي والإنجليزي. انسخ أي إطار لإنشاء نسخة قابلة للتعديل، أو أنشئ إطاراً مخصصاً باستخدام أداة البناء المدعومة بالذكاء الاصطناعي.",
      keywords:
        "معايير GRC, ISO 27001, SOC 2, GDPR, DORA, NIS2, HIPAA, NCA ECC, SAMA CSF, PDPL, الضوابط الأساسية للأمن السيبراني, معيار امتثال مخصص, أداة بناء المعايير, مطابقة الامتثال",
      ogTitle: "أطر GRC: أكثر من 85 إطاراً مدمجاً، انسخ أياً منها أو أنشئ إطارك الخاص | GRC Eye",
      ogDescription:
        "توفر GRC Eye أكثر من 85 إطاراً للامتثال، منها 8 أطر سعودية بنصّها الرسمي العربي والإنجليزي. انسخ أي إطار لإنشاء نسخة قابلة للتعديل، أو أنشئ إطاراً مخصصاً باستخدام أداة البناء المدعومة بالذكاء الاصطناعي.",
    },
  },
  howItWorks: {
    en: {
      title: "How GRC Eye Works: AI-Powered GRC Explained",
      description:
        "GRC Eye AI: vendor chat, contract review, document generation, gap analysis. Private edition with a local model or your own AI endpoint. See how each feature works.",
      keywords:
        "how GRC works, AI contract review, AI document generator, GRC AI assistant, vendor risk AI, compliance gap analysis AI",
      ogTitle: "How GRC Eye Works: AI-Powered GRC Explained | GRC Eye",
      ogDescription:
        "GRC Eye AI: vendor chat, contract review, document generation, gap analysis. Private edition with a local model or your own AI endpoint. See how each feature works.",
    },
    fr: {
      title: "Comment Fonctionne GRC Eye : L'IA au Service de la GRC",
      description:
        "IA GRC Eye : chat fournisseur, revue de contrats, génération de documents, analyse d'écarts. Édition privée avec modèle local ou votre propre IA. Découvrez le fonctionnement de chaque fonctionnalité.",
      keywords:
        "fonctionnement GRC, revue de contrats IA, générateur de documents IA, assistant IA GRC, IA risque fournisseur, analyse d'écarts de conformité IA",
      ogTitle: "Comment Fonctionne GRC Eye : L'IA au Service de la GRC | GRC Eye",
      ogDescription:
        "IA GRC Eye : chat fournisseur, revue de contrats, génération de documents, analyse d'écarts. Édition privée avec modèle local ou votre propre IA. Découvrez le fonctionnement de chaque fonctionnalité.",
    },
    ar: {
      title: "كيف تعمل GRC Eye: شرح الحوكمة والمخاطر والامتثال المدعومة بالذكاء الاصطناعي",
      description:
        "ذكاء GRC Eye الاصطناعي: محادثة الموردين، مراجعة العقود، توليد المستندات، تحليل الفجوات. إصدار خاص بنموذج محلي أو نقطة ذكاء اصطناعي خاصة بك. تعرّف على كيفية عمل كل ميزة.",
      keywords:
        "كيف يعمل GRC, مراجعة العقود بالذكاء الاصطناعي, مولّد المستندات بالذكاء الاصطناعي, مساعد GRC الذكي, ذكاء اصطناعي لمخاطر الموردين, تحليل فجوات الامتثال بالذكاء الاصطناعي",
      ogTitle: "كيف تعمل GRC Eye: شرح الحوكمة والمخاطر والامتثال المدعومة بالذكاء الاصطناعي | GRC Eye",
      ogDescription:
        "ذكاء GRC Eye الاصطناعي: محادثة الموردين، مراجعة العقود، توليد المستندات، تحليل الفجوات. إصدار خاص بنموذج محلي أو نقطة ذكاء اصطناعي خاصة بك. تعرّف على كيفية عمل كل ميزة.",
    },
  },
  news: {
    en: {
      title: "Regulatory News & Framework Updates",
      description:
        "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
      keywords:
        "EU AI Act news, NIST CSF 2.0, GDPR enforcement, NIS2 deadline, ISO 27001 update, DORA news, regulatory updates",
      ogTitle: "Regulatory News & Framework Updates | GRC Eye",
      ogDescription:
        "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
    },
    fr: {
      title: "Actualités Réglementaires et Mises à Jour des Référentiels",
      description:
        "Suivez les dernières évolutions réglementaires GRC : AI Act européen, NIST CSF 2.0, application du RGPD, échéances NIS2, mises à jour ISO 27001 et jalons DORA.",
      keywords:
        "actualités AI Act européen, NIST CSF 2.0, application RGPD, échéance NIS2, mise à jour ISO 27001, actualités DORA, mises à jour réglementaires",
      ogTitle: "Actualités Réglementaires et Mises à Jour des Référentiels | GRC Eye",
      ogDescription:
        "Suivez les dernières évolutions réglementaires GRC : AI Act européen, NIST CSF 2.0, application du RGPD, échéances NIS2, mises à jour ISO 27001 et jalons DORA.",
    },
    ar: {
      title: "الأخبار التنظيمية وتحديثات المعايير",
      description:
        "تابع أحدث التغييرات التنظيمية في مجال الحوكمة والمخاطر والامتثال: قانون الاتحاد الأوروبي للذكاء الاصطناعي، NIST CSF 2.0، تطبيق GDPR، مواعيد NIS2 النهائية، تحديثات ISO 27001 ومحطات DORA.",
      keywords:
        "أخبار قانون الذكاء الاصطناعي الأوروبي, NIST CSF 2.0, تطبيق GDPR, الموعد النهائي NIS2, تحديث ISO 27001, أخبار DORA, التحديثات التنظيمية",
      ogTitle: "الأخبار التنظيمية وتحديثات المعايير | GRC Eye",
      ogDescription:
        "تابع أحدث التغييرات التنظيمية في مجال الحوكمة والمخاطر والامتثال: قانون الاتحاد الأوروبي للذكاء الاصطناعي، NIST CSF 2.0، تطبيق GDPR، مواعيد NIS2 النهائية، تحديثات ISO 27001 ومحطات DORA.",
    },
  },
  changelog: {
    en: {
      title: "Changelog | What's New in GRC Eye",
      description:
        "The full GRC Eye release timeline: Saudi frameworks in Arabic, TPRM, asset cartography, MFA, on-premises licensing and every major feature shipped since launch.",
      keywords: "GRC Eye changelog, GRC platform updates, product release notes, what's new GRC Eye",
      ogTitle: "Changelog | What's New in GRC Eye",
      ogDescription:
        "The full GRC Eye release timeline: Saudi frameworks in Arabic, TPRM, asset cartography, MFA, on-premises licensing and every major feature shipped since launch.",
    },
    fr: {
      title: "Journal des Mises à Jour | Nouveautés GRC Eye",
      description:
        "La chronologie complète des versions GRC Eye : référentiels saoudiens en arabe, TPRM, cartographie des actifs, MFA, licences on-premise et toutes les fonctionnalités majeures livrées depuis le lancement.",
      keywords: "journal des modifications GRC Eye, mises à jour plateforme GRC, notes de version, nouveautés GRC Eye",
      ogTitle: "Journal des Mises à Jour | Nouveautés GRC Eye",
      ogDescription:
        "La chronologie complète des versions GRC Eye : référentiels saoudiens en arabe, TPRM, cartographie des actifs, MFA, licences on-premise et toutes les fonctionnalités majeures livrées depuis le lancement.",
    },
    ar: {
      title: "سجل التحديثات | ما الجديد في GRC Eye",
      description:
        "الجدول الزمني الكامل لإصدارات GRC Eye: الأطر السعودية بالعربية، إدارة مخاطر الموردين، رسم خرائط الأصول، المصادقة الثنائية، الترخيص المحلي وكل ميزة رئيسية تم إطلاقها منذ الانطلاق.",
      keywords: "سجل تحديثات GRC Eye, تحديثات منصة GRC, ملاحظات الإصدار, ما الجديد في GRC Eye",
      ogTitle: "سجل التحديثات | ما الجديد في GRC Eye",
      ogDescription:
        "الجدول الزمني الكامل لإصدارات GRC Eye: الأطر السعودية بالعربية، إدارة مخاطر الموردين، رسم خرائط الأصول، المصادقة الثنائية، الترخيص المحلي وكل ميزة رئيسية تم إطلاقها منذ الانطلاق.",
    },
  },
  solutions: {
    en: {
      title: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise",
      description:
        "GRC Eye cuts compliance costs 40%, shortens enterprise deals 3-5 weeks, and gives boards a live risk score, for SaaS, FinTech, Healthcare & Enterprise.",
      keywords:
        "GRC for SaaS, GRC for FinTech, GRC for Healthcare, compliance cost reduction, CEO GRC platform, enterprise GRC solution",
      ogTitle: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise | GRC Eye",
      ogDescription:
        "GRC Eye cuts compliance costs 40%, shortens enterprise deals 3-5 weeks, and gives boards a live risk score, for SaaS, FinTech, Healthcare & Enterprise.",
    },
    fr: {
      title: "Solutions GRC pour SaaS, FinTech, Santé et Grands Comptes",
      description:
        "GRC Eye réduit les coûts de conformité de 40 %, raccourcit les cycles de vente de 3 à 5 semaines, et donne aux conseils d'administration un score de risque en temps réel, pour SaaS, FinTech, Santé et Grands Comptes.",
      keywords:
        "GRC pour SaaS, GRC pour FinTech, GRC pour la santé, réduction des coûts de conformité, plateforme GRC pour dirigeants, solution GRC entreprise",
      ogTitle: "Solutions GRC pour SaaS, FinTech, Santé et Grands Comptes | GRC Eye",
      ogDescription:
        "GRC Eye réduit les coûts de conformité de 40 %, raccourcit les cycles de vente de 3 à 5 semaines, et donne aux conseils d'administration un score de risque en temps réel, pour SaaS, FinTech, Santé et Grands Comptes.",
    },
    ar: {
      title: "حلول GRC لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات",
      description:
        "تخفّض GRC Eye تكاليف الامتثال بنسبة 40%، وتقصّر دورات الصفقات المؤسسية بمقدار 3-5 أسابيع، وتمنح مجالس الإدارة درجة مخاطر حية، لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات.",
      keywords:
        "GRC لشركات SaaS, GRC للتقنية المالية, GRC للرعاية الصحية, خفض تكاليف الامتثال, منصة GRC للمدراء التنفيذيين, حل GRC للمؤسسات",
      ogTitle: "حلول GRC لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات | GRC Eye",
      ogDescription:
        "تخفّض GRC Eye تكاليف الامتثال بنسبة 40%، وتقصّر دورات الصفقات المؤسسية بمقدار 3-5 أسابيع، وتمنح مجالس الإدارة درجة مخاطر حية، لشركات SaaS والتقنية المالية والرعاية الصحية والمؤسسات.",
    },
  },
  pricing: {
    en: {
      title: "Pricing | Growth, Enterprise & Elite GRC Offers",
      description:
        "Compare GRC Eye offers: Growth, Enterprise and Elite. One platform, 85+ frameworks incl. 8 Saudi frameworks in official Arabic. Price on request, based on your contributors and scope.",
      keywords:
        "GRC pricing, GRC Eye pricing, GRC platform price, compliance software pricing, NCA ECC software, risk management software pricing, TPRM pricing",
      ogTitle: "Simple, transparent pricing | GRC Eye",
      ogDescription:
        "Three offers on one GRC platform: Growth, Enterprise and Elite. Price on request, based on your contributors and scope. Private edition and bring-your-own AI available as options.",
    },
    fr: {
      title: "Tarifs | Offres GRC Growth, Enterprise et Elite",
      description:
        "Comparez les offres GRC Eye : Growth, Enterprise et Elite. Une seule plateforme, plus de 85 référentiels dont 8 référentiels saoudiens en arabe officiel. Tarif sur demande, selon vos contributeurs et votre périmètre.",
      keywords:
        "tarifs GRC, tarifs GRC Eye, prix plateforme GRC, tarif logiciel de conformité, logiciel NCA ECC, prix logiciel gestion des risques, tarif TPRM",
      ogTitle: "Des tarifs simples et transparents | GRC Eye",
      ogDescription:
        "Trois offres sur une même plateforme GRC : Growth, Enterprise et Elite. Tarif sur demande, selon vos contributeurs et votre périmètre. Édition privée et IA de votre choix disponibles en option.",
    },
    ar: {
      title: "الأسعار | عروض GRC: Growth وEnterprise وElite",
      description:
        "قارن بين عروض GRC Eye: Growth وEnterprise وElite. منصة واحدة وأكثر من 85 إطارًا، منها 8 أطر سعودية بنصّها العربي الرسمي. السعر عند الطلب حسب عدد المساهمين والنطاق.",
      keywords:
        "أسعار GRC, أسعار GRC Eye, سعر منصة الحوكمة والمخاطر والامتثال, أسعار برامج الامتثال, برنامج ضوابط NCA ECC, أسعار برامج إدارة المخاطر, أسعار إدارة مخاطر الأطراف الثالثة",
      ogTitle: "أسعار بسيطة وشفافة | GRC Eye",
      ogDescription:
        "ثلاثة عروض على منصة GRC واحدة: Growth وEnterprise وElite. السعر عند الطلب حسب عدد المساهمين والنطاق. الإصدار الخاص ونموذج الذكاء الاصطناعي الخاص بك متاحان كخيارات.",
    },
  },
};
