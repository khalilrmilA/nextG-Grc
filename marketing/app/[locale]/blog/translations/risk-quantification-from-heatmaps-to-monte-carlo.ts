import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title: "La quantification du risque expliquée : des heatmaps à la simulation de Monte Carlo",
    metaTitle: "Quantification du risque : des heatmaps à Monte Carlo",
    metaDescription:
      "Comment traduire des notations de risque qualitatives en chiffres financiers compréhensibles par votre conseil. ALE, SLE, P90/P95 et la simulation de Monte Carlo qui remplace la matrice 5x5.",
    keywords:
      "quantification du risque, ALE SLE risque cyber, simulation Monte Carlo risque cyber, méthodologie FAIR, analyse quantitative du risque, impact financier du risque cyber",
    excerpt:
      "Les conseils d'administration ne se satisfont plus du « élevé-moyen-faible ». Voici comment traduire des notations de risque qualitatives dans le langage financier de votre directeur financier, à l'aide de méthodes statistiques utilisées en finance depuis trente ans.",
    body: `
## La matrice 5x5 ne suffit plus

Si votre dernier rapport de risque a indiqué au comité d'audit que « le risque de violation de données est élevé, l'impact sur l'activité est élevé, la remédiation est en cours », et que le comité d'audit a demandé « élevé par rapport à quoi ? », vous avez déjà rencontré la limite de la gestion qualitative du risque. Trois couleurs et une heatmap ne peuvent pas répondre à des questions comme :

- Combien devrions-nous budgétiser pour l'assurance cyber l'année prochaine ?
- Les 4 M€ que nous dépensons en EDR génèrent-ils un retour sur investissement ?
- Lequel de ces deux investissements en contrôles réduit le plus de risque par euro dépensé ?

Pour répondre à ces questions, il faut des chiffres. Plus précisément, **des chiffres financiers assortis d'intervalles de confiance**. La bonne nouvelle : les méthodes permettant de les produire sont utilisées depuis des décennies en actuariat, en finance et en fiabilité de l'ingénierie. Le risque cyber est enfin en train de rattraper son retard.

## Le vocabulaire

Avant d'aller plus loin, trois termes que tout RSSI doit maîtriser :

- **SLE : Single Loss Expectancy (perte unitaire attendue).** Le montant en euros perdu si un événement de risque spécifique se produit une fois. Pour une violation de données : coût de l'investigation + notification + juridique + amendes réglementaires + remédiation + perte de clients. Généralement une fourchette, pas un chiffre unique.
- **ARO : Annualized Rate of Occurrence (taux de fréquence annualisé).** La fréquence attendue de l'événement par an. Souvent une fraction (un événement récurrent tous les 5 ans a un ARO de 0,2).
- **ALE : Annualized Loss Expectancy (perte annuelle attendue).** SLE × ARO. La perte annuelle attendue de ce risque, en euros. C'est le chiffre que votre directeur financier comprend.

Jusqu'ici, il ne s'agit que d'arithmétique simple. La difficulté est que le SLE et l'ARO ne sont pas des chiffres uniques. Ce sont des distributions de probabilité. Une violation de données peut coûter entre 500 K€ et 15 M€ selon le nombre d'enregistrements concernés, la juridiction et le déroulement de la réponse à l'incident. L'ARO peut être d'une fois tous les 2 ans pour un événement probable ou d'une fois tous les 30 ans pour un événement de queue de distribution.

## Pourquoi les estimations ponctuelles mentent

Supposons que vous annonciez au conseil : « l'ALE d'un événement ransomware est de 1,2 M€ ». Ils entendront cela comme la réponse. Mais derrière ce chiffre unique se cache une large distribution : peut-être que 50 % des scénarios plausibles coûtent entre 200 K€ et 500 K€, 30 % coûtent entre 1 M€ et 3 M€, 15 % coûtent entre 5 M€ et 20 M€, et 5 % coûtent plus de 20 M€. Le 1,2 M€ est la moyenne. C'est aussi le chiffre qui ne se produit presque jamais réellement : la perte réelle est soit bien plus petite, soit bien plus grande.

Les conseils d'administration prennent leurs décisions d'allocation de capital sur la base du risque de queue, pas de la moyenne. Si le pire scénario est de 20 M€ avec une probabilité de 5 %, cela représente une perte de queue attendue de 1 M€ que le conseil doit capitaliser séparément. Si vous ne présentez que la moyenne de 1,2 M€, cette décision n'est jamais prise.

## La simulation de Monte Carlo en termes simples

La simulation de Monte Carlo est la technique standard pour traiter des distributions plutôt que des estimations ponctuelles. La procédure :

1. Pour chaque variable d'entrée (SLE, ARO), spécifiez une **distribution de probabilité**, généralement triangulaire ou lognormale, entre une estimation basse, une estimation la plus probable et une estimation haute.
2. **Exécutez la simulation 10 000 fois ou plus.** Chaque itération tire un échantillon aléatoire de chaque distribution d'entrée et calcule la perte annuelle correspondante.
3. **Agrégez les résultats** en une distribution des pertes annuelles sur l'ensemble des itérations.
4. Relevez les indicateurs pertinents : moyenne (ALE), médiane, P90 (perte au 90ᵉ centile), P95, P99.

Le résultat ressemble à ceci :

- Perte annuelle moyenne : **1,2 M€**
- Perte annuelle médiane : **450 K€**
- P90 (dans 90 % des cas, la perte est au plus de) : **2,8 M€**
- P95 : **5,1 M€**
- P99 : **18 M€**

Ce sont les chiffres sur lesquels votre directeur financier et votre comité d'audit peuvent agir. Le P95 en particulier est le seuil de « valeur à risque » communément utilisé : le chiffre servant à dimensionner les plafonds d'assurance cyber et le capital de réserve.

## FAIR : la méthodologie derrière les chiffres

La méthodologie Factor Analysis of Information Risk (FAIR), développée par Jack Jones et standardisée par l'Open Group, est le référentiel dominant pour l'analyse quantitative du risque cyber. FAIR décompose le risque en Fréquence des Événements de Perte et Ampleur des Pertes, chacune étant elle-même décomposée en sous-facteurs mesurables. Le résultat d'une analyse FAIR est exactement le type de distribution que la simulation de Monte Carlo est conçue pour exploiter.

Il n'est pas nécessaire d'être analyste certifié FAIR pour commencer. Un point de départ raisonnable :

- Pour chaque risque majeur de votre registre, recueillez **trois estimations** (scénario optimiste, le plus probable, pessimiste) pour la fréquence annuelle et pour la perte par événement.
- Utilisez une distribution triangulaire, sauf si vous disposez de données permettant d'ajuster une distribution lognormale.
- Exécutez 10 000 itérations.
- Validez le résultat par rapport aux référentiels du secteur (Verizon DBIR, IBM Cost of Data Breach, Allianz Cyber Risk Report).

Si votre résultat indique une perte annuelle de 15 M€ pour le ransomware alors que le rapport IBM situe la perte moyenne à 5 M€, soit vos hypothèses sont trop pessimistes, soit vous opérez dans un environnement plus exposé que la moyenne — auquel cas, documentez pourquoi.

## Ce que cela permet

Le risque quantitatif produit trois choses que le risque qualitatif ne produit pas.

**Un budget d'assurance cyber défendable.** Les assureurs tarifent la couverture en fonction de la perte attendue majorée d'un chargement de risque. Si vous pouvez présenter un chiffre P95, votre courtier peut négocier sur cette base. Si vous ne le pouvez pas, vous acceptez ce que l'assureur propose.

**Le calcul du ROI des contrôles.** Un contrôle réduit l'ARO, le SLE, ou les deux. Si vous relancez la simulation de Monte Carlo avec les nouvelles données après contrôle, la différence d'ALE représente le bénéfice financier du contrôle. Divisez par le coût annuel du contrôle et vous obtenez le ROI. C'est ce calcul qui justifie chaque investissement de sécurité auprès du directeur financier.

**L'agrégation à l'échelle du registre des risques.** Si chaque risque majeur dispose d'un ALE, vous pouvez les additionner sur l'ensemble du registre (avec une gestion appropriée des corrélations) pour produire une **perte attendue au niveau du portefeuille**. Vous pouvez désormais parler du risque cyber de la même manière que le directeur financier parle du risque de crédit ou du risque opérationnel : au niveau du portefeuille, et non incident par incident.

## Les objections que vous rencontrerez

Objections courantes, et comment y répondre :

- *« Nous n'avons pas assez de données. »* Il n'en faut pas beaucoup. La fourchette honnête « entre 500 K€ et 5 M€, avec un scénario le plus probable autour de 1,5 M€ » suffit pour une distribution triangulaire. Affinez au fil du temps à mesure que les données s'accumulent.
- *« Les chiffres seront faux. »* Tous les chiffres de risque sont faux. Les notations qualitatives le sont aussi, mais elles le dissimulent derrière des couleurs. Les chiffres quantitatifs exposent l'incertitude d'une manière que le comité d'audit peut challenger. C'est une qualité, pas un défaut.
- *« C'est trop compliqué à communiquer. »* Montrez le P95, la moyenne et le pire scénario. Cela fait trois chiffres. Les conseils d'administration travaillent déjà exactement avec ce format pour le risque de crédit, le risque de marché et le risque opérationnel.

## Par où commencer

La démarche pragmatique pour la plupart des équipes sécurité :

1. Sélectionnez vos **cinq risques principaux** dans le registre existant.
2. Recueillez des **estimations à trois points** pour le SLE et l'ARO de chacun, lors d'un atelier réunissant risque, sécurité, finance et juridique.
3. Exécutez une **simulation de Monte Carlo**. La plupart des outils de quantification du risque modernes intègrent cette fonctionnalité en standard, avec 10 000 itérations exécutées en moins d'une seconde.
4. Présentez, la première fois, ces résultats **aux côtés de la heatmap existante**, afin que le comité d'audit puisse comparer et développer son intuition.
5. Itérez trimestriellement. Les chiffres s'amélioreront à mesure que vous accumulerez des données d'incidents et de sinistres d'assurance.

Après deux ou trois trimestres, le comité d'audit commencera à demander les chiffres quantitatifs en premier et la heatmap en second. Après quatre trimestres, il cessera de demander la heatmap.

## En conclusion

L'analyse quantitative du risque ne remplace pas le jugement de sécurité. C'est un **langage** permettant de communiquer ce jugement aux personnes qui allouent le capital. La matrice 5x5 a été conçue pour que les équipes sécurité parlent à d'autres équipes sécurité. Le conseil d'administration n'est pas une équipe sécurité. C'est un comité d'allocation de capital. Parlez leur langage et vos propositions d'investissement en sécurité auront bien plus de succès.
`,
    faqs: [
      {
        q: "Quelle est la différence entre l'analyse de risque qualitative et quantitative ?",
        a: "L'analyse qualitative utilise des notations descriptives (élevé/moyen/faible, heatmaps colorées) pour comparer les risques. L'analyse quantitative utilise des chiffres financiers assortis de distributions de probabilité pour estimer la perte attendue. Le qualitatif est plus rapide et plus simple ; le quantitatif est plus défendable et plus exploitable pour les décisions d'allocation de capital.",
      },
      {
        q: "Qu'est-ce que la méthodologie FAIR ?",
        a: "Factor Analysis of Information Risk (FAIR) est un référentiel standardisé pour l'analyse quantitative du risque cyber, développé par Jack Jones et adopté par l'Open Group. Il décompose le risque en Fréquence des Événements de Perte et Ampleur des Pertes, chacune mesurable via des sous-facteurs. Les analyses FAIR sont généralement combinées à une simulation de Monte Carlo.",
      },
      {
        q: "Combien d'itérations de Monte Carlo sont suffisantes ?",
        a: "Pour la plupart des applications de risque cyber, 10 000 itérations produisent des estimations de centiles stables (P90, P95, P99) à 1-2 % près de la valeur asymptotique. Passer à 100 000 itérations affine la queue de distribution mais modifie rarement les seuils de décision. En dessous de 1 000 itérations, les indicateurs de queue ne sont pas fiables.",
      },
      {
        q: "Qu'est-ce que le P95 dans la quantification du risque ?",
        a: "Le P95 est le 95ᵉ centile de la distribution simulée des pertes annuelles : le montant de perte qui n'est dépassé que dans 5 % des cas. Il est couramment utilisé comme seuil de « valeur à risque » pour dimensionner les plafonds d'assurance cyber et le capital de réserve. Il est plus conservateur que la moyenne (ALE) et moins extrême que le pire scénario.",
      },
      {
        q: "Peut-on réaliser une analyse quantitative du risque sans formation en statistiques ?",
        a: "Oui. De nombreux outils modernes de quantification du risque intègrent un moteur de Monte Carlo qui prend en entrée de simples estimations à trois points (bas, le plus probable, haut) et produit des distributions complètes. La courbe d'apprentissage conceptuelle tient en un après-midi. La discipline opérationnelle continue consiste à recueillir et mettre à jour les estimations, pas à faire les calculs.",
      },
    ],
  },
  ar: {
    title: "شرح القياس الكمي للمخاطر: من الخرائط الحرارية إلى محاكاة مونت كارلو",
    metaTitle: "القياس الكمي للمخاطر: من الخرائط الحرارية إلى Monte Carlo",
    metaDescription:
      "كيفية تحويل تقييمات المخاطر النوعية إلى أرقام مالية يفهمها مجلس الإدارة. ALE وSLE وP90/P95، ومحاكاة مونت كارلو التي تحل محل تخمينات المصفوفة 5×5.",
    keywords:
      "القياس الكمي للمخاطر, ALE SLE المخاطر السيبرانية, محاكاة مونت كارلو المخاطر السيبرانية, منهجية FAIR, التحليل الكمي للمخاطر, الأثر المالي للمخاطر السيبرانية",
    excerpt:
      "لم تعد مجالس الإدارة تقتنع بتصنيف «مرتفع-متوسط-منخفض». إليك كيفية تحويل تقييمات المخاطر النوعية إلى اللغة المالية التي يستخدمها المدير المالي، باستخدام أساليب إحصائية معتمدة في القطاع المالي منذ ثلاثين عامًا.",
    body: `
## مصفوفة 5×5 لم تعد كافية

إذا أخبر تقرير المخاطر الأخير الخاص بك لجنة التدقيق بأن «خطر اختراق البيانات مرتفع، والأثر على الأعمال مرتفع، والمعالجة جارية»، وسألت لجنة التدقيق «مرتفع مقارنة بماذا؟»، فأنت بذلك قد واجهت بالفعل حدود إدارة المخاطر النوعية. لا يمكن لثلاثة ألوان وخريطة حرارية أن تجيب عن أسئلة مثل:

- كم يجب أن نخصص من الميزانية للتأمين السيبراني في العام المقبل؟
- هل تحقق 4 ملايين يورو التي ننفقها على EDR عائدًا؟
- أي من هذين الاستثمارين في الضوابط يقلل المخاطر أكثر لكل يورو يُنفق؟

للإجابة عن هذه الأسئلة، تحتاج إلى أرقام. وتحديدًا، **أرقام مالية مصحوبة بفترات ثقة**. الخبر السار هو أن الأساليب اللازمة لإنتاج هذه الأرقام مستخدمة منذ عقود في العلوم الاكتوارية والتمويل وموثوقية الهندسة. وأخيرًا بدأت المخاطر السيبرانية تلحق بالركب.

## المصطلحات الأساسية

قبل المتابعة، هناك ثلاثة مصطلحات يجب أن يتقنها كل رئيس أمن معلومات:

- **SLE (توقع الخسارة الفردية):** المبلغ المالي الذي تخسره في حال وقوع حدث خطر معين مرة واحدة. بالنسبة لاختراق البيانات: تكلفة التحقيق + الإخطار + التكاليف القانونية + الغرامات التنظيمية + المعالجة + فقدان العملاء. وعادة ما يكون نطاقًا وليس رقمًا واحدًا.
- **ARO (المعدل السنوي للوقوع):** التكرار المتوقع للحدث سنويًا. وغالبًا ما يكون كسرًا (حدث يتكرر كل 5 سنوات له ARO يساوي 0.2).
- **ALE (توقع الخسارة السنوية):** SLE × ARO. الخسارة السنوية المتوقعة من هذا الخطر، بالعملة. وهذا هو الرقم الذي يفهمه المدير المالي.

حتى هذه المرحلة، الأمر مجرد عملية حسابية بسيطة. الصعوبة تكمن في أن SLE وARO ليسا رقمين ثابتين، بل توزيعات احتمالية. فقد يتراوح تكلفة اختراق البيانات بين 500 ألف يورو و15 مليون يورو حسب عدد السجلات المتأثرة والولاية القضائية وكيفية سير الاستجابة. وقد يتراوح ARO بين مرة كل سنتين لحدث محتمل الوقوع، ومرة كل 30 عامًا لحدث نادر الحدوث شديد الأثر.

## لماذا تضلّل التقديرات النقطية

لنفترض أنك أخبرت مجلس الإدارة: «توقع الخسارة السنوية لهجوم فدية هو 1.2 مليون يورو». سيفهمون ذلك على أنه الإجابة النهائية. لكن خلف هذا الرقم الواحد يكمن توزيع واسع: ربما 50% من السيناريوهات المحتملة تكلف بين 200 ألف و500 ألف يورو، و30% تكلف بين مليون و3 ملايين يورو، و15% تكلف بين 5 و20 مليون يورو، و5% تكلف أكثر من 20 مليون يورو. رقم 1.2 مليون يورو هو المتوسط. وهو أيضًا الرقم الذي نادرًا ما يحدث فعليًا: فالخسارة الفعلية إما أصغر بكثير أو أكبر بكثير.

تتخذ مجالس الإدارة قرارات تخصيص رأس المال بناءً على مخاطر الذيل (tail risk) لا على المتوسطات. فإذا كان أسوأ سيناريو هو 20 مليون يورو باحتمال 5%، فهذا يعني خسارة ذيل متوقعة تبلغ مليون يورو يجب على المجلس أن يرصد لها رأس مال منفصل. وإذا اكتفيت بعرض المتوسط البالغ 1.2 مليون يورو فقط، فلن يُتخذ هذا القرار أبدًا.

## محاكاة مونت كارلو بلغة مبسطة

محاكاة مونت كارلو هي التقنية المعيارية للتعامل مع التوزيعات بدلاً من التقديرات النقطية. وتتم الإجراءات كالتالي:

1. لكل متغير مدخل (SLE، ARO)، حدّد **توزيعًا احتماليًا**، عادة ما يكون مثلثيًا أو لوغاريتميًا طبيعيًا، بين تقدير منخفض وتقدير الأرجح وتقدير مرتفع.
2. **شغّل المحاكاة 10,000 مرة أو أكثر.** تسحب كل عملية تكرار عينة عشوائية من كل توزيع مدخل وتحسب الخسارة السنوية الناتجة.
3. **اجمع النتائج** في توزيع للخسائر السنوية عبر جميع عمليات التكرار.
4. استخرج المؤشرات المهمة: المتوسط (ALE)، الوسيط، P90 (الخسارة عند المئين التسعين)، P95، P99.

وتبدو النتيجة كالتالي:

- متوسط الخسارة السنوية: **1.2 مليون يورو**
- الخسارة السنوية الوسيطة: **450 ألف يورو**
- P90 (تكون الخسارة في 90% من الحالات أقل من أو تساوي هذا الرقم): **2.8 مليون يورو**
- P95: **5.1 مليون يورو**
- P99: **18 مليون يورو**

هذه هي الأرقام التي يمكن للمدير المالي ولجنة التدقيق لديك التصرف بناءً عليها. ويُستخدم P95 على وجه الخصوص كعتبة «القيمة المعرضة للخطر» الشائعة: وهو الرقم المستخدم لتحديد حدود التأمين السيبراني ورأس المال الاحتياطي.

## FAIR: المنهجية الكامنة وراء الأرقام

منهجية Factor Analysis of Information Risk (FAIR)، التي طورها Jack Jones ووحّدتها Open Group، هي الإطار السائد للتحليل الكمي للمخاطر السيبرانية. تفكك FAIR الخطر إلى تكرار أحداث الخسارة وحجم الخسارة، ويُفصَّل كل منهما إلى عوامل فرعية قابلة للقياس. ونتيجة تحليل FAIR هي بالضبط نوع التوزيع الذي صُممت محاكاة مونت كارلو لمعالجته.

لست بحاجة إلى أن تكون محللًا معتمدًا في FAIR للبدء. نقطة انطلاق معقولة هي:

- لكل خطر رئيسي في سجلك، اجمع **ثلاثة تقديرات** (أفضل سيناريو، الأرجح، أسوأ سيناريو) لكل من التكرار السنوي والخسارة لكل حدث.
- استخدم توزيعًا مثلثيًا ما لم تتوفر لديك بيانات لملاءمة توزيع لوغاريتمي طبيعي.
- شغّل 10,000 عملية تكرار.
- تحقق من صحة النتائج مقارنة بمعايير القطاع (Verizon DBIR، IBM Cost of Data Breach، Allianz Cyber Risk Report).

إذا أظهرت نتائجك أن الخسارة السنوية من هجمات الفدية تبلغ 15 مليون يورو بينما يضع تقرير IBM متوسط خسارة هجمات الفدية عند 5 ملايين يورو، فإما أن مدخلاتك متشائمة أكثر مما ينبغي، أو أنك تعمل في بيئة أكثر عرضة للمخاطر من المعتاد، وفي هذه الحالة وثّق السبب.

## ما الذي يتيحه ذلك

ينتج القياس الكمي للمخاطر ثلاثة أمور لا يوفرها التقييم النوعي.

**ميزانية تأمين سيبراني قابلة للدفاع عنها.** تسعّر شركات التأمين التغطية كدالة للخسارة المتوقعة زائدًا هامش المخاطرة. فإذا استطعت تقديم رقم P95، يمكن لوسيط التأمين الخاص بك التفاوض استنادًا إليه. أما إذا لم تستطع، فستقبل ما يعرضه المكتتب.

**حساب العائد على الاستثمار للضوابط.** يقلل الضابط من ARO أو SLE أو كليهما. فإذا أعدت تشغيل محاكاة مونت كارلو بالمدخلات بعد تطبيق الضابط، يمثل الفرق في ALE الفائدة المالية للضابط. اقسمه على التكلفة السنوية للضابط لتحصل على العائد على الاستثمار. وهذا هو الحساب الذي يبرر كل استثمار أمني أمام المدير المالي.

**التجميع عبر سجل المخاطر بأكمله.** إذا كان لكل خطر رئيسي قيمة ALE خاصة به، يمكنك جمعها عبر السجل بأكمله (مع معالجة مناسبة للترابطات) لإنتاج **خسارة متوقعة على مستوى المحفظة**. وبذلك يمكنك الحديث عن المخاطر السيبرانية بنفس الطريقة التي يتحدث بها المدير المالي عن مخاطر الائتمان أو المخاطر التشغيلية: على مستوى المحفظة، وليس حادثة بحادثة.

## الاعتراضات التي ستواجهها

اعتراضات شائعة وكيفية الرد عليها:

- *«ليس لدينا بيانات كافية.»* لست بحاجة إلى الكثير. النطاق الصادق «بين 500 ألف يورو و5 ملايين يورو، مع سيناريو أرجح يبلغ نحو 1.5 مليون يورو» كافٍ لتوزيع مثلثي. حسّن التقديرات تدريجيًا مع تراكم البيانات.
- *«ستكون الأرقام خاطئة.»* جميع أرقام المخاطر خاطئة إلى حد ما. والتقييمات النوعية خاطئة أيضًا، لكنها تخفي ذلك خلف الألوان. الأرقام الكمية تكشف عدم اليقين بطريقة تتيح للجنة التدقيق مساءلتها. وهذه ميزة، لا عيب.
- *«الأمر معقد جدًا للتواصل بشأنه.»* اعرض P95 والمتوسط وأسوأ سيناريو. هذه ثلاثة أرقام فقط. مجالس الإدارة تعمل بالفعل بهذا الشكل تمامًا في مخاطر الائتمان ومخاطر السوق والمخاطر التشغيلية.

## من أين تبدأ

المسار العملي لمعظم فرق الأمن:

1. اختر **أهم خمسة مخاطر** من السجل الحالي.
2. اجمع **تقديرات من ثلاث نقاط** لـ SLE وARO لكل منها، في ورشة عمل تضم فرق المخاطر والأمن والمالية والشؤون القانونية.
3. شغّل **محاكاة مونت كارلو**. تتضمن معظم أدوات القياس الكمي للمخاطر الحديثة هذه الميزة جاهزة، مع اكتمال 10,000 عملية تكرار في أقل من ثانية.
4. اعرض النتائج **جنبًا إلى جنب مع الخريطة الحرارية الحالية** في المرة الأولى، حتى تتمكن لجنة التدقيق من المقارنة وتكوين حدس حولها.
5. كرر العملية كل ربع سنة. ستتحسن الأرقام مع تراكم بيانات الحوادث وبيانات مطالبات التأمين.

بعد ربعين أو ثلاثة أرباع، ستبدأ لجنة التدقيق بطلب الأرقام الكمية أولاً والخريطة الحرارية ثانيًا. وبعد أربعة أرباع، ستتوقف عن طلب الخريطة الحرارية أصلاً.

## خاتمة

التحليل الكمي للمخاطر ليس بديلاً عن الحكم الأمني، بل هو **لغة** للتواصل بهذا الحكم مع من يتخذون قرارات تخصيص رأس المال. صُممت مصفوفة 5×5 لتخاطب فرق الأمن بعضها بعضًا. أما مجلس الإدارة فليس فريق أمن، بل لجنة تخصيص رأس مال. تحدّث بلغتهم، وستحقق مقترحات استثمارك الأمني نجاحًا أكبر بكثير.
`,
    faqs: [
      {
        q: "ما الفرق بين التحليل النوعي والكمي للمخاطر؟",
        a: "يستخدم التحليل النوعي تقييمات وصفية (مرتفع/متوسط/منخفض، خرائط حرارية ملونة) لمقارنة المخاطر. أما التحليل الكمي فيستخدم أرقامًا مالية مصحوبة بتوزيعات احتمالية لتقدير الخسارة المتوقعة. التحليل النوعي أسرع وأبسط؛ بينما التحليل الكمي أكثر قابلية للدفاع عنه وأكثر فائدة في قرارات تخصيص رأس المال.",
      },
      {
        q: "ما هي منهجية FAIR؟",
        a: "Factor Analysis of Information Risk (FAIR) هو إطار موحّد للتحليل الكمي للمخاطر السيبرانية، طوّره Jack Jones واعتمدته Open Group. يفكك الخطر إلى تكرار أحداث الخسارة وحجم الخسارة، وكل منهما قابل للقياس عبر عوامل فرعية. وعادة ما تُدمج تحليلات FAIR مع محاكاة مونت كارلو.",
      },
      {
        q: "كم عدد عمليات تكرار مونت كارلو الكافية؟",
        a: "بالنسبة لمعظم تطبيقات المخاطر السيبرانية، تنتج 10,000 عملية تكرار تقديرات مئينية مستقرة (P90، P95، P99) بهامش خطأ 1-2% من القيمة النهائية. الانتقال إلى 100,000 عملية تكرار يحسّن دقة الذيل لكنه نادرًا ما يغيّر عتبات القرار. وأي عدد أقل من 1,000 عملية تكرار يُعتبر غير موثوق بالنسبة لمؤشرات الذيل.",
      },
      {
        q: "ما هو P95 في القياس الكمي للمخاطر؟",
        a: "P95 هو المئين الخامس والتسعون من توزيع الخسارة السنوية المحاكاة: رقم الخسارة الذي لا يُتجاوز إلا في 5% من الحالات. ويُستخدم عادة كعتبة «القيمة المعرضة للخطر» لتحديد حدود التأمين السيبراني ورأس المال الاحتياطي. وهو أكثر تحفظًا من المتوسط (ALE) وأقل تطرفًا من أسوأ سيناريو.",
      },
      {
        q: "هل يمكنني إجراء تحليل كمي للمخاطر دون خلفية إحصائية؟",
        a: "نعم. تتضمن كثير من أدوات القياس الكمي للمخاطر الحديثة محرك مونت كارلو يأخذ تقديرات بسيطة من ثلاث نقاط (منخفض، الأرجح، مرتفع) وينتج توزيعات كاملة. منحنى التعلم النظري لا يتجاوز فترة بعد ظهر واحدة. أما الانضباط التشغيلي المستمر فيتمثل في جمع التقديرات وتحديثها، لا في إجراء الحسابات.",
      },
    ],
  },
};

export default translations;
