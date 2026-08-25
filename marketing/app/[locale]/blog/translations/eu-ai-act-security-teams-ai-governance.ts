import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title: "L'AI Act européen pour les équipes sécurité : gouverner l'IA sans freiner l'innovation",
    metaTitle: "AI Act européen pour les RSSI : gouverner l'IA sans ralentir",
    metaDescription:
      "Comment les RSSI doivent structurer la gouvernance de l'IA sous l'AI Act : classification par niveau de risque, rôle de l'ISO 42001, et le modèle sur site qui satisfait les régulateurs sans bloquer l'innovation.",
    keywords:
      "conformité AI Act, gouvernance de l'IA, ISO 42001, classification des risques IA, RSSI intelligence artificielle, IA à haut risque, IA sur site",
    excerpt:
      "L'AI Act impose des obligations aux déployeurs et fournisseurs de systèmes d'IA à haut risque, et ce sont de plus en plus les équipes sécurité qui doivent les opérationnaliser. Un plan d'action RSSI pour une gouvernance de l'IA qui ne freine pas la vélocité produit.",
    body: `
## Le sujet de la gouvernance de l'IA vient d'atterrir sur votre bureau

L'AI Act européen (règlement (UE) 2024/1689) est entré en vigueur le 1er août 2024, avec une application progressive jusqu'en 2026 et 2027. La première vague d'obligations (interdiction des pratiques d'IA à risque inacceptable, transparence pour les modèles d'IA à usage général) s'applique déjà depuis février 2025. Les exigences relatives aux systèmes d'IA à haut risque entreront pleinement en vigueur à partir d'août 2026.

Si vous êtes RSSI, vous êtes désormais, de fait, le responsable de la gouvernance de l'IA dans la plupart des organisations. Non pas parce que la réglementation le dit, mais parce que :

- Vous gérez déjà des **cadres de classification des risques**.
- Vous menez déjà des **évaluations techniques** des systèmes avant leur déploiement.
- Vous disposez déjà d'une **gestion des risques fournisseurs** pour les prestataires SaaS.
- Vous produisez déjà des **éléments de preuve pour les auditeurs**.

Ce sont exactement les primitives opérationnelles que l'AI Act attend des organisations pour leurs systèmes d'IA. La gouvernance de l'IA est en grande partie une extension des pratiques existantes de sécurité et de gestion des risques, à condition de la mener de façon délibérée plutôt que par accident.

## Le modèle par niveau de risque

L'AI Act classe les systèmes d'IA en quatre niveaux, avec des obligations très différentes :

- **Risque inacceptable** : interdit purement et simplement. Exemples : notation sociale par les autorités publiques, identification biométrique en temps réel dans les espaces publics (avec des exceptions limitées), reconnaissance des émotions sur le lieu de travail et à l'école, IA manipulant le comportement par des techniques subliminales.
- **Haut risque** : obligations importantes. Exemples : IA dans les infrastructures critiques, l'éducation et la formation professionnelle, l'emploi et la gestion des travailleurs, l'application de la loi, la migration et le contrôle aux frontières, l'administration de la justice, certaines catégorisations biométriques, certains dispositifs médicaux.
- **Risque limité** : obligations de transparence. Exemples : chatbots, systèmes de reconnaissance des émotions (là où ils sont autorisés), contenus générés par IA (les deepfakes doivent être signalés comme tels).
- **Risque minimal** : aucune obligation spécifique. La majorité des usages internes de l'IA à des fins de productivité relève de cette catégorie.

La première tâche pratique pour tout RSSI est de **classifier les systèmes d'IA utilisés au sein de l'organisation**. La plupart des RSSI découvrent avec surprise que leur organisation utilise bien plus d'IA que ne le pense la direction, y compris de l'IA embarquée dans des produits SaaS qui peut désormais entrer dans le périmètre réglementaire.

## Les obligations liées au haut risque (le poste qui pèse sur le budget)

Pour les systèmes d'IA à haut risque, le règlement impose un ensemble de contrôles substantiel :

- **Système de gestion des risques** tout au long du cycle de vie de l'IA.
- **Gouvernance des données** : les données d'entraînement, de validation et de test doivent répondre à des critères de qualité.
- **Documentation technique** démontrant la conformité.
- **Tenue de registres** : journalisation automatique des événements.
- **Transparence et information des déployeurs**.
- **Supervision humaine** : mesures permettant une supervision humaine effective.
- **Exactitude, robustesse et cybersécurité** : niveau approprié à l'usage prévu.
- **Évaluation de la conformité** : contrôle interne ou évaluation par un tiers selon la catégorie d'IA.
- **Marquage CE** avant la mise sur le marché des produits.
- **Système de surveillance post-commercialisation**.

Beaucoup de ces obligations s'appuient sur des capacités déjà existantes (gestion des risques, documentation technique, journalisation, surveillance) étendues à l'IA. Les obligations réellement nouvelles sont l'évaluation de la conformité, le marquage CE (pour les fournisseurs d'IA) et les exigences de gouvernance des données spécifiques à l'IA.

## ISO 42001 : la réponse en système de management

L'ISO/IEC 42001:2023 est la norme de système de management dédiée à l'IA. Publiée fin 2023, elle est l'équivalent, pour l'IA, de l'ISO 27001 : un cadre pour gouverner de façon systématique le développement et le déploiement de l'IA, avec une certification possible auprès d'organismes accrédités.

Pour la plupart des organisations de sécurité, la question stratégique est la suivante : faut-il étendre l'ISO 27001 pour couvrir l'IA, ou adopter l'ISO 42001 comme système de management distinct ?

La réponse dépend de l'intensité d'usage de l'IA dans l'organisation :

- **L'IA est accessoire à l'activité :** étendez le SMSI ISO 27001 existant pour couvrir l'IA comme une catégorie de système d'information. Ajoutez les risques spécifiques à l'IA au registre des risques, et les clauses spécifiques à l'IA aux politiques concernées. Aucun système de management distinct n'est nécessaire.
- **L'IA est centrale au produit ou à l'activité :** mettez en place un système de management ISO 42001 en parallèle de l'ISO 27001. Les deux normes partagent la plupart de leurs éléments fondamentaux mais ont des périmètres, des contrôles et des publics distincts. La certification confère de la crédibilité auprès des régulateurs européens et, de plus en plus, auprès des clients entreprises.

## Le modèle de l'IA sur site

La décision la plus déterminante pour un RSSI en 2026 est de savoir **où l'IA traite les données**.

Les services d'IA en cloud public (OpenAI, Anthropic, Google, AWS Bedrock) sont extraordinairement performants mais posent trois problèmes :

1. **Sortie des données.** Le contenu sensible (contrats, politiques, données clients, code source) quitte votre périmètre de contrôle. Cela recoupe le RGPD (article 28 sur la sous-traitance des données), DORA (risque lié aux tiers TIC), NIS2 (sécurité de la chaîne d'approvisionnement) et les obligations de transparence de l'AI Act.
2. **Dépendance à un fournisseur et risque de concentration.** De nombreuses entités régulées suivent désormais formellement le risque de concentration sur les fournisseurs d'IA, les traitant comme des tiers TIC critiques.
3. **Auditabilité.** Lorsqu'une API externe traite vos données, la piste d'audit est partielle et reste chez le fournisseur.

L'alternative, l'exploitation de **LLM sur site ou en environnement isolé** via des cadres comme Ollama ou vLLM, a mûri rapidement. Les modèles à poids ouverts (Llama 3.x, Qwen, DeepSeek) ont comblé une grande partie de l'écart de capacités avec les modèles fermés les plus avancés pour la plupart des usages en entreprise : génération de documents, analyse d'écarts, revue de contrats, synthèse. Pour le raisonnement général le plus exigeant, les modèles fermés restent en tête, mais l'écart se réduit chaque trimestre.

Une architecture pratique en 2026 pour de nombreux RSSI en environnement régulé :

- **IA sur site** pour tout traitement touchant des données sensibles : politiques, contrats, éléments de preuve de conformité, contenu du support client, documents internes.
- **IA publique** (avec accords fournisseurs et AIPD) pour les flux non sensibles : recherche, assistance au code avec filtres appropriés, marketing.
- **Interdictions explicites** de l'IA publique pour certaines catégories de données, clairement énumérées dans la politique et appliquées via des solutions DLP.

Ce modèle est de plus en plus requis pour les entités soumises à DORA et NIS2, et il est favorable au titre de l'AI Act car il apporte nativement l'auditabilité et les obligations de supervision humaine.

## Comment opérationnaliser sans ralentir

Modes d'échec courants des RSSI face à la gouvernance de l'IA :

- **Tout bloquer jusqu'à ce qu'une politique existe.** Ralentit l'innovation, favorise le recours à l'IA fantôme (shadow AI).
- **Tout approuver parce que les métiers le demandent.** Le risque s'accumule silencieusement, avec une mauvaise surprise pour le régulateur.
- **Construire un processus lourd pour des usages à faible risque.** Gaspille des ressources sur le mauvais bout de la courbe de risque.

L'alternative pragmatique, proportionnée au niveau de risque :

- Pour les usages internes à **risque minimal** (aide à la rédaction, productivité de base) : publiez une **politique d'usage acceptable**, formez le personnel, ne mettez pas en place de contrôle bloquant.
- Pour les usages **à risque limité** orientés client (chatbots, génération de contenu) : exigez de la **transparence**, une journalisation de base et une fiche modèle (model card) documentée.
- Pour les usages **à haut risque** au sens du règlement : exigez un processus complet de gestion des risques, une documentation technique, une conception de la supervision humaine et une revue préalable au déploiement.
- Pour les usages à **risque inacceptable** : interdisez-les, journalisez-les et surveillez les tentatives clandestines.

## Ce qu'un inspecteur ou un conseil d'administration va demander

Les questions que posent aussi bien les superviseurs que les comités d'audit en 2026 :

1. Disposez-vous d'un inventaire des systèmes d'IA utilisés, classés par niveau de risque au sens de l'AI Act ?
2. Disposez-vous d'une politique de gouvernance de l'IA, approuvée par le conseil d'administration au cours des 12 derniers mois ?
3. Avez-vous évalué les fournisseurs d'IA tiers en tant que tiers TIC (DORA / NIS2) ?
4. Où les systèmes d'IA à haut risque traitent-ils des données personnelles, et comment cela est-il conforme au RGPD ?
5. Quelle est votre procédure de réponse aux incidents spécifiques à l'IA (hallucination causant un préjudice, dérive du modèle, injection de prompt) ?
6. Comment garantissez-vous la supervision humaine lorsqu'elle est requise ?
7. Quel est votre programme de formation pour le personnel utilisant l'IA ?

Si vous pouvez répondre avec assurance à ces sept questions, vous êtes en bonne position aussi bien pour les obligations relatives au haut risque d'août 2026 que pour l'orientation réglementaire plus large.

## Pour conclure

L'AI Act européen n'est pas le fardeau de conformité existentiel qu'on présente parfois. Pour l'IA à risque minimal ou limité, qui représente la grande majorité des usages organisationnels de l'IA, les obligations sont modestes et largement couvertes par les pratiques de sécurité existantes. Pour l'IA à haut risque, les obligations sont réelles mais opérationnellement gérables lorsqu'elles sont traitées comme une extension d'un SMSI existant plutôt que comme un projet de conformité séparé.

Les RSSI qui peinent sur la gouvernance de l'IA en 2026 sont ceux qui n'ont jamais commencé. Ceux qui réussissent ont posé deux gestes simples dès 2024 : un inventaire de l'IA, et une politique d'usage acceptable écrite. Tout le reste en a découlé de façon incrémentale.
`,
    faqs: [
      {
        q: "Quand l'AI Act européen s'applique-t-il ?",
        a: "Le règlement est entré en vigueur le 1er août 2024. Les interdictions sur les pratiques d'IA à risque inacceptable s'appliquent depuis le 2 février 2025. Les obligations relatives aux modèles d'IA à usage général s'appliquent depuis le 2 août 2025. La plupart des autres obligations, y compris celles concernant les systèmes d'IA à haut risque, s'appliquent à partir du 2 août 2026. Un petit ensemble d'obligations pour les systèmes à haut risque (ceux intégrés dans des produits déjà réglementés) s'applique à partir du 2 août 2027.",
      },
      {
        q: "Qu'est-ce que l'ISO 42001 ?",
        a: "L'ISO/IEC 42001:2023 est la norme internationale de système de management pour l'intelligence artificielle. Elle fournit un cadre pour gouverner de façon systématique le développement et le déploiement de l'IA, à l'image de l'ISO 27001 pour la sécurité de l'information. La certification est disponible auprès d'organismes accrédités et est de plus en plus reconnue par les régulateurs européens et les clients entreprises.",
      },
      {
        q: "L'AI Act s'applique-t-il aux entreprises situées hors de l'UE ?",
        a: "Oui, dans deux cas principaux : (1) lorsqu'un système d'IA est mis sur le marché de l'UE ou que son résultat est utilisé dans l'UE, quel que soit le lieu d'établissement du fournisseur ou du déployeur ; (2) lorsqu'un fournisseur hors UE exporte des produits d'IA vers des clients de l'UE. Le champ d'application territorial est similaire à celui du RGPD : ce qui compte, c'est l'utilisation des résultats dans l'UE, pas le lieu d'exploitation.",
      },
      {
        q: "L'IA sur site est-elle requise pour être conforme ?",
        a: "Non, mais elle est de plus en plus privilégiée pour les cas d'usage sensibles. Les services d'IA publics peuvent être utilisés en conformité avec des accords fournisseurs, des AIPD et des garanties contractuelles appropriés. Cependant, pour les entités soumises à DORA, NIS2 ou au RGPD traitant des données sensibles, l'IA sur site ou auto-hébergée simplifie considérablement le risque tiers, la sortie des données et les obligations d'auditabilité.",
      },
      {
        q: "Qui est responsable de la gouvernance de l'IA : la sécurité, le juridique ou le produit ?",
        a: "Idéalement, une structure transversale : la sécurité pilote la classification des risques et les contrôles techniques ; le juridique pilote l'interprétation réglementaire et les contrats ; le produit pilote les décisions de cas d'usage et la conception de la supervision humaine ; la protection des données pilote les AIPD et la gouvernance des données. En pratique, le RSSI devient souvent la fonction d'orchestration, car les primitives opérationnelles (cadres de risque, gestion des fournisseurs, éléments de preuve d'audit) relèvent déjà de son périmètre.",
      },
    ],
  },
  ar: {
    title: "قانون الذكاء الاصطناعي الأوروبي لفرق الأمن: حوكمة الذكاء الاصطناعي دون إبطاء الابتكار",
    metaTitle: "قانون الذكاء الاصطناعي الأوروبي لمسؤولي أمن المعلومات: حوكمة دون تباطؤ",
    metaDescription:
      "كيف ينبغي لمسؤولي أمن المعلومات هيكلة حوكمة الذكاء الاصطناعي بموجب قانون الذكاء الاصطناعي الأوروبي: تصنيف مستويات المخاطر، ودور ISO 42001، والنموذج المحلي الذي يرضي الجهات التنظيمية دون إعاقة الابتكار.",
    keywords:
      "الامتثال لقانون الذكاء الاصطناعي الأوروبي, حوكمة الذكاء الاصطناعي, ISO 42001, تصنيف مخاطر الذكاء الاصطناعي, مسؤول أمن المعلومات والذكاء الاصطناعي, الذكاء الاصطناعي عالي المخاطر, الذكاء الاصطناعي المحلي",
    excerpt:
      "يفرض قانون الذكاء الاصطناعي الأوروبي التزامات على مشغّلي ومزوّدي أنظمة الذكاء الاصطناعي عالية المخاطر، وأصبحت فرق الأمن هي الجهة التي يتعين عليها بشكل متزايد تفعيل هذه الالتزامات عمليًا. دليل عملي لمسؤولي أمن المعلومات لحوكمة الذكاء الاصطناعي دون كبح سرعة تطوير المنتج.",
    body: `
## مشكلة حوكمة الذكاء الاصطناعي وصلت للتو إلى مكتبك

دخل قانون الذكاء الاصطناعي الأوروبي (اللائحة (الاتحاد الأوروبي) 2024/1689) حيز التنفيذ في 1 أغسطس 2024، مع تطبيق تدريجي يمتد حتى عامي 2026 و2027. الموجة الأولى من الالتزامات (حظر ممارسات الذكاء الاصطناعي غير المقبولة المخاطر، والشفافية بالنسبة لنماذج الذكاء الاصطناعي ذات الغرض العام) سارية بالفعل منذ فبراير 2025. أما متطلبات أنظمة الذكاء الاصطناعي عالية المخاطر فستدخل حيز التنفيذ الكامل اعتبارًا من أغسطس 2026.

إذا كنت مسؤول أمن المعلومات (CISO)، فأنت الآن المالك الفعلي لحوكمة الذكاء الاصطناعي في معظم المؤسسات. ليس لأن التشريع ينص على ذلك، بل لأن:

- أنت بالفعل تدير **أطر تصنيف المخاطر**.
- أنت بالفعل تجري **تقييمات تقنية** للأنظمة قبل نشرها.
- لديك بالفعل **إدارة مخاطر الموردين** لمزوّدي خدمات SaaS.
- أنت بالفعل تُنتج **أدلة إثبات للمدققين**.

هذه بالضبط هي الأسس التشغيلية التي يتوقع قانون الذكاء الاصطناعي من المؤسسات تطبيقها على أنظمة الذكاء الاصطناعي. حوكمة الذكاء الاصطناعي هي في معظمها امتداد لممارسات الأمن وإدارة المخاطر القائمة، شريطة القيام بها بشكل متعمّد لا عرضي.

## نموذج مستويات المخاطر

يصنّف قانون الذكاء الاصطناعي أنظمة الذكاء الاصطناعي إلى أربعة مستويات، بالتزامات مختلفة جدًا:

- **مخاطر غير مقبولة**: محظورة تمامًا. أمثلة: التصنيف الاجتماعي من قبل السلطات العامة، التعرّف البيومتري في الوقت الفعلي في الأماكن العامة (باستثناءات ضيقة)، التعرّف على المشاعر في أماكن العمل والمدارس، الذكاء الاصطناعي الذي يتلاعب بالسلوك عبر تقنيات لا شعورية.
- **مخاطر عالية**: التزامات جوهرية. أمثلة: الذكاء الاصطناعي في البنية التحتية الحيوية، التعليم والتدريب المهني، التوظيف وإدارة العمال، إنفاذ القانون، الهجرة ومراقبة الحدود، إقامة العدل، بعض عمليات التصنيف البيومتري، بعض الأجهزة الطبية.
- **مخاطر محدودة**: التزامات الشفافية. أمثلة: روبوتات المحادثة، أنظمة التعرّف على المشاعر (حيثما يُسمح بها)، المحتوى المُولَّد بالذكاء الاصطناعي (يجب وسم عمليات التزييف العميق).
- **مخاطر ضئيلة**: لا التزامات محددة. تندرج معظم استخدامات الذكاء الاصطناعي الداخلية لأغراض الإنتاجية ضمن هذه الفئة.

المهمة العملية الأولى لأي مسؤول أمن معلومات هي **تصنيف أنظمة الذكاء الاصطناعي المستخدمة عبر المؤسسة**. يُفاجأ معظم مسؤولي أمن المعلومات باكتشاف أن مؤسستهم تستخدم من الذكاء الاصطناعي أكثر بكثير مما تدركه الإدارة العليا، بما في ذلك الذكاء الاصطناعي المدمج في منتجات SaaS التي قد تدخل الآن ضمن نطاق التنظيم.

## التزامات المخاطر العالية (الجزء الذي يستهلك الميزانية)

بالنسبة لأنظمة الذكاء الاصطناعي عالية المخاطر، يفرض القانون مجموعة ضوابط واسعة:

- **نظام إدارة المخاطر** طوال دورة حياة الذكاء الاصطناعي.
- **حوكمة البيانات**: يجب أن تستوفي بيانات التدريب والتحقق والاختبار معايير الجودة.
- **توثيق تقني** يُثبت الامتثال.
- **حفظ السجلات**: تسجيل تلقائي للأحداث.
- **الشفافية وتوفير المعلومات للمشغّلين**.
- **الإشراف البشري**: تدابير تُمكّن من إشراف بشري فعّال.
- **الدقة والمتانة والأمن السيبراني**: بمستوى مناسب للغرض المقصود.
- **تقييم المطابقة**: رقابة داخلية أو تقييم من طرف ثالث حسب فئة الذكاء الاصطناعي.
- **علامة CE** قبل طرح المنتجات في السوق.
- **نظام مراقبة ما بعد التسويق**.

يتوافق العديد من هذه الالتزامات مع قدرات قائمة بالفعل (إدارة المخاطر، التوثيق التقني، التسجيل، المراقبة) تم توسيعها لتشمل الذكاء الاصطناعي. أما الالتزامات الجديدة فعليًا فهي تقييم المطابقة، وعلامة CE (لمزوّدي الذكاء الاصطناعي)، ومتطلبات حوكمة البيانات الخاصة بالذكاء الاصطناعي.

## ISO 42001: إجابة نظام الإدارة

معيار ISO/IEC 42001:2023 هو معيار نظام الإدارة الخاص بالذكاء الاصطناعي. صدر في أواخر عام 2023، وهو المعادل لمعيار ISO 27001 بالنسبة للذكاء الاصطناعي: إطار عمل للحوكمة المنهجية لتطوير الذكاء الاصطناعي ونشره، مع إمكانية الحصول على شهادة من هيئات معتمدة.

بالنسبة لمعظم المؤسسات الأمنية، السؤال الاستراتيجي هو: هل نوسّع نطاق ISO 27001 ليشمل الذكاء الاصطناعي، أم نعتمد ISO 42001 كنظام إدارة منفصل؟

تعتمد الإجابة على مدى كثافة استخدام الذكاء الاصطناعي في المؤسسة:

- **الذكاء الاصطناعي عرضي بالنسبة للعمليات:** وسّع نظام إدارة أمن المعلومات القائم على ISO 27001 ليشمل الذكاء الاصطناعي كفئة من أنظمة المعلومات. أضِف مخاطر خاصة بالذكاء الاصطناعي إلى سجل المخاطر، وبنودًا خاصة بالذكاء الاصطناعي إلى السياسات ذات الصلة. لا حاجة لنظام إدارة منفصل.
- **الذكاء الاصطناعي محوري بالنسبة للمنتج أو العمليات:** أنشئ نظام إدارة ISO 42001 بالتوازي مع ISO 27001. يشترك المعياران في معظم العناصر الأساسية لكن لهما نطاقات وضوابط وجمهور مستهدف مختلف. تمنح الشهادة مصداقية لدى الجهات التنظيمية الأوروبية، وبشكل متزايد لدى عملاء المؤسسات.

## نموذج الذكاء الاصطناعي المحلي (On-Premise)

القرار الأكثر أهمية من الناحية التشغيلية لمسؤول أمن المعلومات في عام 2026 هو **أين تتم معالجة البيانات بواسطة الذكاء الاصطناعي**.

خدمات الذكاء الاصطناعي السحابية العامة (OpenAI، Anthropic، Google، AWS Bedrock) قوية للغاية لكنها تطرح ثلاث إشكاليات:

1. **خروج البيانات.** يغادر المحتوى الحساس (العقود، السياسات، بيانات العملاء، الشيفرة المصدرية) حدود سيطرتكم. يتقاطع هذا مع GDPR (المادة 28 المتعلقة بمعالجة البيانات)، وDORA (مخاطر أطراف تقنية المعلومات والاتصالات الثالثة)، وNIS2 (أمن سلسلة التوريد)، والتزامات الشفافية بموجب قانون الذكاء الاصطناعي.
2. **الارتباط بمزوّد واحد ومخاطر التركّز.** تتابع العديد من الكيانات الخاضعة للتنظيم الآن رسميًا مخاطر التركّز لدى مزوّدي الذكاء الاصطناعي، معاملةً إياهم كأطراف ثالثة حرجة في تقنية المعلومات والاتصالات.
3. **قابلية التدقيق.** عندما تعالج واجهة برمجية خارجية بياناتكم، يكون مسار التدقيق جزئيًا ومحفوظًا لدى المزوّد.

البديل، وهو تشغيل **نماذج لغوية كبيرة محلية أو معزولة عن الشبكة** عبر أطر مثل Ollama أو vLLM، قد نضج بسرعة. قلّصت النماذج مفتوحة الأوزان (Llama 3.x، Qwen، DeepSeek) جزءًا كبيرًا من الفجوة في القدرات مقارنة بالنماذج المغلقة الرائدة بالنسبة لمعظم استخدامات المؤسسات: توليد المستندات، تحليل الفجوات، مراجعة العقود، التلخيص. أما بالنسبة للاستدلال العام الأكثر تعقيدًا، فلا تزال النماذج المغلقة متقدمة، لكن الفجوة تتقلص كل ربع سنة.

بنية عملية لعام 2026 بالنسبة للعديد من مسؤولي أمن المعلومات الخاضعين للتنظيم:

- **ذكاء اصطناعي محلي** لأي عملية تلامس بيانات حساسة: السياسات، العقود، أدلة إثبات الامتثال، محتوى دعم العملاء، المستندات الداخلية.
- **ذكاء اصطناعي عام** (مع اتفاقيات موردين وتقييمات أثر حماية البيانات) لسير العمل غير الحساس: البحث، المساعدة البرمجية مع مرشحات مناسبة، التسويق.
- **حظر صريح** لاستخدام الذكاء الاصطناعي العام مع فئات بيانات محددة، مُدرجة بوضوح في السياسة ومطبَّقة عبر أدوات منع تسرب البيانات (DLP).

هذا النموذج مطلوب بشكل متزايد للكيانات الخاضعة لـDORA وNIS2، وهو مواتٍ بموجب قانون الذكاء الاصطناعي لأنه يوفر بطبيعته قابلية التدقيق والتزامات الإشراف البشري.

## كيفية التفعيل العملي دون تباطؤ

أنماط الفشل الشائعة لدى مسؤولي أمن المعلومات تجاه حوكمة الذكاء الاصطناعي:

- **حظر كل شيء إلى حين وجود سياسة.** يُبطئ الابتكار ويدفع نحو استخدام "الذكاء الاصطناعي الخفي" (shadow AI).
- **الموافقة على كل شيء لأن الأعمال تطلب ذلك.** تتراكم المخاطر بصمت، ثم تُفاجئ الجهة التنظيمية.
- **بناء عملية موسّعة للاستخدامات منخفضة المخاطر.** يستهلك الموارد في الطرف الخاطئ من منحنى المخاطر.

البديل العملي، المتناسب مع مستوى المخاطر:

- بالنسبة للاستخدام الداخلي **منخفض المخاطر** (المساعدة في الكتابة، الإنتاجية الأساسية): انشر **سياسة استخدام مقبول**، درّب الموظفين، ولا تفرض بوابة تحكم.
- بالنسبة للاستخدام **محدود المخاطر** الموجه للعملاء (روبوتات المحادثة، توليد المحتوى): اشترط **الشفافية**، وتسجيلًا أساسيًا، وبطاقة نموذج (model card) موثّقة.
- بالنسبة للاستخدام **عالي المخاطر** كما يحدده القانون: اشترط عملية كاملة لإدارة المخاطر، وتوثيقًا تقنيًا، وتصميمًا للإشراف البشري، ومراجعة قبل النشر.
- بالنسبة للاستخدام **غير المقبول المخاطر**: احظره، سجّله، وراقب المحاولات الخفية.

## ما الذي سيسأل عنه المفتش أو مجلس الإدارة

الأسئلة التي يطرحها كل من المشرفين ولجان التدقيق في عام 2026:

1. هل لديكم جرد لأنظمة الذكاء الاصطناعي المستخدمة، مصنّفة حسب مستوى المخاطر بموجب قانون الذكاء الاصطناعي؟
2. هل لديكم سياسة حوكمة للذكاء الاصطناعي، معتمدة من مجلس الإدارة خلال الاثني عشر شهرًا الماضية؟
3. هل قيّمتم مزوّدي الذكاء الاصطناعي من الأطراف الثالثة باعتبارهم أطرافًا ثالثة في تقنية المعلومات والاتصالات (DORA / NIS2)؟
4. أين تُعالج أنظمة الذكاء الاصطناعي عالية المخاطر البيانات الشخصية، وكيف يتوافق ذلك مع GDPR؟
5. ما هي إجراءات الاستجابة للحوادث الخاصة بالذكاء الاصطناعي (هلوسة تسبب ضررًا، انحراف النموذج، حقن الأوامر - prompt injection)؟
6. كيف تضمنون الإشراف البشري حيثما يكون مطلوبًا؟
7. ما هو برنامجكم التدريبي للموظفين الذين يستخدمون الذكاء الاصطناعي؟

إذا استطعتم الإجابة بثقة على هذه الأسئلة السبعة جميعًا، فأنتم في وضع جيد سواء بالنسبة لالتزامات المخاطر العالية في أغسطس 2026 أو للتوجه التنظيمي الأوسع.

## خلاصة القول

قانون الذكاء الاصطناعي الأوروبي ليس العبء التنظيمي الوجودي الذي يُصوَّر أحيانًا. بالنسبة للذكاء الاصطناعي منخفض ومحدود المخاطر، الذي يمثل الغالبية العظمى من استخدامات الذكاء الاصطناعي في المؤسسات، الالتزامات متواضعة ومغطاة إلى حد كبير بالممارسات الأمنية القائمة. أما بالنسبة للذكاء الاصطناعي عالي المخاطر، فالالتزامات حقيقية لكنها قابلة للتنفيذ عمليًا عند التعامل معها كامتداد لنظام إدارة أمن معلومات قائم بدلًا من مشروع امتثال منفصل.

مسؤولو أمن المعلومات الذين يواجهون صعوبات مع حوكمة الذكاء الاصطناعي في عام 2026 هم أولئك الذين لم يبدؤوا قط. أما الذين ينجحون فقد بدؤوا بخطوتين بسيطتين في عام 2024: جرد للذكاء الاصطناعي، وسياسة استخدام مقبول مكتوبة. كل ما عدا ذلك تطوّر بشكل تراكمي انطلاقًا من هاتين الخطوتين.
`,
    faqs: [
      {
        q: "متى يبدأ سريان قانون الذكاء الاصطناعي الأوروبي؟",
        a: "دخل القانون حيز التنفيذ في 1 أغسطس 2024. تسري حظور ممارسات الذكاء الاصطناعي غير المقبولة المخاطر منذ 2 فبراير 2025. تسري التزامات نماذج الذكاء الاصطناعي ذات الغرض العام منذ 2 أغسطس 2025. تسري معظم الالتزامات الأخرى، بما فيها التزامات أنظمة الذكاء الاصطناعي عالية المخاطر، اعتبارًا من 2 أغسطس 2026. وتسري مجموعة صغيرة من التزامات الأنظمة عالية المخاطر (تلك المدمجة في منتجات خاضعة للتنظيم) اعتبارًا من 2 أغسطس 2027.",
      },
      {
        q: "ما هو معيار ISO 42001؟",
        a: "معيار ISO/IEC 42001:2023 هو المعيار الدولي لنظام إدارة الذكاء الاصطناعي. يوفر إطارًا للحوكمة المنهجية لتطوير الذكاء الاصطناعي ونشره، على غرار ISO 27001 بالنسبة لأمن المعلومات. الشهادة متاحة عبر هيئات معتمدة، ويتزايد الاعتراف بها من قبل الجهات التنظيمية الأوروبية وعملاء المؤسسات.",
      },
      {
        q: "هل ينطبق قانون الذكاء الاصطناعي على الشركات خارج الاتحاد الأوروبي؟",
        a: "نعم، في حالتين رئيسيتين: (1) عندما يُطرح نظام ذكاء اصطناعي في سوق الاتحاد الأوروبي أو يُستخدم ناتجه داخل الاتحاد الأوروبي، بغض النظر عن مكان تأسيس المزوّد أو المشغّل؛ (2) عندما يُصدّر مزوّد من خارج الاتحاد الأوروبي منتجات ذكاء اصطناعي إلى عملاء داخل الاتحاد الأوروبي. النطاق الإقليمي مشابه لنطاق GDPR: ما يهم هو استخدام النتائج داخل الاتحاد الأوروبي، وليس مكان ممارسة النشاط.",
      },
      {
        q: "هل الذكاء الاصطناعي المحلي مطلوب للامتثال؟",
        a: "لا، لكنه أصبح مفضّلًا بشكل متزايد في حالات الاستخدام الحساسة. يمكن استخدام خدمات الذكاء الاصطناعي العامة بشكل متوافق مع اتفاقيات موردين مناسبة، وتقييمات أثر حماية البيانات، وضمانات تعاقدية. ومع ذلك، بالنسبة للكيانات الخاضعة لـDORA أو NIS2 أو GDPR التي تعالج بيانات حساسة، يُبسّط الذكاء الاصطناعي المحلي أو ذاتي الاستضافة بشكل كبير مخاطر الأطراف الثالثة، وخروج البيانات، والتزامات قابلية التدقيق.",
      },
      {
        q: "من المسؤول عن حوكمة الذكاء الاصطناعي: الأمن أم القانوني أم المنتج؟",
        a: "الأمثل هو هيكل متعدد الوظائف: يقود فريق الأمن تصنيف المخاطر والضوابط التقنية؛ ويقود الفريق القانوني التفسير التنظيمي والعقود؛ ويقود فريق المنتج قرارات حالات الاستخدام وتصميم الإشراف البشري؛ ويقود فريق خصوصية البيانات تقييمات أثر حماية البيانات وحوكمة البيانات. عمليًا، غالبًا ما يصبح مسؤول أمن المعلومات هو الجهة المنسّقة لأن الأسس التشغيلية (أطر المخاطر، إدارة الموردين، أدلة إثبات التدقيق) تقع ضمن نطاقه أصلًا.",
      },
    ],
  },
};

export default translations;
