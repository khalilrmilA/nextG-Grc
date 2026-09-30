import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title: "Automatisation de la gestion des risques fournisseurs : revue de contrats par IA et TPRM en temps réel",
    metaTitle: "Automatisation TPRM & revue de contrats par IA | GRC Eye",
    metaDescription: "60 % des incidents proviennent de tiers. L'analyse de contrats par IA, le suivi TPRM continu et la cartographie à 6 dimensions réduisent l'exposition au risque fournisseur jusqu'à 70 %.",
    keywords: "automatisation gestion des risques fournisseurs, automatisation TPRM, revue de contrats par IA, risque tiers, plateforme de gestion des risques fournisseurs, risque chaîne d'approvisionnement, TPRM automatisé",
    excerpt: "60 % des incidents de sécurité impliquent un tiers, pourtant la plupart des programmes TPRM reposent encore sur des questionnaires annuels. Découvrez comment l'automatisation de la gestion des risques fournisseurs, combinant analyse de contrats par IA, suivi continu et cartographie à 6 dimensions, réduit l'exposition au risque tiers jusqu'à 70 %.",
    body: `
## Vos fournisseurs sont votre plus grand risque non maîtrisé

En 2026, la majorité des incidents de sécurité significatifs ne prennent pas naissance au sein de l'organisation qui en subit le plus grand dommage. Ils démarrent dans la chaîne d'approvisionnement : un éditeur logiciel avec des contrôles d'accès insuffisants, un fournisseur SaaS avec une API mal configurée, un service cloud présentant une vulnérabilité que votre équipe sécurité ignorait totalement, car le questionnaire du fournisseur indiquait que « tous les contrôles sont en place ».

Les chiffres sont sans équivoque. Selon le rapport Verizon Data Breach Investigations Report 2025, **l'implication d'un tiers a été identifiée dans 62 % des violations de données**, contre 15 % cinq ans plus tôt. Le passage au cloud, la prolifération des outils SaaS et la spécialisation croissante des fonctions métier ont créé une surface d'attaque liée à la chaîne d'approvisionnement que la plupart des organisations sont largement sous-équipées pour gérer.

Le programme TPRM (Third Party Risk Management, gestion des risques liés aux tiers) typique d'une entreprise de taille moyenne ressemble à ceci : une feuille de calcul recensant 150 fournisseurs, un questionnaire de sécurité annuel envoyé aux 30 fournisseurs « critiques », et un niveau de risque attribué en fonction de la manière dont le fournisseur a répondu aux questions. C'est mieux que rien. Ce n'est guère mieux que rien.

## Pourquoi les questionnaires fournisseurs annuels échouent

Le questionnaire annuel présente quatre problèmes structurels qu'aucune amélioration de processus ne peut corriger :

**C'est une photographie à un instant T.** La posture de sécurité d'un fournisseur peut évoluer radicalement entre deux cycles de questionnaire : une violation de données, un changement de configuration cloud, une acquisition, le départ d'une personne clé. Le questionnaire ne capture rien de tout cela.

**Il repose entièrement sur l'auto-déclaration du fournisseur.** Les fournisseurs ont tout intérêt à répondre aux questionnaires de manière optimiste. Sans vérification indépendante, il est impossible de distinguer un fournisseur doté d'une excellente sécurité d'un fournisseur qui a simplement rédigé une excellente réponse au questionnaire.

**Il ne couvre que les fournisseurs que vous savez interroger.** La plupart des inventaires de fournisseurs sont incomplets. Le shadow IT, ces outils SaaS acquis sans intégration formelle des fournisseurs, représente une surface de risque importante et largement invisible.

**Il crée une fausse assurance.** Un questionnaire complété dans une feuille de calcul a l'apparence d'un risque maîtrisé. Il peut en réalité représenter un risque non maîtrisé, doté d'une simple trace documentaire.

## À quoi ressemble le TPRM automatisé en pratique

Une plateforme automatisée de gestion des risques fournisseurs remplace le cycle du questionnaire annuel par une évaluation des risques continue et multidimensionnelle. Voici comment cela fonctionne dans GRC Eye :

### Inventaire et classification des fournisseurs

Chaque fournisseur est répertorié dans la plateforme avec ses services, le périmètre d'accès aux données, le type d'intégration et les détails contractuels. Les niveaux de risque sont attribués automatiquement selon des critères configurables : les fournisseurs ayant accès aux données personnelles des clients sont classés « Critique » ; les fournisseurs d'outils de productivité non intégrés sont classés « Faible ». L'inventaire est maintenu en continu : les nouveaux fournisseurs sont intégrés via un flux de travail structuré, et la plateforme alerte lorsque des contrats arrivent à échéance ou lorsque les données d'un fournisseur nécessitent une révision.

### Revue de contrats par IA

Lorsqu'un nouveau contrat fournisseur est chargé sur la plateforme, l'IA lit le document et effectue une analyse clause par clause au regard de vos exigences contractuelles standard. Elle signale :

- Les obligations de sécurité manquantes (absence de clause de droit d'audit, absence de délai de notification en cas de violation, absence de restrictions sur les sous-traitants)
- Les clauses non standard ou risquées (plafonds de responsabilité inférieurs à votre exposition, droits de résiliation asymétriques, engagements insuffisants en matière de résidence des données)
- Les écarts entre ce que dit le contrat et ce qu'exige votre politique fournisseurs

L'IA génère un rapport de synthèse avec un score de risque et une liste de points de négociation recommandés. Un juriste ou un responsable des achats examine ensuite le résultat. L'IA ne négocie pas les contrats, mais elle garantit qu'aucun contrat ne reste non lu et qu'aucune clause à risque ne passe inaperçue.

En pratique, cela transforme le processus de revue contractuelle : on passe de « les contrats sont revus quand le service juridique a le temps » à « chaque contrat est revu dans les 24 heures suivant son chargement, et le risque est documenté avant la signature ».

### Cartographie des risques à six dimensions

Chaque fournisseur de la plateforme est évalué selon six dimensions de risque :

1. **Posture cybersécurité** : réponses au questionnaire, signaux de surveillance indépendants, statut de certification
2. **Stabilité financière** : indicateurs de risque de crédit et données financières publiquement disponibles
3. **Conformité réglementaire** : conformité du sous-traitant au RGPD, obligations de chaîne d'approvisionnement de NIS2, certifications pertinentes
4. **Dépendance opérationnelle** : quel serait l'impact sur vos opérations si ce fournisseur devenait indisponible pendant 24 heures, 72 heures ou plus
5. **Exposition des données** : volume et sensibilité des données auxquelles le fournisseur peut accéder
6. **Risque géographique et géopolitique** : résidence des données, juridiction d'immatriculation, exposition géopolitique

La cartographie à six dimensions produit une carte de risque visuelle qui montre, d'un coup d'œil, où se concentrent les risques dans votre portefeuille fournisseurs. Un directeur financier peut voir immédiatement que l'exposition de ses données critiques se concentre sur trois fournisseurs, et poser les bonnes questions sur ces relations spécifiques.

### Workflow d'approbation du RSSI

Lorsqu'un contrat fournisseur est prêt à avancer après la revue par l'IA, la plateforme le fait passer par un workflow d'approbation configurable. Le RSSI (ou l'approbateur désigné) examine la synthèse des risques générée par l'IA, les problèmes contractuels identifiés et le plan de remédiation avant d'approuver l'intégration du fournisseur. L'approbation est journalisée avec l'identité de l'approbateur et l'horodatage : une piste d'audit complète à des fins réglementaires.

Ce workflow garantit qu'aucun fournisseur n'est intégré sans décision de risque documentée, et ce, sans exiger du RSSI qu'il lise chaque contrat dans son intégralité.

## L'argumentaire business : trois chiffres que les dirigeants doivent connaître

**4,5 M€ de coût moyen d'une violation impliquant un tiers** (IBM Cost of a Data Breach 2025, ajusté pour les entreprises de taille moyenne en UE). C'est le chiffre qui fait de la gestion des risques fournisseurs un sujet de conseil d'administration.

**70 % de réduction de l'exposition au risque fournisseur** obtenue par les clients de GRC Eye dans les 12 mois suivant la mise en place d'un TPRM automatisé, mesurée comme la réduction du nombre de fournisseurs évalués à risque élevé ou critique sans plan de remédiation documenté.

**85 % de réduction du temps de revue contractuelle** lorsque l'analyse de contrats par IA est appliquée. Une équipe juridique qui consacrait auparavant 8 à 12 heures à examiner un contrat fournisseur pour ses clauses de sécurité et de conformité réalise désormais la même revue en 60 à 90 minutes grâce à l'analyse générée par l'IA.

## Ce que NIS2 et DORA exigent de votre programme fournisseurs

NIS2 (article 21) et DORA (chapitre V) imposent tous deux des obligations spécifiques de sécurité de la chaîne d'approvisionnement aux organisations concernées :

**NIS2** exige des entités concernées qu'elles évaluent et gèrent les risques cyber posés par leurs fournisseurs et prestataires de services. Cela inclut l'évaluation des pratiques de sécurité des fournisseurs dans le cadre du programme global de gestion des risques de l'entité, ainsi que la mise en œuvre de mesures appropriées pour traiter les risques identifiés dans la chaîne d'approvisionnement.

**DORA** va plus loin pour les entités financières, en exigeant un cadre complet de gestion des risques liés aux tiers TIC, comprenant : un registre de tous les prestataires de services TIC, une diligence raisonnable préalable au contrat, une surveillance continue, une planification de stratégie de sortie, et une supervision au niveau du conseil d'administration. Les prestataires TIC critiques font l'objet d'une supervision directe par les autorités européennes.

Une plateforme TPRM automatisée dotée d'un registre fournisseurs complet, d'évaluations de risque documentées et d'une surveillance continue fournit le fondement probant nécessaire pour démontrer la conformité à ces deux exigences.

## Bien démarrer : une transformation des risques fournisseurs en 30 jours

**Jours 1 à 7 :** Importez votre inventaire fournisseurs. Commencez par les fournisseurs que vous connaissez déjà. Même si la liste est incomplète, il vaut mieux démarrer que d'attendre un inventaire parfait. Attribuez des niveaux de risque initiaux en fonction de l'accès aux données et de la dépendance opérationnelle.

**Jours 8 à 14 :** Chargez les contrats fournisseurs en attente dans le système de revue de contrats par IA. La plateforme identifiera immédiatement les contrats les plus risqués, typiquement ceux présentant des obligations de sécurité manquantes et des lacunes de responsabilité.

**Jours 15 à 21 :** Configurez l'évaluation à six dimensions pour vos 20 principaux fournisseurs par niveau de risque. Lancez l'analyse de cartographie. La cartographie de concentration des risques apparaîtra rapidement.

**Jours 22 à 30 :** Mettez en place une surveillance automatisée : alertes d'échéance contractuelle, cadences de revue des questionnaires, et suivi des notifications de violation. Configurez le workflow d'approbation du RSSI pour les nouveaux fournisseurs.

Au jour 30, vous disposez d'un programme de gestion des risques fournisseurs complet et surveillé : non plus un questionnaire annuel, mais un système de gestion des risques vivant.
`,
    faqs: [
      { q: "Comment gérer les fournisseurs qui refusent de compléter les questionnaires de sécurité ?", a: "La plateforme permet de signaler l'absence de réponse à un questionnaire comme un constat de risque et de l'escalader via le workflow d'approbation. Les fournisseurs non réactifs peuvent être restreints ou retirés de la liste des fournisseurs approuvés selon votre politique." },
      { q: "L'IA peut-elle revoir des contrats dans des langues autres que l'anglais ?", a: "La revue de contrats par IA de GRC Eye prend actuellement en charge l'anglais et le français, avec un support de langues additionnelles en cours de développement. Les contrats dans d'autres langues peuvent être revus manuellement à l'aide du cadre d'évaluation structuré de la plateforme." },
      { q: "Comment la plateforme gère-t-elle les fournisseurs relevant du shadow IT ?", a: "GRC Eye s'intègre aux fournisseurs d'identité et aux courtiers de sécurité d'accès au cloud (CASB) pour identifier les applications SaaS utilisées dans toute l'organisation. Les applications non enregistrées sont signalées comme relevant du shadow IT en vue d'une revue d'intégration fournisseur." },
      { q: "Quelle est la taille réaliste d'un programme fournisseurs ?", a: "Les clients de GRC Eye gèrent entre 50 et 3 000 fournisseurs sur la plateforme. Le modèle de niveaux de risque garantit que l'effort est proportionnel au risque : les fournisseurs critiques bénéficient d'une surveillance intensive, tandis que les fournisseurs à faible risque font l'objet de revues annuelles allégées." },
    ],
  },
  ar: {
    title: "أتمتة إدارة مخاطر الموردين: مراجعة العقود بالذكاء الاصطناعي وإدارة مخاطر الأطراف الثالثة في الوقت الفعلي",
    metaTitle: "أتمتة إدارة مخاطر الأطراف الثالثة ومراجعة العقود بالذكاء الاصطناعي | GRC Eye",
    metaDescription: "60% من الحوادث الأمنية تنشأ من أطراف ثالثة. تحليل العقود بالذكاء الاصطناعي والمراقبة المستمرة ورسم الخرائط السداسي الأبعاد يخفضان التعرض للمخاطر حتى 70%.",
    keywords: "أتمتة إدارة مخاطر الموردين, أتمتة إدارة مخاطر الأطراف الثالثة, مراجعة العقود بالذكاء الاصطناعي, مخاطر الأطراف الثالثة, منصة إدارة مخاطر الموردين, مخاطر سلسلة التوريد, TPRM آلي",
    excerpt: "60% من الحوادث الأمنية تتضمن طرفًا ثالثًا، ومع ذلك لا تزال معظم برامج إدارة مخاطر الأطراف الثالثة تعتمد على استبيانات سنوية. اكتشف كيف تُسهم أتمتة إدارة مخاطر الموردين، من خلال تحليل العقود بالذكاء الاصطناعي والمراقبة المستمرة ورسم الخرائط السداسي الأبعاد، في خفض التعرض لمخاطر الأطراف الثالثة حتى 70%.",
    body: `
## موردوك هم أكبر مخاطرك غير المُدارة

في عام 2026، لا تبدأ غالبية الحوادث الأمنية الكبرى داخل المؤسسة التي تتكبد أكبر ضرر منها. بل تبدأ في سلسلة التوريد: مورّد برمجيات بضوابط وصول غير كافية، أو مزوّد خدمة SaaS بواجهة برمجة تطبيقات (API) سيئة الإعداد، أو خدمة سحابية تحتوي على ثغرة لم يكن فريق الأمن لديك يعلم بوجودها إطلاقًا، لأن إجابة المورّد في الاستبيان كانت "جميع الضوابط مطبّقة".

الأرقام لا تحتمل اللبس. وفقًا لتقرير Verizon Data Breach Investigations Report لعام 2025، **تم رصد تورط طرف ثالث في 62% من خروقات البيانات**، مقارنة بـ15% قبل خمس سنوات. لقد أدى التحول إلى السحابة، وانتشار أدوات SaaS، وتزايد تخصص الوظائف التجارية إلى خلق سطح هجوم على مستوى سلسلة التوريد تفتقر معظم المؤسسات بشكل كبير إلى الاستعداد اللازم لإدارته.

يبدو برنامج إدارة مخاطر الأطراف الثالثة (TPRM) النموذجي في شركة متوسطة الحجم كالتالي: جدول بيانات يضم 150 موردًا، واستبيان أمني سنوي يُرسل إلى الموردين الثلاثين "الحرجين"، ومستوى مخاطر يُحدَّد بناءً على طريقة إجابة المورّد على الأسئلة. هذا أفضل من لا شيء. لكنه ليس أفضل بكثير من لا شيء.

## لماذا تفشل استبيانات الموردين السنوية

يعاني الاستبيان السنوي من أربع مشكلات هيكلية لا يمكن لأي تحسين في العملية إصلاحها:

**إنه لقطة في لحظة زمنية واحدة.** يمكن أن يتغير الوضع الأمني للمورّد بشكل جذري بين دورات الاستبيان: خرق بيانات، تغيير في إعدادات السحابة، عملية استحواذ، مغادرة موظف رئيسي. لا يلتقط الاستبيان أيًّا من ذلك.

**يعتمد كليًّا على التصريح الذاتي من المورّد.** لدى الموردين كل الحافز للإجابة على الاستبيانات بتفاؤل. وبدون تحقق مستقل، لا توجد طريقة للتمييز بين مورّد يتمتع بأمن ممتاز ومورّد لديه إجابة استبيان ممتازة فحسب.

**لا يغطي سوى الموردين الذين تعرف أن تسألهم.** معظم قوائم جرد الموردين غير مكتملة. تمثل تقنية المعلومات الخفية (Shadow IT)، أي أدوات SaaS التي يتم اقتناؤها دون إدماج رسمي للمورّد، سطح مخاطر كبيرًا وغير مرئي إلى حد كبير.

**يخلق طمأنينة زائفة.** استبيان مكتمل في جدول بيانات يبدو وكأنه خطر مُدار. قد يمثل في الواقع خطرًا غير مُدار مصحوبًا بمسار تدقيق ورقي فحسب.

## كيف تبدو إدارة مخاطر الأطراف الثالثة الآلية عمليًّا

تستبدل منصة أتمتة إدارة مخاطر الموردين دورة الاستبيان السنوي بتقييم مخاطر مستمر ومتعدد الأبعاد. إليك كيفية عملها في GRC Eye:

### جرد الموردين وتصنيفهم

يتم تسجيل كل مورّد في المنصة مع خدماته، ونطاق وصوله إلى البيانات، ونوع التكامل، وتفاصيل العقد. تُحدَّد مستويات المخاطر تلقائيًّا بناءً على معايير قابلة للتخصيص: الموردون الذين لديهم وصول إلى بيانات هوية العملاء الشخصية يُصنَّفون "حرجين"؛ أما موردو أدوات الإنتاجية غير المتكاملة فيُصنَّفون "منخفضي المخاطر". يُصان الجرد باستمرار: يتم إدماج الموردين الجدد عبر سير عمل منظم، وتُنبّه المنصة عند اقتراب انتهاء العقود أو عند الحاجة إلى مراجعة بيانات المورّد.

### مراجعة العقود بالذكاء الاصطناعي

عند تحميل عقد مورّد جديد على المنصة، يقرأ الذكاء الاصطناعي المستند ويجري تحليلًا بندًا ببند مقارنةً بمتطلبات عقودك القياسية. يرصد النظام:

- الالتزامات الأمنية المفقودة (عدم وجود بند حق التدقيق، عدم وجود جدول زمني للإخطار بالخروقات، عدم وجود قيود على معالجي البيانات من الباطن)
- البنود غير القياسية أو الخطرة (سقوف مسؤولية أقل من تعرضك الفعلي، حقوق إنهاء غير متوازنة، التزامات غير كافية بشأن إقامة البيانات)
- الفجوات بين ما ينص عليه العقد وما تتطلبه سياسة الموردين لديك

يُنشئ الذكاء الاصطناعي تقرير ملخص يتضمن درجة مخاطر وقائمة نقاط تفاوض موصى بها. ثم يراجع محامٍ أو مدير مشتريات المخرجات. لا يتفاوض الذكاء الاصطناعي على العقود، لكنه يضمن ألا يبقى أي عقد دون قراءة، وألا يمر أي بند خطر دون ملاحظة.

عمليًّا، يُحوّل هذا سير عمل مراجعة العقود من "تُراجَع العقود عندما يتوفر وقت للإدارة القانونية" إلى "يُراجَع كل عقد خلال 24 ساعة من تحميله، ويُوثَّق الخطر قبل التوقيع".

### رسم خرائط المخاطر السداسي الأبعاد

يُقيَّم كل مورّد في المنصة عبر ستة أبعاد للمخاطر:

1. **وضع الأمن السيبراني**: إجابات الاستبيان، إشارات المراقبة المستقلة، حالة الشهادات
2. **الاستقرار المالي**: مؤشرات المخاطر الائتمانية والبيانات المالية المتاحة للعموم
3. **الامتثال التنظيمي**: امتثال المعالج للائحة العامة لحماية البيانات (GDPR)، التزامات سلسلة التوريد بموجب NIS2، الشهادات ذات الصلة
4. **الاعتماد التشغيلي**: ماذا يحدث لعملياتك إذا أصبح هذا المورّد غير متاح لمدة 24 ساعة أو 72 ساعة أو أكثر
5. **التعرض للبيانات**: حجم وحساسية البيانات التي يمكن للمورّد الوصول إليها
6. **المخاطر الجغرافية والجيوسياسية**: إقامة البيانات، الولاية القضائية للتأسيس، التعرض الجيوسياسي

يُنتج رسم الخرائط السداسي الأبعاد خريطة مخاطر مرئية تُظهر بلمحة واحدة أين تتركز المخاطر في محفظة مورديك. يمكن للمدير المالي أن يرى فورًا أن تعرض بياناته الحرجة يتركز في ثلاثة موردين، ويطرح الأسئلة الصحيحة حول هذه العلاقات المحددة.

### سير عمل موافقة رئيس أمن المعلومات (CISO)

عندما يصبح عقد المورّد جاهزًا للمضي قدمًا بعد مراجعة الذكاء الاصطناعي، توجّهه المنصة عبر سير عمل موافقة قابل للتخصيص. يراجع رئيس أمن المعلومات (أو المعتمِد المُعيَّن) ملخص المخاطر الذي أعده الذكاء الاصطناعي، والمشكلات التعاقدية المحددة، وخطة المعالجة قبل الموافقة على إدماج المورّد. تُسجَّل الموافقة مع هوية المعتمِد والطابع الزمني: مسار تدقيق كامل لأغراض تنظيمية.

يضمن سير العمل هذا عدم إدماج أي مورّد دون قرار مخاطر موثَّق، ويحقق ذلك دون أن يتطلب من رئيس أمن المعلومات قراءة كل عقد بالكامل.

## الحجة التجارية: ثلاثة أرقام يجب أن يعرفها الرؤساء التنفيذيون

**4.5 مليون يورو متوسط تكلفة خرق ناجم عن طرف ثالث** (تقرير IBM Cost of a Data Breach لعام 2025، معدَّل للشركات المتوسطة في الاتحاد الأوروبي). هذا هو الرقم الذي يجعل من إدارة مخاطر الموردين موضوعًا يُطرح على مستوى مجلس الإدارة.

**70% خفض في التعرض لمخاطر الموردين** حققه عملاء GRC Eye خلال 12 شهرًا من تطبيق إدارة مخاطر الأطراف الثالثة الآلية، مقاسًا بانخفاض عدد الموردين المصنّفين على أنهم عالو أو حرجو المخاطر دون خطط معالجة موثَّقة.

**85% خفض في زمن مراجعة العقود** عند تطبيق تحليل العقود بالذكاء الاصطناعي. فريق قانوني كان يقضي سابقًا 8 إلى 12 ساعة في مراجعة عقد مورّد بحثًا عن بنود الأمن والامتثال، أصبح ينجز المراجعة ذاتها في 60 إلى 90 دقيقة باستخدام التحليل المُولَّد بالذكاء الاصطناعي.

## ما تتطلبه NIS2 وDORA من برنامج الموردين لديك

تفرض كل من NIS2 (المادة 21) وDORA (الفصل الخامس) التزامات محددة بأمن سلسلة التوريد على المؤسسات المشمولة:

**NIS2** تُلزم الكيانات المشمولة بتقييم وإدارة مخاطر الأمن السيبراني التي يشكّلها مورّدوها ومزوّدو الخدمات لديها. يشمل ذلك تقييم ممارسات الأمن لدى الموردين كجزء من برنامج إدارة المخاطر الشامل للكيان، واتخاذ التدابير المناسبة لمعالجة مخاطر سلسلة التوريد المحدَّدة.

**DORA** تذهب أبعد من ذلك بالنسبة للكيانات المالية، إذ تتطلب إطارًا شاملًا لإدارة مخاطر مزوّدي تقنية المعلومات والاتصالات (ICT) من أطراف ثالثة، يتضمن: سجلًا لجميع مزوّدي خدمات ICT، وعناية واجبة قبل التعاقد، ومراقبة مستمرة، وتخطيطًا لاستراتيجية الخروج، وإشرافًا على مستوى مجلس الإدارة. وتخضع أطراف ICT الحرجة الثالثة لإشراف رقابي مباشر من السلطات الأوروبية.

توفر منصة إدارة مخاطر الأطراف الثالثة الآلية، المزوَّدة بسجل موردين كامل وتقييمات مخاطر موثَّقة ومراقبة مستمرة، الأساس الإثباتي اللازم لإظهار الامتثال لكلا المتطلبين.

## البدء: تحول مخاطر الموردين في 30 يومًا

**الأيام 1-7:** استورد جرد الموردين لديك. ابدأ بالموردين الذين تعرفهم بالفعل. حتى لو كانت القائمة غير مكتملة، فالبدء أفضل من انتظار جرد مثالي. حدِّد مستويات المخاطر الأولية بناءً على الوصول إلى البيانات والاعتماد التشغيلي.

**الأيام 8-14:** حمِّل عقود الموردين المعلَّقة إلى نظام مراجعة العقود بالذكاء الاصطناعي. ستحدد المنصة فورًا العقود الأعلى مخاطرةً، وعادة ما تكون تلك التي تفتقر إلى التزامات أمنية أو تحتوي على ثغرات في المسؤولية.

**الأيام 15-21:** اضبط تقييم المخاطر السداسي الأبعاد لأهم 20 موردًا لديك حسب مستوى المخاطر. شغّل تحليل رسم الخرائط. ستظهر صورة تركز المخاطر بسرعة.

**الأيام 22-30:** أنشئ مراقبة آلية: تنبيهات انتهاء العقود، ووتيرات مراجعة الاستبيانات، وتتبع الإخطار بالخروقات. اضبط سير عمل موافقة رئيس أمن المعلومات للموردين الجدد.

بحلول اليوم الثلاثين، سيكون لديك برنامج كامل ومراقَب لإدارة مخاطر الموردين: ليس استبيانًا سنويًّا، بل نظام إدارة مخاطر حي.
`,
    faqs: [
      { q: "كيف نتعامل مع الموردين الذين يرفضون تعبئة استبيانات الأمن؟", a: "تتيح المنصة وسم عدم الرد على الاستبيان كنتيجة مخاطر وتصعيدها عبر سير عمل الموافقة. يمكن تقييد الموردين غير المستجيبين أو إزالتهم من قائمة الموردين المعتمدين وفقًا لسياستك." },
      { q: "هل يمكن للذكاء الاصطناعي مراجعة عقود بلغات غير الإنجليزية؟", a: "تدعم مراجعة العقود بالذكاء الاصطناعي في GRC Eye حاليًّا اللغتين الإنجليزية والفرنسية، مع دعم لغات إضافية قيد التطوير. يمكن مراجعة العقود بلغات أخرى يدويًّا باستخدام إطار التقييم المنظَّم للمنصة." },
      { q: "كيف تتعامل المنصة مع موردي تقنية المعلومات الخفية (Shadow IT)؟", a: "تتكامل GRC Eye مع مزوّدي الهوية ووسطاء أمن الوصول السحابي (CASB) لتحديد تطبيقات SaaS المستخدَمة في جميع أنحاء المؤسسة. تُوسم التطبيقات غير المسجَّلة كتقنية معلومات خفية لمراجعتها ضمن إدماج الموردين." },
      { q: "ما هو الحجم الواقعي لبرنامج الموردين؟", a: "يدير عملاء GRC Eye ما بين 50 و3000 مورّد على المنصة. يضمن نموذج المستويات المتدرجة للمخاطر أن يكون الجهد متناسبًا مع المخاطر: يحصل الموردون الحرجون على مراقبة مكثفة، بينما يخضع الموردون منخفضو المخاطر لمراجعات سنوية خفيفة." },
    ],
  },
};

export default translations;
