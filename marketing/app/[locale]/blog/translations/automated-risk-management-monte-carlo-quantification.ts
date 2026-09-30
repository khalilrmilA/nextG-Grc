import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title: "Gestion automatisée des risques : du registre des risques à Monte Carlo en un clic",
    metaTitle: "Gestion automatisée des risques et quantification Monte Carlo | GRC Eye",
    metaDescription: "Arrêtez de noter vos risques sur une échelle de 1 à 5 à laquelle votre conseil ne fait pas confiance. La quantification automatisée traduit le risque cyber en euros grâce à Monte Carlo.",
    keywords: "gestion automatisée des risques, quantification des risques Monte Carlo, automatisation du registre des risques, risque ALE SLE, quantification du risque cyber, logiciel de gestion des risques, plateforme GRC risque",
    excerpt: "Arrêtez de noter vos risques sur une échelle de 1 à 5 à laquelle votre conseil ne fait pas confiance. La quantification automatisée des risques par simulation Monte Carlo traduit le risque cyber en euros, fournit aux directeurs financiers des chiffres ALE/SLE compréhensibles, et remplace les cartographies fondées sur l'opinion par une rigueur statistique.",
    body: `
## Votre conseil d'administration ne fait pas confiance à votre cartographie des risques, et il a raison

Chaque RSSI a un jour présenté à son conseil d'administration une cartographie des risques rouge-orange-vert. Chaque membre du conseil l'a regardée et a posé la même question, poliment ou non : « Concrètement, qu'est-ce que cela représente pour nous en euros ? »

La réponse honnête, dans un programme de gestion des risques manuel, est : nous ne le savons pas précisément. Le score de probabilité « 3 sur 5 » et le score d'impact « 4 sur 5 » sont des jugements portés par un analyste risque un mardi après-midi. Ils ne sont pas faux. Mais ils ne sont pas défendables de la même manière que le sont des projections financières.

C'est pourquoi la gestion quantifiée des risques, qui traduit le risque cyber en termes monétaires à l'aide de méthodes statistiques, est passée d'une discipline académique de niche à une attente courante pour les conseils d'administration des entreprises de taille moyenne et des grands groupes. La question n'est plus de savoir s'il faut quantifier le risque, mais comment le faire sans recruter une équipe d'actuaires.

## Ce que la simulation Monte Carlo apporte aux gestionnaires de risques

La simulation Monte Carlo est une technique mathématique qui utilise un échantillonnage aléatoire répété pour modéliser la distribution de probabilité des résultats. En gestion des risques, elle fonctionne ainsi :

1. Pour chaque risque, vous définissez deux distributions : la probabilité que le risque se réalise au cours d'une année donnée (fréquence des événements générateurs de pertes) et l'ampleur de la perte financière s'il se réalise (magnitude de la perte).
2. La simulation exécute 10 000 scénarios, en tirant aléatoirement dans ces distributions.
3. Le résultat n'est pas un chiffre unique mais une distribution de résultats : la perte la plus probable, la perte au 90e centile, la perte au 95e centile.

Les indicateurs de sortie clés sont :

- **ALE (Annualised Loss Expectancy — perte annuelle attendue) :** la perte financière attendue de ce risque au cours d'une année donnée, en tenant compte de la probabilité d'occurrence.
- **SLE (Single Loss Expectancy — perte attendue par occurrence) :** la perte financière attendue lors d'une seule occurrence du risque.
- **P90 / P95 :** la perte que vous ne devriez pas dépasser 90 % / 95 % du temps. C'est le chiffre que votre directeur financier veut pour dimensionner l'assurance et pour la communication au conseil.

Une cartographie des risques vous dit « le rançongiciel est un risque à forte probabilité et fort impact ». Monte Carlo vous dit « le rançongiciel a un ALE de 840 000 €, et il existe 5 % de chances qu'un événement unique dépasse 3,2 M€ au cours d'une année donnée ». La seconde phrase change la conversation.

## L'argumentaire du dirigeant en faveur de la gestion quantifiée des risques

Pour les dirigeants, la gestion quantifiée des risques résout trois problèmes que les cartographies qualitatives ne peuvent résoudre :

### Problème 1 : les décisions d'allocation de capital sont impossibles sans chiffres

Lorsque le RSSI demande un budget de 200 000 € pour déployer une solution de détection et réponse sur les postes de travail (EDR), la question du directeur financier est légitime : qu'est-ce que cela nous apporte ? Une réponse qualitative (« cela réduit notre risque de rançongiciel de Élevé à Moyen ») n'est pas un dossier d'investissement. Une réponse quantitative (« cela réduit notre ALE lié au rançongiciel de 840 000 € à 290 000 €, soit une réduction du risque de 550 000 € par an, pour un coût de 200 000 € ») en est un.

La gestion quantifiée des risques rend les décisions d'investissement en sécurité maîtrisables. Chaque mesure de contrôle peut être évaluée à l'aune de la réduction de risque qu'elle apporte. Les priorités deviennent défendables. Les investissements écartés sont documentés. La discussion sur le budget sécurité passe d'une négociation à une analyse.

### Problème 2 : l'assurance cyber dépend de plus en plus des modèles

Les assureurs ne veulent plus tarifer une couverture cyber sur la seule base d'un questionnaire et d'une cartographie. Ils veulent comprendre l'exposition financière modélisée par votre programme de gestion des risques. Les organisations capables de présenter des résultats Monte Carlo (ALE, SLE, P90, P95 par catégorie de risque) négocient de meilleures couvertures, de meilleures conditions et de meilleures primes. Celles qui ne le peuvent pas voient de plus en plus leur couverture limitée ou exclue.

### Problème 3 : les exigences de communication au conseil se durcissent

Les règles de la SEC (pour les sociétés cotées aux États-Unis) et les exigences européennes émergentes au titre de DORA et NIS2 imposent aux conseils de démontrer qu'ils ont évalué les risques cyber matériels en termes financiers. « Notre cartographie des risques indique un rançongiciel Élevé » ne suffit peut-être plus à répondre à cette exigence. « Notre analyse Monte Carlo du risque de rançongiciel donne un ALE de 840 000 € avec une queue de distribution P95 de 3,2 M€, couverte par notre police d'assurance cyber à hauteur de 2 M€ » y répond.

## À quoi ressemble la quantification automatisée des risques en pratique

Historiquement, l'analyse Monte Carlo des risques exigeait des outils spécialisés (souvent des tableurs Excel avec des macros personnalisées), une expertise actuarielle importante et des semaines de préparation par risque. Les plateformes GRC modernes ont complètement changé la donne.

Dans GRC Eye, le flux de quantification fonctionne comme suit :

**Définir le scénario de risque.** Le gestionnaire de risques décrit la menace (rançongiciel via hameçonnage), l'actif vulnérable (base de données de production) et le processus métier affecté (application destinée aux clients).

**Définir les paramètres de fréquence et de magnitude.** La plateforme fournit des données de référence sectorielles pour les scénarios de risque courants, issues de jeux de données tels que le Verizon DBIR et les rapports sur le paysage des menaces de l'ENISA, à titre de valeurs par défaut. Le gestionnaire de risques les ajuste en fonction de facteurs propres à l'organisation : secteur d'activité, taille, maturité des contrôles.

**Lancer la simulation.** En un clic, la plateforme exécute 10 000 itérations Monte Carlo. Le calcul prend quelques secondes.

**Examiner les résultats.** La plateforme affiche l'ALE, le SLE, le P90 et le P95 du risque, accompagnés d'un graphique de distribution montrant l'ensemble des résultats modélisés. Le gestionnaire de risques peut voir immédiatement quels scénarios extrêmes génèrent la plus grande exposition.

**Relier les mesures de contrôle.** Pour chaque scénario de risque, la plateforme relie les mesures de contrôle appliquées qui réduisent le risque. Si une nouvelle mesure est ajoutée (par exemple, la MFA sur tous les comptes à privilèges), le gestionnaire de risques met à jour l'ensemble des contrôles et relance la simulation pour observer la réduction de risque quantifiée.

**Exporter pour le conseil.** Un rapport PDF généré en un clic présente la quantification du risque dans un langage exploitable par le conseil : ALE par catégorie de risque, exposition en queue de distribution P95, adéquation de l'assurance et retour sur investissement des mesures de contrôle.

## Construire un registre des risques qui inspire confiance au conseil

Le registre des risques est le fondement d'un programme de gestion des risques quantifié. Voici comment en construire un auquel un conseil d'administration fera réellement confiance :

**Partir de scénarios, pas de risques abstraits.** « Rançongiciel » n'est pas un scénario de risque. « Attaque par rançongiciel via un e-mail d'hameçonnage ciblant le département financier, chiffrant le système ERP de production, entraînant une interruption de 72 heures et une exfiltration des données clients » est un scénario de risque. Cette précision compte car elle rend les paramètres de fréquence et de magnitude défendables.

**Utiliser des chaînes menace-vulnérabilité-actif.** Un bon scénario de risque relie une menace précise (opérateur de rançongiciel), une vulnérabilité précise (utilisateurs disposant de droits administrateur ouvrant des pièces jointes), un actif précis (ERP de production) et les mesures de contrôle appliquées (protection des postes de travail, MFA, restauration de sauvegardes). Cette structure permet de voir clairement où les contrôles réduisent le risque et où subsistent des lacunes.

**Réviser trimestriellement, pas annuellement.** Les registres des risques mis à jour une fois par an sont obsolètes dès leur publication. Les plateformes automatisées permettent des cycles de révision trimestriels avec des rappels automatiques aux propriétaires de risques. L'effort par révision passe de plusieurs jours à quelques heures lorsque le registre est maintenu en continu.

**Présenter des tendances, pas des instantanés.** Un conseil d'administration veut savoir si l'environnement de risque s'améliore ou se détériore. Une plateforme automatisée suit les scores de risque dans le temps et montre la tendance : les investissements en contrôles réduisent l'ALE, ou un nouveau scénario de menace a augmenté l'exposition en queue de distribution. Les tendances sont plus actionnables que des instantanés ponctuels.

## La feuille de route du RSSI

**Mois 1 :** Migrez votre registre des risques existant vers la plateforme. Même si votre registre actuel est un tableur avec des scores de probabilité/impact subjectifs, importez-le comme point de départ. La plateforme peut convertir les scores qualitatifs en fourchettes quantitatives comme première approximation.

**Mois 2 :** Sélectionnez vos 10 risques les plus importants selon l'impact perçu et réalisez une analyse Monte Carlo pour chacun. Utilisez des références sectorielles pour la fréquence et la magnitude lorsque vous ne disposez pas de données propres à votre organisation. Le résultat ne sera pas parfaitement calibré, mais il sera plus défendable qu'une cartographie et révélera quels risques présentent une exposition disproportionnée en queue de distribution.

**Mois 3 :** Présentez le premier rapport de risque quantifié au conseil d'administration. Les chiffres d'ALE et de P95 susciteront des questions — de bonnes questions, celles qui mènent à une meilleure allocation du capital. Utilisez ces questions pour affiner le modèle.

**En continu :** Révisez et mettez à jour le modèle chaque trimestre. Ajoutez de nouveaux scénarios de risque à mesure que le paysage des menaces évolue. Mesurez quantitativement l'impact des nouvelles mesures de contrôle. Construisez un registre des risques sur lequel le directeur financier et le conseil peuvent s'appuyer pour leurs décisions d'investissement et leurs obligations de communication.
`,
    faqs: [
      { q: "Faut-il une expertise actuarielle pour réaliser une analyse Monte Carlo ?", a: "Non. Les plateformes GRC modernes fournissent des données de référence sectorielles pour les paramètres de fréquence et de magnitude, et la simulation s'exécute automatiquement. Les gestionnaires de risques doivent comprendre les résultats et valider les paramètres, pas construire des modèles statistiques à partir de zéro." },
      { q: "Quelle est la fiabilité des résultats Monte Carlo ?", a: "Les résultats sont aussi fiables que les données d'entrée. Les données de référence sectorielles offrent un point de départ raisonnable ; les données propres à l'organisation (incidents historiques, sinistres d'assurance, renseignement sur les menaces) améliorent la précision au fil du temps. Même une approximation bien calibrée est plus défendable qu'une cartographie qualitative." },
      { q: "Peut-on utiliser les résultats Monte Carlo pour l'assurance cyber ?", a: "Oui. De nombreux assureurs acceptent la quantification Monte Carlo dans le cadre du processus de souscription, et les organisations dotées d'un programme de risque quantifié négocient généralement de meilleures couvertures et primes. Vérifiez auprès de votre courtier." },
      { q: "Combien de scénarios de risque faut-il modéliser ?", a: "Commencez par vos 10 à 15 principaux scénarios de risque. Ils représenteront l'essentiel de votre exposition modélisée. Étendez le registre à mesure que votre programme gagne en maturité." },
    ],
  },
  ar: {
    title: "الإدارة الآلية للمخاطر: من سجل المخاطر إلى محاكاة مونت كارلو بنقرة واحدة",
    metaTitle: "الإدارة الآلية للمخاطر وتقدير المخاطر بمحاكاة مونت كارلو | GRC Eye",
    metaDescription: "توقفوا عن تقييم المخاطر على مقياس من 1 إلى 5 لا يثق به مجلس الإدارة. التقدير الآلي للمخاطر يترجم المخاطر السيبرانية إلى أرقام مالية بمنهجية مونت كارلو.",
    keywords: "الإدارة الآلية للمخاطر, تقدير المخاطر بمحاكاة مونت كارلو, أتمتة سجل المخاطر, مؤشرا ALE وSLE, تقدير المخاطر السيبرانية, برنامج إدارة المخاطر, منصة حوكمة ومخاطر وامتثال",
    excerpt: "توقفوا عن تقييم المخاطر على مقياس من 1 إلى 5 لا يثق به مجلس الإدارة. التقدير الآلي للمخاطر بمحاكاة مونت كارلو يترجم المخاطر السيبرانية إلى قيم مالية، ويمنح المديرين الماليين أرقام ALE وSLE المفهومة لديهم، ويستبدل الخرائط الحرارية القائمة على الرأي الشخصي بدقة إحصائية.",
    body: `
## مجلس الإدارة لا يثق بخريطة المخاطر لديكم، وهو محق في ذلك

كل رئيس لأمن المعلومات قدّم يومًا لمجلس الإدارة خريطة مخاطر بألوان أحمر-برتقالي-أخضر. وكل عضو من أعضاء المجلس نظر إليها وطرح السؤال نفسه، بلباقة أو بصراحة: "ماذا يعني هذا فعليًا بالنسبة لنا باليورو؟"

الإجابة الصادقة، في برنامج إدارة مخاطر يدوي، هي: لا نعرف بدقة. درجة الاحتمالية "3 من 5" ودرجة التأثير "4 من 5" هما حكمان اجتهاديان صادران عن محلل مخاطر بعد ظهر يوم ثلاثاء. ليسا خاطئين. لكنهما أيضًا غير قابلين للدفاع عنهما بالطريقة التي تُدافع بها عن التوقعات المالية.

لهذا السبب انتقلت الإدارة الكمية للمخاطر، أي ترجمة المخاطر السيبرانية إلى قيم مالية باستخدام أساليب إحصائية، من تخصص أكاديمي نادر إلى توقّع سائد لدى مجالس إدارة الشركات المتوسطة والكبرى. لم يعد السؤال هو ما إذا كان ينبغي تقدير المخاطر كميًا، بل كيف يمكن فعل ذلك دون توظيف فريق من الخبراء الاكتواريين.

## ما الذي تقدّمه محاكاة مونت كارلو لمديري المخاطر

محاكاة مونت كارلو هي تقنية رياضية تعتمد على أخذ عينات عشوائية متكررة لنمذجة التوزيع الاحتمالي للنتائج. في إدارة المخاطر، تعمل على النحو التالي:

1. لكل خطر، تُحدَّد توزيعان: احتمال وقوع الخطر خلال أي سنة معينة (تكرار الأحداث المسبِّبة للخسارة)، وحجم الخسارة المالية في حال وقوعه (مقدار الخسارة).
2. تُجري المحاكاة 10,000 سيناريو، بسحب عشوائي من هذين التوزيعين.
3. النتيجة ليست رقمًا واحدًا بل توزيعًا للنتائج: الخسارة الأكثر احتمالًا، والخسارة عند المئين التسعين، والخسارة عند المئين الخامس والتسعين.

مؤشرات النتائج الأساسية هي:

- **ALE (متوسط الخسارة السنوية المتوقعة):** الخسارة المالية المتوقعة من هذا الخطر خلال أي سنة معينة، مع مراعاة احتمال وقوعه.
- **SLE (الخسارة المتوقعة للحادثة الواحدة):** الخسارة المالية المتوقعة من وقوع واحد للخطر.
- **P90 / P95:** الخسارة التي يُتوقع ألا تُتجاوز في 90% / 95% من الوقت. وهو الرقم الذي يحتاجه المدير المالي لتحديد حجم التغطية التأمينية وللإفصاح أمام مجلس الإدارة.

خريطة المخاطر تخبركم أن "برمجيات الفدية خطر عالي الاحتمال وعالي التأثير". أما مونت كارلو فيخبركم أن "برمجيات الفدية لها ALE قدره 840,000 يورو، وهناك احتمال 5% أن يتجاوز حدث واحد 3.2 مليون يورو خلال أي سنة معينة". الجملة الثانية تُغيّر مسار النقاش.

## حجة الرئيس التنفيذي لصالح الإدارة الكمية للمخاطر

بالنسبة للرؤساء التنفيذيين، تحل الإدارة الكمية للمخاطر ثلاث مشكلات لا تستطيع الخرائط الحرارية النوعية حلّها:

### المشكلة الأولى: قرارات تخصيص رأس المال مستحيلة دون أرقام

عندما يطلب رئيس أمن المعلومات ميزانية قدرها 200,000 يورو لنشر حل الكشف والاستجابة على نقاط النهاية، فإن سؤال المدير المالي منطقي: ماذا يحقق لنا هذا؟ إجابة نوعية ("يقلل مخاطر برمجيات الفدية من مرتفع إلى متوسط") ليست مبررًا استثماريًا. أما الإجابة الكمية ("يقلل ALE الخاص ببرمجيات الفدية من 840,000 يورو إلى 290,000 يورو، أي تخفيض للمخاطر بقيمة 550,000 يورو سنويًا، مقابل تكلفة 200,000 يورو") فهي مبرر استثماري فعلي.

الإدارة الكمية للمخاطر تجعل قرارات الاستثمار الأمني قابلة للمعالجة. يمكن تقييم كل ضابط رقابي وفق حجم تخفيض المخاطر الذي يحققه. تصبح الأولويات قابلة للدفاع عنها. وتُوثَّق الاستثمارات المرفوضة. ويتحول النقاش حول ميزانية الأمن من مفاوضة إلى تحليل.

### المشكلة الثانية: التأمين السيبراني يعتمد بشكل متزايد على النماذج

لم تعد شركات التأمين مستعدة لتسعير التغطية السيبرانية بناءً على استبيان وخريطة مخاطر فقط. فهي تريد فهم التعرض المالي الذي نمذجه برنامج إدارة المخاطر لديكم. المؤسسات القادرة على تقديم نتائج مونت كارلو (ALE وSLE وP90 وP95 حسب فئة الخطر) تحصل على تفاوض أفضل للتغطية والشروط وأقساط التأمين. أما التي لا تستطيع ذلك، فتجد تغطيتها محدودة أو مستبعدة بشكل متزايد.

### المشكلة الثالثة: تشديد متطلبات الإفصاح أمام مجلس الإدارة

تفرض قواعد هيئة الأوراق المالية الأمريكية SEC (للشركات المدرجة في الولايات المتحدة) والمتطلبات الأوروبية الناشئة بموجب DORA وNIS2 على مجالس الإدارة إثبات أنها قيّمت المخاطر السيبرانية الجوهرية من الناحية المالية. قد لا تعود عبارة "خريطة المخاطر لدينا تُظهر برمجيات الفدية كخطر مرتفع" كافية لتلبية هذا المتطلب. أما عبارة "تحليل مونت كارلو لمخاطر برمجيات الفدية لدينا يعطي ALE قدره 840,000 يورو مع ذيل توزيع P95 يبلغ 3.2 مليون يورو، مغطى بوثيقة التأمين السيبراني لدينا حتى 2 مليون يورو" فهي كافية.

## كيف يبدو التقدير الآلي للمخاطر في الممارسة العملية

تاريخيًا، كان تحليل مونت كارلو للمخاطر يتطلب أدوات متخصصة (غالبًا جداول إكسل مزودة بماكرو مخصص)، وخبرة اكتوارية كبيرة، وأسابيع من التحضير لكل خطر. غيّرت منصات الحوكمة والمخاطر والامتثال الحديثة هذا الواقع تمامًا.

في GRC Eye، يعمل مسار التقدير الكمي كما يلي:

**تحديد سيناريو الخطر.** يصف مدير المخاطر التهديد (برمجيات فدية عبر التصيّد الاحتيالي)، والأصل المعرَّض للخطر (قاعدة بيانات الإنتاج)، والعملية التجارية المتأثرة (التطبيق الموجه للعملاء).

**تحديد مدخلات التكرار والحجم.** توفر المنصة بيانات مرجعية قطاعية للسيناريوهات الشائعة للمخاطر، مستمدة من مصادر مثل تقرير Verizon DBIR وتقارير مشهد التهديدات الصادرة عن ENISA، كقيم افتراضية. يقوم مدير المخاطر بتعديلها بناءً على عوامل خاصة بالمؤسسة: القطاع، الحجم، ونضج الضوابط.

**تشغيل المحاكاة.** بنقرة واحدة، تُنفّذ المنصة 10,000 تكرار لمحاكاة مونت كارلو. تستغرق العملية الحسابية ثوانٍ معدودة.

**مراجعة النتائج.** تعرض المنصة قيم ALE وSLE وP90 وP95 للخطر، إلى جانب مخطط توزيع يُظهر المدى الكامل للنتائج المنمذجة. يمكن لمدير المخاطر أن يرى فورًا أي سيناريوهات الطرف القصوى تُسبب أكبر تعرض للمخاطر.

**ربط الضوابط.** لكل سيناريو خطر، تربط المنصة الضوابط المطبَّقة التي تُخفّض الخطر. وفي حال إضافة ضابط جديد (كتفعيل المصادقة متعددة العوامل على جميع الحسابات ذات الصلاحيات المتقدمة)، يقوم مدير المخاطر بتحديث مجموعة الضوابط وإعادة تشغيل المحاكاة لملاحظة تخفيض المخاطر بشكل كمي.

**التصدير لمجلس الإدارة.** تقرير PDF يُنشأ بنقرة واحدة يعرض تقدير المخاطر بلغة يمكن لمجلس الإدارة التصرف بناءً عليها: ALE حسب فئة الخطر، تعرض ذيل التوزيع P95، مدى كفاية التأمين، وعائد الاستثمار في الضوابط.

## بناء سجل مخاطر يكسب ثقة مجلس الإدارة

سجل المخاطر هو أساس أي برنامج لإدارة المخاطر الكمية. إليكم كيفية بناء سجل يثق به مجلس الإدارة فعليًا:

**ابدأوا بالسيناريوهات لا بالمخاطر المجرّدة.** "برمجيات الفدية" ليست سيناريو خطر. أما "هجوم ببرمجيات فدية عبر رسالة تصيّد احتيالي تستهدف قسم المالية، يُشفّر نظام تخطيط موارد المؤسسات (ERP) في بيئة الإنتاج، ويؤدي إلى توقف لمدة 72 ساعة وتسريب بيانات العملاء" فهو سيناريو خطر. هذا التحديد الدقيق مهم لأنه يجعل مدخلات التكرار والحجم قابلة للدفاع عنها.

**استخدموا سلاسل التهديد-الثغرة-الأصل.** سيناريو الخطر الجيد يربط تهديدًا محددًا (مشغّل برمجيات فدية)، وثغرة محددة (مستخدمون بصلاحيات إدارية يفتحون مرفقات بريد إلكتروني)، وأصلاً محددًا (نظام ERP للإنتاج)، والضوابط المطبَّقة (حماية نقاط النهاية، المصادقة متعددة العوامل، استعادة النسخ الاحتياطية). هذا البناء يوضّح أين تُخفّض الضوابط المخاطر وأين لا تزال هناك ثغرات.

**راجعوا كل ربع سنة، لا سنويًا.** سجلات المخاطر التي تُحدَّث سنويًا تصبح قديمة في يوم نشرها. تتيح المنصات الآلية دورات مراجعة ربع سنوية مع تذكيرات آلية لأصحاب المخاطر. ينخفض الجهد المطلوب لكل مراجعة من أيام إلى ساعات عندما يُصان السجل باستمرار.

**اعرضوا الاتجاهات لا اللقطات الآنية.** يريد مجلس الإدارة معرفة ما إذا كانت بيئة المخاطر تتحسن أم تتدهور. تتتبّع المنصة الآلية درجات المخاطر عبر الزمن وتُظهر الاتجاه: هل يُخفّض الاستثمار في الضوابط ALE، أم أن سيناريو تهديد جديدًا زاد من تعرض الذيل. الاتجاهات أكثر قابلية للتصرف من اللقطات الآنية.

## مسار التنفيذ لدى رئيس أمن المعلومات

**الشهر الأول:** انقلوا سجل المخاطر الحالي لديكم إلى المنصة. حتى لو كان سجلكم الحالي جدول بيانات بدرجات احتمال/تأثير ذاتية، استوردوه كنقطة انطلاق. يمكن للمنصة تحويل الدرجات النوعية إلى نطاقات كمية كتقدير أولي.

**الشهر الثاني:** اختاروا أهم 10 مخاطر لديكم من حيث التأثير المتصوَّر وأجروا تحليل مونت كارلو لكل منها. استخدموا المعايير القطاعية للتكرار والحجم حيثما لا تتوفر بيانات خاصة بمؤسستكم. لن تكون النتيجة معايرة بشكل مثالي، لكنها ستكون أكثر قابلية للدفاع عنها من الخريطة الحرارية، وستكشف أي المخاطر لديها تعرض غير متناسب في الذيل.

**الشهر الثالث:** قدّموا أول تقرير مخاطر كمي لمجلس الإدارة. ستُثير أرقام ALE وP95 أسئلة — أسئلة جيدة، من النوع الذي يقود إلى تخصيص أفضل لرأس المال. استخدموا هذه الأسئلة لتحسين النموذج.

**بشكل مستمر:** راجعوا النموذج وحدّثوه كل ربع سنة. أضيفوا سيناريوهات مخاطر جديدة مع تطور مشهد التهديدات. قيسوا أثر الضوابط الجديدة كميًا. ابنوا سجل مخاطر يمكن للمدير المالي ومجلس الإدارة الاعتماد عليه في قرارات الاستثمار ومتطلبات الإفصاح.
`,
    faqs: [
      { q: "هل نحتاج إلى خبرة اكتوارية لإجراء تحليل مونت كارلو؟", a: "لا. توفر منصات الحوكمة والمخاطر والامتثال الحديثة بيانات مرجعية قطاعية لمدخلات التكرار والحجم، وتُشغَّل المحاكاة تلقائيًا. يحتاج مديرو المخاطر إلى فهم النتائج والتحقق من صحة المدخلات، لا إلى بناء نماذج إحصائية من الصفر." },
      { q: "ما مدى دقة نتائج مونت كارلو؟", a: "دقة النتائج تعادل دقة المدخلات. توفر البيانات المرجعية القطاعية نقطة انطلاق معقولة؛ وتُحسّن البيانات الخاصة بالمؤسسة (من الحوادث السابقة، ومطالبات التأمين، واستخبارات التهديدات) الدقة مع الوقت. حتى التقدير التقريبي المعاير جيدًا أكثر قابلية للدفاع عنه من الخريطة الحرارية النوعية." },
      { q: "هل يمكن استخدام نتائج مونت كارلو لأغراض التأمين السيبراني؟", a: "نعم. تقبل العديد من شركات التأمين تقدير مونت كارلو كجزء من عملية الاكتتاب، وعادةً ما تحصل المؤسسات ذات برامج المخاطر الكمية على تفاوض أفضل للتغطية والأقساط. تحققوا مع وسيط التأمين لديكم." },
      { q: "كم عدد سيناريوهات المخاطر التي ينبغي نمذجتها؟", a: "ابدأوا بأهم 10 إلى 15 سيناريو خطر لديكم. ستمثل هذه السيناريوهات الجزء الأكبر من التعرض المنمذج. وسّعوا السجل مع نضج برنامجكم." },
    ],
  },
};

export default translations;
