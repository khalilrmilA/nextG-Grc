import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title: "Directive NIS2 expliquée : ce que les RSSI doivent savoir en 2026",
    metaTitle: "Directive NIS2 expliquée : ce que les RSSI doivent savoir en 2026",
    metaDescription:
      "Guide pratique NIS2 pour RSSI : périmètre, obligations, délais de notification d'incidents, règles de chaîne d'approvisionnement, sanctions, et cartographie des contrôles ISO 27001.",
    keywords:
      "directive NIS2, exigences NIS2, conformité NIS2, NIS2 RSSI, NIS2 vs NIS, notification d'incident NIS2, chaîne d'approvisionnement NIS2",
    excerpt:
      "Deux ans après sa publication, l'application de NIS2 est désormais une réalité quotidienne pour les RSSI dans toute l'UE. Voici le guide pratique du périmètre, des obligations, des échéances, et de la manière de tirer parti des contrôles déjà en place.",
    body: `
## Pourquoi NIS2 compte maintenant

NIS2 (directive (UE) 2022/2555) a remplacé la directive NIS originale en octobre 2024 et a considérablement élargi les obligations de cybersécurité des organisations de l'UE. Deux ans plus tard, les autorités nationales de surveillance sont passées de la pédagogie à l'application active. Des amendes ont déjà été prononcées aux Pays-Bas, en Belgique et en Italie.

Si vous êtes RSSI dans l'un des dix-huit secteurs couverts par NIS2 (énergie, transport, banque, infrastructures des marchés financiers, santé, eau potable, eaux usées, infrastructures numériques, gestion des services TIC, administration publique, espace, services postaux, gestion des déchets, fabrication de produits chimiques, alimentation, fabrication de dispositifs médicaux, fabrication de composants électroniques, fabrication de véhicules, ou fournisseurs numériques), votre conseil d'administration va poser trois questions en 2026 :

1. Sommes-nous concernés par le périmètre ?
2. Que nous impose réellement NIS2 ?
3. À quel niveau de risque sommes-nous exposés en cas de manquement ?

Cet article vous apporte des réponses défendables aux trois questions.

## Qui est concerné

NIS2 distingue les **entités essentielles** (annexe I) et les **entités importantes** (annexe II), avec des régimes de surveillance plus stricts pour les entités essentielles. Les deux catégories s'appliquent généralement aux organisations comptant **au moins 50 employés et 10 M€ de chiffre d'affaires annuel**, bien que certains secteurs (infrastructures numériques, prestataires de services de confiance qualifiés, registres de domaines de premier niveau) n'aient aucun seuil de taille.

Trois éléments surprennent souvent les RSSI qui examinent le périmètre pour la première fois :

- **Les filiales comptent.** Une filiale européenne de taille moyenne d'un géant technologique américain peut être concernée même si la société mère ne l'est pas.
- **La classification sectorielle est plus large que sous NIS1.** Les fabricants de dispositifs médicaux et de véhicules sont désormais explicitement couverts. Il en va de même pour les services postaux et de messagerie.
- **Les États membres peuvent étendre le périmètre.** Plusieurs pays, dont l'Allemagne et la France, ont adopté une transposition nationale qui couvre des entités supplémentaires non listées dans la directive européenne.

Si vous ne pouvez pas répondre de manière définitive à la question « sommes-nous concernés ? » d'ici la fin du T2 2026, c'est en soi un constat problématique. Documentez l'analyse de périmètre, obtenez la validation du service juridique, et révisez-la chaque année.

## Les dix obligations de sécurité (article 21)

NIS2 prescrit un socle de mesures de gestion des risques. Elles sont volontairement axées sur les résultats plutôt que prescriptives, ce qui est un avantage pour les RSSI qui gèrent déjà des programmes ISO 27001 ou NIST CSF, car la plupart des contrôles se cartographient directement. Les dix domaines :

- **Analyse des risques et politiques de sécurité de l'information** : documentées, revues annuellement, approuvées par le conseil d'administration.
- **Gestion des incidents** : incluant les procédures de détection, de réponse et de rétablissement.
- **Continuité d'activité** : gestion des sauvegardes, reprise après sinistre et gestion de crise.
- **Sécurité de la chaîne d'approvisionnement** : sécurité des relations entre une entité et ses fournisseurs directs.
- **Sécurité des réseaux et des systèmes d'information** : y compris les procédures d'acquisition, de développement et de maintenance des systèmes.
- **Politiques et procédures d'évaluation de l'efficacité des mesures de gestion des risques de cybersécurité** : incluant l'évaluation de l'efficacité, tests et audits.
- **Pratiques de base en matière d'hygiène informatique et formation à la cybersécurité** : pour le personnel.
- **Politiques de cryptographie** : chiffrement et gestion des clés.
- **Sécurité des ressources humaines, contrôle d'accès et gestion des actifs.**
- **Authentification multifactorielle, communications vocales, vidéo et textuelles sécurisées, et systèmes de communication d'urgence.**

Si vous exploitez un SMSI ISO 27001:2022 actif, vous couvrez déjà 90 % de l'article 21 de NIS2 grâce à l'annexe A. Les correspondances publiées par l'ENISA le confirment. NIS2 exige spécifiquement que vous **documentiez la cartographie**, et non que vous réimplémentiez les contrôles.

## Délais de notification des incidents

C'est là que NIS2 exerce une réelle pression sur le SOC et la fonction de réponse aux incidents. La directive impose trois notifications successives au CSIRT national ou à l'autorité compétente :

- **Alerte précoce : sous 24 heures.** Notifier qu'un incident *pourrait* être en cours. Indiquer s'il semble causé par des actions malveillantes et s'il pourrait avoir un impact transfrontalier.
- **Notification d'incident : sous 72 heures.** Fournir une évaluation initiale de la gravité, de l'impact et des indicateurs de compromission.
- **Rapport final : sous un mois.** Description détaillée, cause racine, mesures d'atténuation appliquées/en cours, et impact transfrontalier.

Deux implications pratiques :

1. **Votre plan de réponse aux incidents a besoin de délais NIS2 explicites.** La plupart des plans existants sont calibrés sur la notification de violation de 72 heures du RGPD. NIS2 ajoute un délai de 24 heures pour un incident « pouvant être en cours ». Nettement plus serré.
2. **La notion d'incident significatif est définie largement.** La directive considère un incident comme significatif s'il a causé ou est susceptible de causer une perturbation opérationnelle grave ou une perte financière, ou s'il a affecté (ou est susceptible d'affecter) d'autres personnes physiques ou morales par des dommages matériels ou immatériels considérables. En cas de doute, privilégiez la notification.

## Sécurité de la chaîne d'approvisionnement : la partie que tout le monde sous-estime

L'article 21(2)(d) impose aux entités de traiter « la sécurité de la chaîne d'approvisionnement, y compris les aspects liés à la sécurité concernant les relations entre chaque entité et ses fournisseurs directs ou prestataires de services ». En clair : NIS2 veut voir des **preuves de gestion du risque fournisseur**.

Cela signifie :

- Un inventaire documenté des fournisseurs avec une hiérarchisation des risques.
- Des évaluations de sécurité avant l'intégration des fournisseurs critiques.
- Des clauses contractuelles obligeant les fournisseurs à maintenir la sécurité et à notifier les incidents.
- Un suivi continu de la posture de risque des fournisseurs, en particulier pour les prestataires de services TIC critiques.

Cette obligation recoupe largement DORA (pour les entités financières) et ce que font déjà la plupart des programmes de sécurité matures. La différence est que NIS2 la rend **légale**, et les autorités de surveillance peuvent en exiger la preuve.

## Gouvernance et responsabilités de l'organe de direction

L'article 20 impose des obligations directement à l'**organe de direction** des entités concernées. Les dirigeants (membres du conseil, cadres exécutifs) doivent :

- Approuver les mesures de gestion des risques de cybersécurité.
- Superviser leur mise en œuvre.
- Recevoir une formation régulière en cybersécurité.

C'est le changement culturel le plus important introduit par NIS2 par rapport à NIS1. Si votre conseil d'administration ne reçoit pas de briefings trimestriels sur la cybersécurité avec des registres de formation documentés, un constat de non-conformité est à prévoir.

## Sanctions et responsabilité personnelle

Amendes administratives maximales prévues par NIS2 :

- **Entités essentielles :** jusqu'à 10 M€ ou 2 % du chiffre d'affaires annuel mondial total, le montant le plus élevé étant retenu.
- **Entités importantes :** jusqu'à 7 M€ ou 1,4 % du chiffre d'affaires annuel mondial total, le montant le plus élevé étant retenu.

Plusieurs États membres ont en outre introduit une **responsabilité personnelle** pour les cadres dirigeants en cas de non-conformité répétée. Les Pays-Bas et la Belgique peuvent suspendre des cadres exécutifs de leur rôle de supervision de la cybersécurité. Il s'agit d'un changement structurel que les RSSI doivent présenter directement à leur conseil d'administration.

## Une checklist pragmatique de préparation à NIS2

Si vous voulez aborder une inspection de surveillance avec sérénité, le portefeuille minimal comprend :

- Une **note de cadrage** confirmant la classification de l'entité et les obligations applicables.
- Une **politique de sécurité de l'information** approuvée par l'organe de direction au cours des 12 derniers mois.
- Un **registre des risques** avec des décisions de traitement documentées.
- Des **procédures de réponse aux incidents** intégrant explicitement les délais de notification NIS2.
- Un **plan de continuité d'activité** avec au moins un exercice de reprise testé par an.
- Un **inventaire des fournisseurs** avec hiérarchisation des risques et évaluations de sécurité pour les fournisseurs critiques.
- Des **registres de formation** pour le personnel et l'organe de direction couvrant la sensibilisation à la cybersécurité.
- Un **plan de continuité des opérations** pour la fonction cybersécurité elle-même.

Une [plateforme GRC](/features-landing) dédiée peut produire ce portefeuille comme un sous-produit naturel du fonctionnement courant, plutôt que comme un projet de conformité distinct. C'est toute la différence entre subir NIS2 comme un exercice trimestriel d'urgence et l'intégrer en continu dans le fonctionnement de la fonction.

## Réflexion finale

NIS2 est l'une des rares réglementations où être une organisation de sécurité solide vous rend automatiquement conforme. La plupart des obligations décrivent ce que font déjà les équipes de sécurité matures. L'attente de la supervision est que vous puissiez **le prouver sur demande** : note de cadrage, politiques, registre des risques, journaux d'incidents, preuves fournisseurs, registres de formation, comptes rendus du conseil. Si vous pouvez produire ce dossier en 48 heures lorsqu'une autorité le demande, vous êtes en bonne posture. Sinon, l'écart relève de la discipline opérationnelle plutôt que d'une capacité manquante, et cela se corrige en un trimestre.
`,
    faqs: [
      {
        q: "NIS2 est-elle identique à la directive NIS originale ?",
        a: "Non. NIS2 (directive (UE) 2022/2555) a remplacé la directive NIS originale en octobre 2024. Elle a étendu le périmètre sectoriel de 7 à 18 secteurs, introduit des obligations directes pour les organes de direction, établi des délais de notification d'incidents plus stricts, et considérablement augmenté les sanctions.",
      },
      {
        q: "Quel est le lien entre NIS2 et le RGPD ?",
        a: "Le RGPD régit les données personnelles ; NIS2 régit la sécurité des réseaux et des systèmes d'information. Ils se recoupent sur la notification d'incidents mais s'appliquent à des catégories d'incidents différentes. Une violation de données personnelles est notifiable au titre du RGPD (sous 72 heures), et si cette même violation affecte également des opérations ou services critiques, elle est aussi notifiable au titre de NIS2 (alerte précoce sous 24 heures).",
      },
      {
        q: "Les petites entreprises doivent-elles se conformer à NIS2 ?",
        a: "En général, NIS2 s'applique aux entités moyennes et grandes (≥50 employés, ≥10 M€ de chiffre d'affaires). Cependant, certains secteurs (fournisseurs DNS, registres de domaines de premier niveau, prestataires de services de confiance qualifiés, administration publique) s'appliquent quelle que soit la taille. Certains États membres ont également étendu le périmètre au niveau national. Vérifiez toujours la transposition nationale spécifique à votre pays.",
      },
      {
        q: "La certification ISO 27001 peut-elle couvrir NIS2 ?",
        a: "ISO 27001:2022 couvre la plupart des obligations de l'article 21 de NIS2 via les contrôles de l'annexe A, mais ISO 27001 seule n'est pas suffisante. NIS2 exige également l'implication explicite de l'organe de direction, les délais spécifiques de notification d'incidents (24h/72h/1 mois), et des obligations de coopération avec les autorités de surveillance qui dépassent le périmètre d'un SMSI. Considérez ISO 27001 comme la fondation, pas comme la destination finale.",
      },
      {
        q: "Quelle est l'amende maximale en cas de non-conformité à NIS2 ?",
        a: "Pour les entités essentielles : jusqu'à 10 millions d'euros ou 2 % du chiffre d'affaires annuel mondial total, le montant le plus élevé étant retenu. Pour les entités importantes : jusqu'à 7 millions d'euros ou 1,4 % du chiffre d'affaires. Plusieurs États membres ont également introduit des dispositions de responsabilité personnelle pour les cadres dirigeants en cas de non-conformité répétée.",
      },
    ],
  },
  ar: {
    title: "توجيه NIS2 بالتفصيل: ما يحتاج مسؤولو أمن المعلومات (CISO) معرفته في 2026",
    metaTitle: "توجيه NIS2 بالتفصيل: ما يحتاج مسؤولو أمن المعلومات معرفته في 2026",
    metaDescription:
      "دليل عملي لمسؤولي أمن المعلومات حول NIS2: النطاق، الالتزامات، مهل الإبلاغ عن الحوادث، قواعد سلسلة التوريد، العقوبات، وكيفية ربط ضوابط ISO 27001 الحالية.",
    keywords:
      "توجيه NIS2, متطلبات NIS2, الامتثال لـ NIS2, NIS2 لمسؤول أمن المعلومات, الفرق بين NIS2 و NIS, الإبلاغ عن الحوادث NIS2, أمن سلسلة التوريد NIS2",
    excerpt:
      "بعد عامين من نشره، أصبح تطبيق NIS2 واقعاً يومياً لمسؤولي أمن المعلومات في الاتحاد الأوروبي. إليك الدليل العملي حول النطاق والالتزامات والمهل الزمنية، وكيفية الاستفادة القصوى من الضوابط الموجودة لديك بالفعل.",
    body: `
## لماذا يهم توجيه NIS2 الآن

حلّ توجيه NIS2 (التوجيه (EU) 2022/2555) محل توجيه NIS الأصلي في أكتوبر 2024، ووسّع بشكل كبير التزامات الأمن السيبراني لمؤسسات الاتحاد الأوروبي. بعد مرور عامين، انتقلت السلطات الرقابية الوطنية من مرحلة التوعية إلى التطبيق الفعلي. وقد فُرضت غرامات بالفعل في هولندا وبلجيكا وإيطاليا.

إذا كنت مسؤول أمن معلومات (CISO) في أي من القطاعات الثمانية عشر التي يغطيها NIS2 (الطاقة، النقل، المصارف، البنية التحتية للأسواق المالية، الصحة، مياه الشرب، مياه الصرف الصحي، البنية التحتية الرقمية، إدارة خدمات تقنية المعلومات والاتصالات، الإدارة العامة، الفضاء، الخدمات البريدية، إدارة النفايات، تصنيع الكيماويات، الأغذية، تصنيع الأجهزة الطبية، تصنيع الإلكترونيات، تصنيع المركبات، أو مزوّدي الخدمات الرقمية)، فإن مجلس إدارتك سيطرح ثلاثة أسئلة في 2026:

1. هل نحن مشمولون بنطاق التوجيه؟
2. ما الذي يتطلبه NIS2 منا فعلياً؟
3. ما مدى تعرّضنا للمخاطر في حال عدم الامتثال؟

يقدّم هذا المقال إجابات قابلة للدفاع عن الأسئلة الثلاثة.

## من هو المشمول بالنطاق

يميّز NIS2 بين **الكيانات الأساسية** (الملحق الأول) و**الكيانات المهمة** (الملحق الثاني)، مع أنظمة رقابية أكثر صرامة للكيانات الأساسية. تنطبق الفئتان عموماً على المؤسسات التي لديها **50 موظفاً على الأقل و10 ملايين يورو من الإيرادات السنوية على الأقل**، رغم أن بعض القطاعات (البنية التحتية الرقمية، مزوّدي خدمات الثقة المؤهّلين، سجلات النطاقات العليا) لا تخضع لأي حد أدنى من الحجم.

ثلاثة أمور غالباً ما تفاجئ مسؤولي أمن المعلومات عند مراجعة النطاق لأول مرة:

- **الشركات التابعة مشمولة.** يمكن أن تكون شركة تابعة أوروبية متوسطة الحجم لعملاق تقني أمريكي مشمولة بالنطاق حتى لو لم تكن الشركة الأم كذلك.
- **التصنيف القطاعي أوسع مما كان عليه في NIS1.** أصبح مصنّعو الأجهزة الطبية والمركبات مشمولين صراحةً. وكذلك خدمات البريد والشحن السريع.
- **يمكن للدول الأعضاء توسيع النطاق.** قامت عدة دول، منها ألمانيا وفرنسا، بنقل التوجيه إلى تشريعاتها الوطنية بطريقة تشمل كيانات إضافية غير مدرجة في التوجيه الأوروبي.

إذا لم تتمكن من الإجابة بشكل قاطع عن سؤال "هل نحن مشمولون بالنطاق؟" بحلول نهاية الربع الثاني من 2026، فهذا في حد ذاته ملاحظة تستدعي المعالجة. وثّق تحليل النطاق، واحصل على موافقة الإدارة القانونية، وراجعه سنوياً.

## الالتزامات الأمنية العشرة (المادة 21)

يفرض NIS2 حداً أدنى من تدابير إدارة المخاطر. وهي مصمَّمة عمداً لتكون قائمة على النتائج لا التوجيه التفصيلي، وهو أمر إيجابي لمسؤولي أمن المعلومات الذين يديرون بالفعل برامج ISO 27001 أو NIST CSF، لأن معظم الضوابط تُربط مباشرة. المجالات العشرة:

- **تحليل المخاطر وسياسات أمن المعلومات**: موثّقة، تُراجع سنوياً، ويعتمدها مجلس الإدارة.
- **إدارة الحوادث**: بما في ذلك إجراءات الكشف والاستجابة والتعافي.
- **استمرارية الأعمال**: إدارة النسخ الاحتياطي، التعافي من الكوارث، وإدارة الأزمات.
- **أمن سلسلة التوريد**: أمن العلاقات بين الكيان ومورّديه المباشرين.
- **أمن الشبكات وأنظمة المعلومات**: بما في ذلك إجراءات اقتناء الأنظمة وتطويرها وصيانتها.
- **سياسات وإجراءات اختبار وتدقيق الأمن السيبراني**: بما في ذلك تقييم الفعالية.
- **ممارسات النظافة السيبرانية الأساسية والتدريب على الأمن السيبراني**: للموظفين.
- **سياسات التشفير**: التشفير وإدارة المفاتيح.
- **أمن الموارد البشرية، والتحكم في الوصول، وإدارة الأصول.**
- **المصادقة متعددة العوامل، والاتصالات الصوتية والمرئية والنصية الآمنة، وأنظمة الاتصال في حالات الطوارئ.**

إذا كان لديك نظام إدارة أمن المعلومات (ISMS) فعّال وفق ISO 27001:2022، فأنت بالفعل تغطي 90% من المادة 21 من NIS2 بفضل الملحق A. وتؤكد ذلك جداول المطابقة التي نشرتها وكالة الاتحاد الأوروبي للأمن السيبراني (ENISA). يتطلب NIS2 تحديداً أن **توثّق عملية الربط**، وليس إعادة تنفيذ الضوابط.

## مهل الإبلاغ عن الحوادث

هنا يفرض NIS2 ضغطاً حقيقياً على مركز العمليات الأمنية (SOC) ووظيفة الاستجابة للحوادث. يفرض التوجيه ثلاثة إشعارات متتالية ومتصاعدة إلى فريق الاستجابة لحوادث أمن الحاسوب الوطني (CSIRT) أو السلطة المختصة:

- **الإنذار المبكر: خلال 24 ساعة.** إخطار بأن هناك حادثاً *قد* يكون جارياً. تحديد ما إذا كان يبدو ناتجاً عن أفعال ضارة، وما إذا كان قد يكون له تأثير عابر للحدود.
- **إشعار الحادث: خلال 72 ساعة.** تقديم تقييم أولي للخطورة والتأثير ومؤشرات الاختراق.
- **التقرير النهائي: خلال شهر واحد.** وصف تفصيلي، السبب الجذري، إجراءات التخفيف المطبَّقة أو الجارية، والتأثير العابر للحدود.

نتيجتان عمليتان:

1. **يحتاج دليل الاستجابة للحوادث لديك إلى مؤقتات صريحة خاصة بـ NIS2.** معظم أدلة الاستجابة الحالية مضبوطة وفق مهلة الإبلاغ عن الخروقات البالغة 72 ساعة الخاصة بـ GDPR. يضيف NIS2 مؤقتاً بـ24 ساعة لحالة "قد يكون جارياً"، وهو أشد صرامة بكثير.
2. **مفهوم الحادث الجوهري واسع التعريف.** يعتبر التوجيه الحادث جوهرياً إذا تسبّب أو كان قادراً على التسبب في اضطراب تشغيلي حاد أو خسارة مالية، أو إذا أثّر (أو كان قادراً على التأثير) على أشخاص طبيعيين أو اعتباريين آخرين من خلال ضرر مادي أو غير مادي كبير. يُفضَّل الميل نحو الإبلاغ عند الشك.

## أمن سلسلة التوريد: الجزء الذي يستهين به الجميع

تُلزم المادة 21(2)(د) الكيانات بمعالجة "أمن سلسلة التوريد، بما في ذلك الجوانب المتعلقة بالأمن في العلاقات بين كل كيان ومورّديه المباشرين أو مزوّدي الخدمات". بعبارة أخرى: يريد NIS2 رؤية **أدلة على إدارة مخاطر المورّدين**.

وهذا يعني:

- جرد موثّق للمورّدين مع تصنيف حسب مستوى المخاطر.
- تقييمات أمنية قبل إشراك المورّدين الحرجين.
- بنود تعاقدية تُلزم المورّدين بالحفاظ على الأمن والإبلاغ عن الحوادث.
- مراقبة مستمرة لوضع المخاطر لدى المورّدين، خاصة مزوّدي خدمات تقنية المعلومات والاتصالات الحرجين.

يتقاطع هذا الالتزام بشكل كبير مع DORA (بالنسبة للكيانات المالية) ومع ما تقوم به بالفعل معظم برامج الأمن الناضجة. الفرق أن NIS2 يجعله **إلزامياً قانوناً**، ويمكن للسلطات الرقابية طلب إثباته.

## الحوكمة ومسؤوليات هيئة الإدارة

تفرض المادة 20 التزامات مباشرة على **هيئة الإدارة** للكيانات المشمولة بالنطاق. يجب على كبار القادة (أعضاء مجلس الإدارة، المسؤولين التنفيذيين):

- الموافقة على تدابير إدارة مخاطر الأمن السيبراني.
- الإشراف على تنفيذها.
- تلقّي تدريب منتظم على الأمن السيبراني.

هذا هو أكبر تحوّل ثقافي أدخله NIS2 مقارنة بـNIS1. إذا كان مجلس إدارتك لا يتلقى إحاطات ربع سنوية عن الأمن السيبراني مع سجلات تدريب موثّقة، فإن ملاحظة رقابية بانتظارك.

## العقوبات والمسؤولية الشخصية

الغرامات الإدارية القصوى بموجب NIS2:

- **الكيانات الأساسية:** حتى 10 ملايين يورو أو 2% من إجمالي الإيرادات السنوية العالمية، أيهما أعلى.
- **الكيانات المهمة:** حتى 7 ملايين يورو أو 1.4% من إجمالي الإيرادات السنوية العالمية، أيهما أعلى.

أدخلت عدة دول أعضاء بالإضافة إلى ذلك **مسؤولية شخصية** لكبار المديرين في حالات عدم الامتثال المتكرر. يمكن لهولندا وبلجيكا تعليق المسؤولين التنفيذيين عن دورهم في الإشراف على الأمن السيبراني. هذا تغيير هيكلي يحتاج مسؤولو أمن المعلومات إلى إحاطة مجالس إداراتهم به مباشرة.

## قائمة تحقق عملية للاستعداد لـ NIS2

إذا كنت تريد الدخول إلى تفتيش رقابي وأنت مستعد، فإن الحد الأدنى من الحافظة يشمل:

- **مذكرة تحديد نطاق** تؤكد تصنيف الكيان والالتزامات المطبَّقة.
- **سياسة أمن معلومات** اعتمدتها هيئة الإدارة خلال الاثني عشر شهراً الماضية.
- **سجل مخاطر** يتضمن قرارات معالجة موثّقة.
- **إجراءات استجابة للحوادث** تتضمن مؤقتات إبلاغ صريحة خاصة بـ NIS2.
- **خطة استمرارية أعمال** مع تمرين تعافٍ مُختبَر واحد على الأقل سنوياً.
- **جرد للمورّدين** مع تصنيف حسب المخاطر وتقييمات أمنية للمورّدين الحرجين.
- **سجلات تدريب** للموظفين وهيئة الإدارة تغطي التوعية بالأمن السيبراني.
- **دليل تشغيلي لاستمرارية العمليات** لوظيفة الأمن السيبراني نفسها.

يمكن لـ[منصة GRC](/features-landing) مخصّصة أن تنتج هذه الحافظة كنتاج طبيعي للعمل الروتيني بدلاً من مشروع امتثال منفصل. هذا هو الفارق بين أن يكون NIS2 عملية إطفاء حرائق ربع سنوية، وأن يكون شيئاً تقوم به الوظيفة في الخلفية باستمرار.

## خلاصة ختامية

يُعد NIS2 أحد التوجيهات القليلة التي تجعل كونك منظمة أمنية قوية يجعلك ممتثلاً تلقائياً. تصف معظم الالتزامات ما تقوم به بالفعل فرق الأمن الناضجة. التوقع الرقابي هو أن تتمكن من **إثبات ذلك عند الطلب**: مذكرة تحديد النطاق، السياسات، سجل المخاطر، سجلات الحوادث، أدلة المورّدين، سجلات التدريب، محاضر مجلس الإدارة. إذا كان بإمكانك تقديم هذا الملف خلال 48 ساعة عندما تطلبه سلطة ما، فأنت في وضع جيد. أما إذا لم تستطع، فالفجوة تكمن في الانضباط التشغيلي وليس في نقص القدرات، وهذا أمر يمكن إصلاحه خلال ربع سنة واحد.
`,
    faqs: [
      {
        q: "هل NIS2 هو نفسه توجيه NIS الأصلي؟",
        a: "لا. حلّ NIS2 (التوجيه (EU) 2022/2555) محل توجيه NIS الأصلي في أكتوبر 2024. وقد وسّع نطاق القطاعات من 7 إلى 18 قطاعاً، وأدخل التزامات مباشرة على هيئات الإدارة، ووضع مهلاً أكثر صرامة للإبلاغ عن الحوادث، وزاد العقوبات بشكل كبير.",
      },
      {
        q: "ما العلاقة بين NIS2 و GDPR؟",
        a: "ينظّم GDPR البيانات الشخصية، بينما ينظّم NIS2 أمن الشبكات وأنظمة المعلومات. يتقاطع التوجيهان في مسألة الإبلاغ عن الحوادث لكنهما ينطبقان على فئات مختلفة من الحوادث. يجب الإبلاغ عن خرق البيانات الشخصية بموجب GDPR (خلال 72 ساعة)، وإذا أثّر الخرق نفسه أيضاً على عمليات أو خدمات حرجة، فيجب الإبلاغ عنه أيضاً بموجب NIS2 (إنذار مبكر خلال 24 ساعة).",
      },
      {
        q: "هل يجب على الشركات الصغيرة الامتثال لـ NIS2؟",
        a: "بشكل عام، ينطبق NIS2 على الكيانات المتوسطة والكبيرة (50 موظفاً أو أكثر، 10 ملايين يورو أو أكثر من الإيرادات). ومع ذلك، تنطبق بعض القطاعات (مزوّدو خدمات DNS، سجلات النطاقات العليا، مزوّدو خدمات الثقة المؤهّلين، الإدارة العامة) بغض النظر عن الحجم. كما وسّعت بعض الدول الأعضاء النطاق على المستوى الوطني. تحقّق دائماً من التشريع الوطني الخاص ببلدك.",
      },
      {
        q: "هل يمكن لشهادة ISO 27001 أن تغطي متطلبات NIS2؟",
        a: "تغطي ISO 27001:2022 معظم التزامات المادة 21 من NIS2 من خلال ضوابط الملحق A، لكن ISO 27001 وحدها لا تكفي. يتطلب NIS2 أيضاً إشراكاً صريحاً من هيئة الإدارة، ومهلاً محددة للإبلاغ عن الحوادث (24 ساعة/72 ساعة/شهر واحد)، وواجبات تعاون رقابي تتجاوز نطاق نظام إدارة أمن المعلومات. اعتبر ISO 27001 الأساس وليس الوجهة النهائية.",
      },
      {
        q: "ما هي الغرامة القصوى لعدم الامتثال لـ NIS2؟",
        a: "بالنسبة للكيانات الأساسية: حتى 10 ملايين يورو أو 2% من إجمالي الإيرادات السنوية العالمية، أيهما أعلى. بالنسبة للكيانات المهمة: حتى 7 ملايين يورو أو 1.4% من الإيرادات. أدخلت عدة دول أعضاء أيضاً أحكام مسؤولية شخصية لكبار المديرين في حالات عدم الامتثال المتكرر.",
      },
    ],
  },
};

export default translations;
