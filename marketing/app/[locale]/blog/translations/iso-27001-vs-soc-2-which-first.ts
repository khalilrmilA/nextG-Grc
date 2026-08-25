import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title:
      "ISO 27001 ou SOC 2 : quel référentiel votre entreprise doit-elle viser en premier ?",
    metaTitle: "ISO 27001 vs SOC 2 : lequel viser en premier ?",
    metaDescription:
      "ISO 27001 et SOC 2 couvrent des exigences proches mais s'adressent à des publics différents. La grille de décision d'un RSSI : géographie des clients, taille des deals, coûts et délais.",
    keywords:
      "ISO 27001 ou SOC 2, SOC 2 ou ISO 27001 en premier, coût ISO 27001 vs SOC 2, correspondance SOC 2 ISO 27001, comparatif certifications sécurité, certification sécurité SaaS",
    excerpt:
      "Les deux certifications de sécurité les plus connues couvrent des contrôles qui se chevauchent mais répondent à des enjeux commerciaux différents. Une grille de décision concrète pour les RSSI qui doivent choisir où investir leur premier budget conformité.",
    body: `
## La question que tout fondateur et tout RSSI se posent au même moment

Entre l'embauche du troisième commercial et la signature du premier contrat entreprise à plus d'1 M€, tout fondateur de SaaS B2B reçoit le même questionnaire de sécurité de la part de l'équipe achats d'un prospect. On y demande une certification ISO 27001, un rapport SOC 2 Type II, ou les deux. Le RSSI se retrouve alors face à la question : lequel viser, dans quel ordre, et pour quel coût ?

Cet article répond à cette question avec le raisonnement qu'un RSSI peut présenter en conseil d'administration, pas seulement un tableau comparatif de fonctionnalités.

## Ce que chaque référentiel recouvre réellement

**ISO 27001:2022** est une norme internationale de système de management publiée par l'Organisation internationale de normalisation. Elle certifie que votre organisation a mis en place et maintient un Système de Management de la Sécurité de l'Information (SMSI) couvrant un périmètre défini. L'Annexe A liste 93 mesures organisées en quatre thèmes : organisationnel, humain, physique et technologique. Le certificat est valable trois ans, avec des audits de surveillance annuels.

**SOC 2** est un rapport d'attestation basé sur les Trust Services Criteria publiés par l'AICPA (American Institute of Certified Public Accountants). Il évalue les contrôles pertinents pour un ou plusieurs des cinq critères suivants : Sécurité (obligatoire), Disponibilité, Confidentialité, Intégrité du traitement et Confidentialité des données personnelles (Privacy). Il existe deux types de rapports : Type I (contrôles en place à un instant T) et Type II (contrôles opérant efficacement sur une période, généralement 6 à 12 mois).

Les deux référentiels posent au fond des questions similaires : avez-vous des politiques, protégez-vous les données, savez-vous répondre aux incidents, gérez-vous vos fournisseurs. Ce qui les distingue, c'est **ce qu'ils produisent** et **qui leur fait confiance**.

## La différence la plus importante

Ce n'est pas le contenu des contrôles. C'est le livrable.

- ISO 27001 produit un **certificat** : un document d'une page délivré par un organisme de certification accrédité, confirmant que vous maintenez un SMSI. Il ne détaille ni les contrôles spécifiques ni les résultats de tests. Il reste valide jusqu'à la prochaine surveillance.
- SOC 2 produit un **rapport** : généralement 50 à 100 pages, rédigé par un cabinet d'expertise comptable (CPA), listant chaque contrôle testé, la procédure de test et l'opinion de l'auditeur. C'est un document détaillé, probant et confidentiel.

Cela façonne les préférences des acheteurs. Une équipe achats européenne qui souhaite simplement vérifier que vous exploitez un système de management de la sécurité acceptera le certificat ISO. Une équipe achats basée aux États-Unis, en particulier dans les services financiers ou la santé, voudra lire précisément quels contrôles ont été testés et si des exceptions ont été relevées. D'où le clivage géographique.

## La géographie compte plus qu'on ne le pense

Si 80 % de votre chiffre d'affaires provient d'acheteurs européens ou asiatiques, optez pour **ISO 27001 en premier**. Le certificat est reconnu à l'international, son format est familier, et l'accréditation de l'organisme certificateur compte plus que le contenu détaillé.

Si 80 % de votre chiffre d'affaires provient d'acheteurs basés aux États-Unis (notamment dans le logiciel d'entreprise, les services financiers, la santé et l'éducation), optez pour **SOC 2 en premier**. Les processus d'achat américains sont construits autour des rapports SOC 2. De nombreux questionnaires de sécurité demandent explicitement « votre dernier rapport SOC 2 Type II », sans solution de repli.

Si votre mix de revenus est de 50/50 ou si vous ciblez les deux régions à parts égales, l'arbitrage se déplace vers le coût et les délais.

## Comparatif de coûts et de délais

Les montants varient selon la taille de l'entreprise et le cabinet d'audit, mais pour une entreprise SaaS en Série A (50 à 150 salariés), les fourchettes habituelles sont les suivantes :

| Élément | ISO 27001 | SOC 2 Type II |
|------|-----------|----------------|
| Préparation initiale | 4 à 6 mois | 3 à 5 mois |
| Première fenêtre d'audit | 1 à 2 semaines (Étape 1+2) | Période d'observation de 6 à 12 mois |
| Honoraires du cabinet d'audit | 15 000 € à 35 000 € | 25 000 € à 60 000 € |
| Effort interne | ~0,5 ETP pendant 6 mois | ~0,5 ETP pendant 9 mois |
| Maintenance annuelle | Audit de surveillance (~8 000 €) | Réémission annuelle du Type II (20 000 € à 45 000 €) |
| Certificat/rapport disponible | ~6 mois après le démarrage | ~12 mois après le démarrage |

ISO 27001 permet d'obtenir **plus rapidement un premier livrable**, mais s'avère plus coûteux sur un horizon de 3 ans si la surveillance est correctement assurée. SOC 2 a un premier cycle plus long (le Type II exige des preuves collectées sur une période), mais le coût marginal du rapport de la deuxième année devient incrémental.

## Le chevauchement des contrôles est considérable

C'est ce qui surprend le plus les RSSI qui découvrent le sujet. Environ **75 à 80 % des contrôles se recoupent**. Si vous commencez par ISO 27001 puis ajoutez SOC 2, vous fournissez pour l'essentiel les mêmes preuves déjà existantes, sous un format différent. Si vous commencez par SOC 2 puis ajoutez ISO 27001, il faut ajouter une méthodologie de gestion des risques explicite, une Déclaration d'applicabilité (Statement of Applicability) et un périmètre de SMSI documenté, mais la majorité des preuves opérationnelles existe déjà.

C'est la raison pour laquelle les équipes sécurité matures finissent presque toujours par obtenir **les deux**. Le coût cumulé de l'exploitation de deux référentiels est nettement inférieur au coût de l'exploitation de l'un ou l'autre isolément.

## Un arbre de décision défendable

Voici la grille que je présente aux conseils d'administration :

1. **Où se situe votre chiffre d'affaires ?** Si plus de 70 % provient d'une seule région, le référentiel préféré de cette région l'emporte.
2. **Quelle est la taille du pipeline des 12 prochains mois ?** Si un seul contrat exigeant ISO ou SOC 2 représente plus de 10 % du prévisionnel, suivez ce contrat.
3. **Devez-vous commencer à vendre dès demain ?** Si oui, les deux référentiels offrent un livrable intermédiaire : ISO 27001 propose une attestation de préparation à l'issue de l'Étape 1 ; SOC 2 propose le Type I (à un instant T). L'un ou l'autre peut débloquer la première vague de contrats pendant que vous finalisez la certification complète.
4. **Disposez-vous des ressources d'ingénierie pour la période d'observation plus longue de SOC 2 ?** Si l'équipe d'ingénierie est mobilisée à 100 % sur le produit, SOC 2 nécessitera soit de la flexibilité de planning, soit une aide externe.

Si la réponse est « nous ne savons pas encore, nous sommes à 50/50 au niveau mondial », optez par défaut pour **ISO 27001 en premier**. C'est plus rapide, reconnu à l'international, et l'effort SOC 2 qui suivra bénéficiera considérablement de la présence déjà en place d'un SMSI.

## Comment tirer le meilleur parti de votre plateforme

Quel que soit le référentiel visé, l'outillage opérationnel fait la différence. Une [plateforme GRC moderne](/solutions) vous permet de :

- Faire avancer les deux référentiels **en parallèle** sur des preuves partagées : téléverser un schéma réseau une seule fois et le faire compter à la fois pour le A.5.7 d'ISO 27001 et le CC6.6 de SOC 2.
- Réaliser des **analyses d'écarts (gap assessments)** avant l'arrivée de l'auditeur, pour que l'audit formel soit une confirmation plutôt qu'une découverte.
- Maintenir des **preuves de gestion des risques fournisseurs** qui satisfont les contrôles de chaîne d'approvisionnement des deux référentiels.

La plateforme s'autofinance dès la deuxième année, lorsque les cycles de surveillance et de réémission du Type II commencent à se cumuler.

## Et pour ISO 27001 + SOC 2 + un autre référentiel

Les RSSI demandent alors fréquemment : faut-il ajouter HIPAA, PCI DSS, NIS2, GDPR, FedRAMP ? La réponse dépend de vos acheteurs et du profil de votre propre produit. Mais les contrôles fondamentaux restent identiques : un SMSI documenté associé à des preuves opérationnelles couvre l'essentiel du terrain pour tout référentiel ultérieur. ISO 27001 est la langue commune du GRC. SOC 2 est le livrable que réclament les acheteurs entreprise américains. La plupart des entreprises ont besoin des deux dans les 18 mois suivant le début de leurs ventes aux grands comptes.

## La conclusion honnête

Choisissez le référentiel dont les acheteurs vous paieront le trimestre prochain. Obtenez le premier livrable le plus vite possible. Ajoutez ensuite le second référentiel comme une extension partielle du premier. L'erreur consiste à traiter les deux comme des programmes séparés et parallèles. Ils partagent 75 % du même socle de contrôles, audités par des personnes différentes pour des publics différents.
`,
    faqs: [
      {
        q: "SOC 2 est-il meilleur qu'ISO 27001 ?",
        a: "Aucun n'est « meilleur » que l'autre. Ils répondent à des attentes d'acheteurs différentes. SOC 2 produit un rapport probant et détaillé, privilégié par les acheteurs entreprise américains. ISO 27001 produit un certificat reconnu à l'international, privilégié en Europe et en Asie. La plupart des entreprises matures finissent par obtenir les deux.",
      },
      {
        q: "Puis-je viser SOC 2 et ISO 27001 en même temps ?",
        a: "Oui, et c'est souvent l'approche la plus efficace. Environ 75 à 80 % des contrôles se recoupent. Un seul effort de collecte de preuves peut satisfaire les deux référentiels, avec une documentation spécifique à chacun (Déclaration d'applicabilité pour ISO ; description du système pour SOC 2). Les plateformes GRC modernes permettent de mener les deux évaluations en parallèle.",
      },
      {
        q: "Combien de temps faut-il pour obtenir une première certification ?",
        a: "ISO 27001 prend généralement 4 à 6 mois entre le démarrage et l'obtention du certificat. SOC 2 Type II prend plus de temps en raison de la période d'observation requise (généralement 6 à 12 mois). Le délai total est de 9 à 14 mois. SOC 2 Type I (à un instant T) peut être délivré plus rapidement, en 4 à 6 mois.",
      },
      {
        q: "Combien coûte ISO 27001 par rapport à SOC 2 ?",
        a: "Pour une entreprise SaaS en Série A (50 à 150 salariés), ISO 27001 coûte généralement entre 20 000 € et 50 000 € au total la première année (honoraires d'audit et outillage), plus un effort interne d'environ 0,5 ETP pendant 6 mois. SOC 2 Type II coûte généralement entre 30 000 € et 80 000 € la première année, plus environ 0,5 ETP pendant 9 mois. SOC 2 implique une maintenance annuelle plus élevée (environ 20 000 € à 45 000 € contre environ 8 000 € pour la surveillance ISO).",
      },
      {
        q: "Ai-je besoin à la fois d'ISO 27001 et de SOC 2 ?",
        a: "La plupart des entreprises SaaS B2B qui vendent à l'international finissent par obtenir les deux dans les 18 mois suivant le début de leurs ventes aux grands comptes. Commencez par celui que vos acheteurs les plus pressants exigent. Ajoutez le second une fois le premier opérationnel et lorsque le chiffre d'affaires le justifie.",
      },
    ],
  },
  ar: {
    title: "ISO 27001 مقابل SOC 2: أي إطار عمل يجب أن تسعى شركتك لتحقيقه أولاً؟",
    metaTitle: "ISO 27001 مقابل SOC 2: أيهما تختار أولاً؟",
    metaDescription:
      "يغطي ISO 27001 و SOC 2 مجالات متشابهة لكنهما يخدمان جمهورين مختلفين. إطار قرار لمسؤول أمن المعلومات: حسب جغرافيا العملاء، حجم الصفقات، التكلفة والمدة.",
    keywords:
      "ISO 27001 مقابل SOC 2, أيهما أولاً SOC 2 أم ISO 27001, تكلفة ISO 27001 مقابل SOC 2, مطابقة SOC 2 مع ISO 27001, مقارنة شهادات الأمن السيبراني, شهادة أمن المعلومات للشركات الناشئة",
    excerpt:
      "أشهر شهادتَي أمن معلومات تتقاطعان في الضوابط لكنهما تحلّان مشكلتين تجاريتين مختلفتين. إطار قرار عملي لمسؤولي أمن المعلومات الذين يختارون أين يستثمرون أول ميزانية للامتثال.",
    body: `
## السؤال الذي يطرحه كل مؤسس ومسؤول أمن معلومات في اللحظة نفسها

في مكان ما بين توظيف مندوب المبيعات الثالث وإغلاق أول صفقة مؤسسية تتجاوز مليون يورو، يتلقى كل مؤسس شركة SaaS B2B الاستبيان الأمني ذاته من فريق المشتريات لدى عميل محتمل. يطلب هذا الاستبيان شهادة ISO 27001، أو تقرير SOC 2 Type II، أو كليهما. عندها يُطرح على مسؤول أمن المعلومات السؤال: أيهما نسعى إليه، بأي ترتيب، وبأي تكلفة؟

تجيب هذه المقالة عن هذا السؤال بالمنطق الذي يمكن لمسؤول أمن المعلومات تقديمه في اجتماع مجلس الإدارة، وليس مجرد مقارنة سطحية للميزات.

## ما هو كل إطار عمل فعليًا

**ISO 27001:2022** هو معيار دولي لأنظمة الإدارة صادر عن المنظمة الدولية للتوحيد القياسي (ISO). يشهد على أن مؤسستك قد نفّذت وتحافظ على نظام إدارة أمن المعلومات (ISMS) يغطي نطاقًا محددًا. يسرد الملحق A (Annex A) 93 ضابطًا موزعة على أربعة محاور: تنظيمية، بشرية، مادية، وتقنية. الشهادة صالحة لثلاث سنوات مع مراجعات مراقبة سنوية.

**SOC 2** هو تقرير تصديق يستند إلى معايير خدمات الثقة (Trust Services Criteria) الصادرة عن AICPA (المعهد الأمريكي للمحاسبين القانونيين المعتمدين). يقيّم الضوابط ذات الصلة بواحد أو أكثر من خمسة معايير: الأمن (إلزامي)، التوافر، السرية، سلامة المعالجة، والخصوصية. يوجد نوعان من التقارير: Type I (الضوابط القائمة في لحظة زمنية معينة) و Type II (الضوابط العاملة بفعالية على مدى فترة زمنية، عادة 6 إلى 12 شهرًا).

يطرح الإطاران في النهاية أسئلة متشابهة: هل لديك سياسات، هل تحمي البيانات، هل تستجيب للحوادث، هل تدير مورّديك. الفرق الحقيقي يكمن في **ما ينتجانه** و**من يثق بهما**.

## الفرق الأهم على الإطلاق

الأمر لا يتعلق بالضوابط نفسها، بل بما يُسلَّم في النهاية.

- ينتج ISO 27001 **شهادة**: وثيقة من صفحة واحدة تصدرها جهة اعتماد معتمدة تؤكد أنك تحافظ على نظام إدارة أمن معلومات. لا تسرد ضوابط محددة أو نتائج اختبارات. تبقى سارية حتى المراجعة القادمة.
- ينتج SOC 2 **تقريرًا**: عادة ما بين 50 و100 صفحة، يعده مكتب محاسبة قانونية، ويسرد كل ضابط تم اختباره، وإجراء الاختبار، ورأي المدقق. إنه تقرير تفصيلي وإثباتي وسري.

هذا ما يحدد تفضيلات المشترين. فريق مشتريات أوروبي يريد فقط التأكد من أنك تطبّق نظام إدارة أمن معلومات سيقبل بشهادة ISO. أما فريق مشتريات أمريكي، خاصة في قطاعي الخدمات المالية والرعاية الصحية، فيريد أن يقرأ بالتحديد أي الضوابط تم اختبارها وما إذا كانت هناك استثناءات. من هنا ينشأ الانقسام الجغرافي.

## الجغرافيا أهم مما تتصور

إذا كان 80% من إيراداتك يأتي من مشترين أوروبيين أو آسيويين، فاختر **ISO 27001 أولاً**. الشهادة معترف بها دوليًا، والصيغة مألوفة، واعتماد جهة التدقيق يهم أكثر من التفاصيل الداخلية.

إذا كان 80% من إيراداتك يأتي من مشترين في الولايات المتحدة (خصوصًا في برمجيات المؤسسات، والخدمات المالية، والرعاية الصحية، والتعليم)، فاختر **SOC 2 أولاً**. عمليات الشراء الأمريكية مبنية حول تقارير SOC 2. تطلب كثير من الاستبيانات الأمنية صراحة "أحدث تقرير SOC 2 Type II لديكم" دون بديل.

إذا كان توزيع إيراداتك 50/50 أو كنت تستهدف المنطقتين بالتساوي، ينتقل الحساب إلى التكلفة والتوقيت.

## مقارنة التكلفة والمدة الزمنية

تختلف الأرقام حسب حجم الشركة ومكتب التدقيق، لكن بالنسبة لشركة SaaS في مرحلة الجولة الاستثمارية A (Series A) بعدد موظفين بين 50 و150، فإن النطاقات المعتادة هي:

| البند | ISO 27001 | SOC 2 Type II |
|------|-----------|----------------|
| التحضير الأولي | 4 إلى 6 أشهر | 3 إلى 5 أشهر |
| نافذة التدقيق الأولى | 1 إلى 2 أسبوع (المرحلة 1+2) | فترة مراقبة من 6 إلى 12 شهرًا |
| أتعاب مكتب التدقيق | 15,000 إلى 35,000 يورو | 25,000 إلى 60,000 يورو |
| الجهد الداخلي | ~0.5 موظف بدوام كامل لمدة 6 أشهر | ~0.5 موظف بدوام كامل لمدة 9 أشهر |
| الصيانة السنوية | مراجعة مراقبة (~8,000 يورو) | إعادة إصدار Type II سنويًا (20,000 إلى 45,000 يورو) |
| جاهزية الشهادة/التقرير | ~6 أشهر من البداية | ~12 شهرًا من البداية |

يتميز ISO 27001 بأنه **أسرع في تحقيق أول تسليم**، لكنه أعلى تكلفة على مدى أفق ثلاث سنوات إذا التزمت بالمراقبة السنوية بشكل صحيح. أما SOC 2 فدورته الأولى أطول (لأن Type II يتطلب أدلة مجمّعة على مدى فترة زمنية)، لكن التكلفة الإضافية لتقرير السنة الثانية تصبح تدريجية.

## التداخل بين الضوابط هائل

هذا هو الجزء الذي يفاجئ مسؤولي أمن المعلومات لأول مرة. يتداخل حوالي **75 إلى 80% من الضوابط**. إذا بدأت بـ ISO 27001 ثم أضفت SOC 2، فأنت في الغالب تقدّم الأدلة نفسها الموجودة مسبقًا بصيغة مختلفة. وإذا بدأت بـ SOC 2 ثم أضفت ISO 27001، فستحتاج إلى إضافة منهجية صريحة لإدارة المخاطر، وبيان الانطباق (Statement of Applicability)، ونطاق موثق لنظام إدارة أمن المعلومات، لكن معظم الأدلة التشغيلية تكون موجودة أصلاً.

لهذا السبب تنتهي فرق الأمن الناضجة دائمًا تقريبًا بالحصول على **كلا الإطارين**. التكلفة التراكمية لتشغيل إطارين أقل بكثير من تكلفة تشغيل أي منهما بمعزل عن الآخر.

## شجرة قرار قابلة للدفاع عنها

إليك الإطار الذي أعرضه على مجالس الإدارة:

1. **أين تتركز إيراداتك؟** إذا كان أكثر من 70% منها في منطقة واحدة، فالإطار المفضل لدى تلك المنطقة يفوز.
2. **ما حجم خط المبيعات المتوقع خلال الأشهر الـ12 القادمة؟** إذا كانت صفقة واحدة تتطلب ISO أو SOC 2 تمثل أكثر من 10% من التوقعات، اتبع تلك الصفقة.
3. **هل تحتاج إلى البدء بالبيع غدًا؟** إذا كانت الإجابة نعم، فكلا الإطارين يوفران تسليمًا مؤقتًا: يوفر ISO 27001 بيان جاهزية بعد المرحلة 1، ويوفر SOC 2 تقرير Type I (في لحظة زمنية معينة). يمكن لأي منهما فتح الطريق أمام أول موجة من العقود بينما تُكمل الشهادة الكاملة.
4. **هل لديك طاقة هندسية كافية لفترة المراقبة الأطول في SOC 2؟** إذا كان فريق الهندسة محملاً بالكامل على المنتج، فسيتطلب SOC 2 إما مرونة في الجدول الزمني أو مساعدة خارجية.

إذا كانت الإجابة "لا نعرف بعد، توزيعنا 50/50 عالميًا"، فاختر افتراضيًا **ISO 27001 أولاً**. فهو أسرع، ومعترف به دوليًا، ويستفيد جهد SOC 2 اللاحق بشكل كبير من وجود نظام إدارة أمن المعلومات جاهزًا مسبقًا.

## كيف تحقق أقصى استفادة من منصتك

مهما كان الإطار الذي تسعى إليه، فإن الأدوات التشغيلية تُحدث فرقًا كبيرًا. تتيح لك [منصة GRC حديثة](/solutions):

- تشغيل كلا الإطارين **بالتوازي** على أدلة مشتركة: رفع مخطط شبكة واحد واعتماده لكل من الضابط A.5.7 في ISO 27001 والضابط CC6.6 في SOC 2.
- إجراء **تقييمات الفجوات** قبل وصول المدقق، بحيث يصبح التدقيق الرسمي عملية تأكيد وليس اكتشافًا.
- الحفاظ على **أدلة إدارة مخاطر المورّدين** التي تلبي ضوابط سلسلة التوريد في كلا الإطارين.

تسدّد المنصة تكلفتها ذاتيًا في السنة الثانية، عندما تبدأ دورات المراقبة وإعادة إصدار Type II بالتراكم.

## ماذا عن ISO 27001 + SOC 2 + إطار آخر

كثيرًا ما يسأل مسؤولو أمن المعلومات بعد ذلك: هل نضيف HIPAA أو PCI DSS أو NIS2 أو GDPR أو FedRAMP؟ تعتمد الإجابة على مشتريك وعلى طبيعة منتجك. لكن الضوابط الأساسية تبقى واحدة: نظام إدارة أمن معلومات موثّق مع أدلة تشغيلية يغطي معظم المتطلبات لأي إطار لاحق. ISO 27001 هو اللغة المشتركة لعالم الحوكمة والمخاطر والامتثال (GRC). أما SOC 2 فهو التسليم الذي يطلبه مشترو المؤسسات الأمريكية. تحتاج معظم الشركات إلى كليهما خلال 18 شهرًا من بدء البيع للمؤسسات الكبرى.

## الخلاصة الصادقة

اختر الإطار الذي سيدفع لك مشتروه في الربع القادم. اسعَ للوصول إلى أول تسليم بأسرع ما يمكن. ثم أضف الإطار الثاني كامتداد جزئي للأول. الخطأ هو التعامل مع الإطارين كبرنامجين منفصلين ومتوازيين. فهما يتشاركان 75% من مجموعة الضوابط ذاتها، يدققهما أشخاص مختلفون لجمهور مختلف.
`,
    faqs: [
      {
        q: "هل SOC 2 أفضل من ISO 27001؟",
        a: "لا أحد منهما \"أفضل\" من الآخر. فهما يلبيان توقعات مختلفة لدى المشترين. ينتج SOC 2 تقريرًا إثباتيًا مفصلاً يفضّله المشترون المؤسسيون الأمريكيون. أما ISO 27001 فينتج شهادة معترفًا بها دوليًا يفضّلها المشترون في أوروبا وآسيا. تنتهي معظم الشركات الناضجة بالحصول على كليهما.",
      },
      {
        q: "هل يمكنني السعي للحصول على SOC 2 و ISO 27001 في الوقت نفسه؟",
        a: "نعم، وغالبًا ما تكون هذه هي الطريقة الأكثر كفاءة. يتداخل حوالي 75 إلى 80% من الضوابط. يمكن لجهد واحد لجمع الأدلة أن يلبي متطلبات الإطارين مع توثيق خاص بكل إطار (بيان الانطباق لـ ISO؛ ووصف النظام لـ SOC 2). تدعم منصات GRC الحديثة تشغيل التقييمين بالتوازي.",
      },
      {
        q: "كم من الوقت يستغرق الحصول على الشهادة لأول مرة؟",
        a: "يستغرق ISO 27001 عادة من 4 إلى 6 أشهر من البداية وحتى الحصول على الشهادة. يستغرق SOC 2 Type II وقتًا أطول بسبب فترة المراقبة المطلوبة (عادة من 6 إلى 12 شهرًا). إجمالي الوقت المستغرق يتراوح بين 9 و14 شهرًا. يمكن إصدار SOC 2 Type I (في لحظة زمنية معينة) بشكل أسرع، خلال 4 إلى 6 أشهر.",
      },
      {
        q: "كم تكلف ISO 27001 مقارنة بـ SOC 2؟",
        a: "بالنسبة لشركة SaaS في مرحلة الجولة الاستثمارية A بعدد موظفين بين 50 و150، تبلغ تكلفة ISO 27001 عادة ما بين 20,000 و50,000 يورو إجمالاً في السنة الأولى (أتعاب التدقيق والأدوات)، بالإضافة إلى جهد داخلي يعادل حوالي 0.5 موظف بدوام كامل لمدة 6 أشهر. تبلغ تكلفة SOC 2 Type II عادة ما بين 30,000 و80,000 يورو في السنة الأولى، بالإضافة إلى حوالي 0.5 موظف بدوام كامل لمدة 9 أشهر. تتطلب SOC 2 صيانة سنوية أعلى (حوالي 20,000 إلى 45,000 يورو مقابل حوالي 8,000 يورو لمراقبة ISO).",
      },
      {
        q: "هل أحتاج إلى كل من ISO 27001 و SOC 2؟",
        a: "تنتهي معظم شركات SaaS B2B التي تبيع دوليًا بالحصول على كليهما خلال 18 شهرًا من بدء المبيعات المؤسسية. ابدأ بالإطار الذي يطلبه أكثر مشتريك إلحاحًا. أضف الإطار الثاني بمجرد أن يصبح الأول تشغيليًا وتبرر الإيرادات ذلك.",
      },
    ],
  },
};

export default translations;
