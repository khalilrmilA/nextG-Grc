import type { PostTranslations } from "./types";

const translations: PostTranslations = {
  fr: {
    title:
      "Conformité DORA pour les services financiers : guide de mise en œuvre 2026",
    metaTitle:
      "Conformité DORA pour les services financiers : guide 2026",
    metaDescription:
      "Les cinq piliers de DORA décryptés : gestion du risque TIC, notification des incidents, tests de résilience, risque tiers et partage d'information. Ce qu'un RSSI financier doit prouver d'ici le T4 2026.",
    keywords:
      "conformité DORA, exigences DORA, DORA services financiers, mise en œuvre DORA, piliers DORA, DORA risque tiers, DORA TLPT, résilience opérationnelle numérique",
    excerpt:
      "DORA s'applique officiellement depuis janvier 2025, mais les attentes des superviseurs se sont durcies tout au long de 2026. Les cinq piliers, leurs implications pratiques, et ce qu'un RSSI du secteur financier doit pouvoir prouver dès aujourd'hui.",
    body: `
## DORA, dix-huit mois après

Le règlement sur la résilience opérationnelle numérique (Digital Operational Resilience Act, règlement (UE) 2022/2554) s'applique formellement depuis le 17 janvier 2025. Dix-huit mois plus tard, les autorités de supervision (BCE, ABE, ESMA, EIOPA, et autorités nationales compétentes) sont passées résolument de la sensibilisation à l'application effective. Le cycle de supervision 2026 pose des questions précises, fondées sur des preuves.

Si vous êtes RSSI dans une entité financière couverte par DORA (banques, entreprises d'investissement, assureurs, gestionnaires de fonds, établissements de paiement, établissements de monnaie électronique, contreparties centrales, plateformes de négociation, agences de notation de crédit, prestataires de services de financement participatif, ou prestataires tiers critiques de services TIC), votre comité d'audit devrait vous demander des preuves sur les cinq piliers de DORA au plus tard au T4 2026.

Cet article passe en revue chaque pilier avec la question pratique suivante : que veut réellement voir un inspecteur ?

## Pilier 1 : gestion du risque lié aux TIC

Articles 5 à 14. Le socle. DORA exige un **cadre de gestion du risque lié aux TIC** documenté et approuvé par le conseil d'administration, couvrant l'identification, la protection, la détection, la réponse, la récupération, l'apprentissage et la communication. En pratique, ceci est largement couvert par les programmes ISO 27001 et NIST CSF, avec trois ajouts spécifiques à DORA :

- **Responsabilité explicite du conseil.** L'organe de direction doit approuver le cadre, le revoir au moins une fois par an, et superviser sa mise en œuvre. Les procès-verbaux des réunions du conseil doivent en attester.
- **Stratégie de résilience opérationnelle numérique.** Un document spécifique, distinct de la politique de sécurité, qui décrit comment l'entité entend rester opérationnellement résiliente. De nombreuses entités découvrent qu'elles possèdent toutes les briques (politiques, PCA, plan de réponse aux incidents) mais aucun document de stratégie globale.
- **Registre et classification des actifs informationnels.** Un inventaire des actifs informationnels et TIC classés par criticité. L'article 8 rend cette exigence explicite et vérifiable.

Ce que demande un inspecteur : le document de cadre, la stratégie, le registre des actifs avec sa date de dernière mise à jour, et trois jeux de procès-verbaux de conseil montrant des discussions de supervision.

## Pilier 2 : gestion et notification des incidents liés aux TIC

Articles 15 à 23. C'est là que DORA impose la pression opérationnelle la plus forte. Les incidents majeurs liés aux TIC doivent être :

- **Classifiés** selon les critères des normes techniques réglementaires (transactions affectées, étendue géographique, durée, impact économique, impact réputationnel, criticité des services).
- **Notifiés** à l'autorité compétente via une notification en trois étapes : notification initiale sous 4 heures après la classification (et au plus tard 24 heures après la détection), notification intermédiaire, et notification finale.
- **Suivis d'une analyse des causes profondes** dans un délai d'un mois.

Deux réalités pratiques :

1. **Les seuils de classification sont étonnamment bas.** Une poignée de transactions de paiement affectées dans plusieurs États membres peut constituer un incident « majeur ». La plupart des institutions découvrent, en appliquant réellement les critères à leurs incidents de l'année précédente, que plusieurs auraient techniquement dû être notifiés.
2. **Le délai de 4 heures démarre dès que la classification est achevée.** Intégrez l'étape de classification dans votre procédure de réponse à incident afin qu'elle soit réalisée rapidement et documentée.

La notification volontaire des cybermenaces significatives est également encouragée. Plusieurs entités ont adopté une politique de divulgation volontaire pour tout événement franchissant un seuil interne inférieur au seuil obligatoire, sur l'idée que cela renforce la confiance des superviseurs.

## Pilier 3 : tests de résilience opérationnelle numérique

Articles 24 à 27. DORA exige que les entités **testent** leur résilience, pas seulement qu'elles la documentent. Les tests requis incluent :

- Un **programme de tests complet**, au moins annuel, pour les opérations courantes.
- Des **tests de pénétration fondés sur la menace (TLPT)** au moins tous les trois ans pour les entités classées comme significatives. Le TLPT doit suivre le cadre TIBER-EU ou un équivalent.
- Des tests menés par des **parties indépendantes**, internes ou externes, exemptes de tout conflit d'intérêts.

Le TLPT est l'élément le plus sous-estimé par la plupart des institutions. Contrairement à un test d'intrusion classique, le TLPT met en œuvre des tactiques, techniques et procédures réelles d'acteurs de la menace contre des systèmes en production, avec une sensibilisation interne limitée. Sa coordination nécessite une White Team dédiée, des relations contractuelles avec des prestataires de red team, et un dialogue préalable avec le superviseur. Prévoyez un budget de 300 000 à 800 000 € et 6 à 9 mois de délai par cycle.

## Pilier 4 : risque lié aux prestataires tiers TIC

Articles 28 à 44. C'est le pilier ayant les conséquences opérationnelles les plus lourdes pour la plupart des institutions. DORA impose des exigences détaillées sur la gestion des prestataires tiers TIC :

- **Registre exhaustif de tous les accords contractuels** avec les prestataires tiers TIC, en distinguant ceux qui soutiennent des fonctions critiques ou importantes.
- **Diligence raisonnable précontractuelle** avec évaluations documentées.
- **Clauses contractuelles standardisées** couvrant des éléments précis : accords de niveau de service, localisation des données, exigences de sécurité, notification des incidents, droits d'audit, stratégies de sortie.
- **Surveillance du risque de concentration** : les entités ne doivent pas devenir excessivement dépendantes d'un seul prestataire tiers TIC.
- **Les prestataires tiers critiques TIC (CTPP)** sont désignés par les autorités européennes de surveillance et deviennent des entités directement supervisées.

L'exigence de registre n'est à elle seule pas triviale. La plupart des institutions disposent d'un inventaire dans leur système d'achats, mais pas au format prescrit par DORA. L'article 28(3) énumère dix-neuf champs de données spécifiques par accord.

Les exigences contractuelles se répercutent sur les fonctions juridique, achats et sécurité. Renégocier les contrats existants pour y ajouter les clauses imposées par DORA est, pour la plupart des institutions, un projet s'étalant sur plusieurs trimestres, et c'est précisément ce que les inspections du T4 2026 examinent activement.

## Pilier 5 : partage d'informations et de renseignements

Article 45. Le pilier le moins prescriptif, mais de plus en plus mis en avant. DORA **autorise** explicitement les entités financières à échanger des informations sur les cybermenaces entre elles, y compris des indicateurs de compromission, des tactiques, techniques et procédures, au sein de communautés de confiance. Cette autorisation est importante car elle lève certaines préoccupations de confidentialité qui décourageaient auparavant le partage.

Ce que recherchent les superviseurs ici, c'est que vous ayez **envisagé** de participer à un dispositif de partage d'informations et que vous ayez soit rejoint un tel dispositif (FS-ISAC, ISAC nationaux, groupes sectoriels), soit documenté les raisons de ne pas l'avoir fait. L'attente monte que « nous ne partageons pas de renseignements sur les menaces » ne soit plus une réponse acceptable pour une institution significative.

## L'articulation avec NIS2

De nombreuses entités financières entrent simultanément dans le champ de NIS2 (entité essentielle, secteur financier). DORA est **lex specialis** : il prévaut lorsqu'il couvre le même terrain. En pratique, cela signifie :

- Pour la gestion du risque TIC et la notification des incidents, **DORA s'applique et NIS2 s'efface**.
- Pour les aspects que DORA ne couvre pas (hygiène cybersécurité générale, formation, etc.), NIS2 continue de s'appliquer.
- Notifier un incident à une seule autorité au titre de DORA satisfait généralement les deux régimes, mais vérifiez auprès de votre autorité nationale compétente car les procédures diffèrent.

## Ce qu'un inspecteur demandera en 2026

D'après les premiers examens DORA, la liste de contrôle des superviseurs ressemble à peu près à ceci :

- Le document de cadre de gestion du risque TIC, approuvé par le conseil, revu au cours des 12 derniers mois.
- La stratégie de résilience opérationnelle numérique.
- Le registre des actifs informationnels, classifié, mis à jour au cours des 6 derniers mois.
- La procédure de classification des incidents majeurs.
- Les notifications d'incidents des 12 derniers mois.
- Le document de programme de tests annuel et les rapports de tests les plus récents.
- Le calendrier des TLPT et le dernier engagement réalisé (le cas échéant).
- Le registre des accords avec les prestataires tiers TIC, au format de l'article 28(3) de DORA.
- Trois contrats tiers représentatifs montrant les clauses requises.
- L'analyse du risque de concentration.
- Les dispositifs de partage de renseignements sur les menaces.

Arriver avec ce dossier prêt permet d'éviter un travail de remédiation considérable.

## Comment une plateforme GRC aide

Presque toutes les exigences de preuve DORA sont prises en charge nativement par une [plateforme GRC dédiée](/features-landing) : registres, liaison des preuves aux contrôles, journaux d'incidents, inventaires fournisseurs avec niveaux de risque, pistes d'audit et rapports prêts pour le conseil. Les institutions qui peinent le plus avec DORA sont celles qui le traitent comme une série de projets de conformité ponctuels dans des tableurs, plutôt que comme les opérations courantes d'une plateforme qui produit les preuves comme sous-produit naturel.

## Pour conclure

DORA est la réglementation de résilience opérationnelle la plus prescriptive qu'ait produite une grande juridiction. C'est aussi l'une des mieux conçues : ses cinq piliers correspondent au fonctionnement réel des programmes de sécurité et de résilience matures. Les institutions qui s'en sortiront le plus mal lors du cycle de supervision 2026 sont celles qui ont traité DORA comme un exercice documentaire plutôt que comme une refondation du fonctionnement quotidien de la fonction.
`,
    faqs: [
      {
        q: "Qui entre dans le champ d'application de DORA ?",
        a: "DORA s'applique à un large éventail d'entités financières de l'UE : établissements de crédit, établissements de paiement, établissements de monnaie électronique, entreprises d'investissement, prestataires de services sur crypto-actifs, dépositaires centraux de titres, contreparties centrales, plateformes de négociation, référentiels centraux, gestionnaires de fonds, entreprises d'assurance et de réassurance, intermédiaires d'assurance, institutions de retraite professionnelle, agences de notation de crédit, administrateurs d'indices de référence critiques, prestataires de services de financement participatif, et référentiels de titrisation. Les prestataires tiers critiques de services TIC (CTPP) qui fournissent ces entités entrent également indirectement dans le champ.",
      },
      {
        q: "Depuis quand DORA est-il en vigueur ?",
        a: "DORA a été publié en décembre 2022 et est devenu applicable le 17 janvier 2025. Les normes techniques d'application (RTS/ITS) ont été finalisées entre 2024 et 2025 et continuent d'être affinées.",
      },
      {
        q: "Qu'est-ce que le TLPT au titre de DORA ?",
        a: "Le TLPT (Threat-Led Penetration Testing, test de pénétration fondé sur la menace) est une forme avancée de test d'intrusion requise au moins tous les trois ans pour les entités classées comme significatives au titre de DORA. Il doit suivre le cadre TIBER-EU (ou un équivalent) et utiliser des tactiques, techniques et procédures (TTP) réelles d'acteurs de la menace contre des systèmes en production, avec une sensibilisation interne limitée. Les missions durent généralement 6 à 9 mois et coûtent entre 300 000 et 800 000 €.",
      },
      {
        q: "Quel est le lien entre DORA et NIS2 ?",
        a: "Les deux s'appliquent à de nombreuses entités financières, mais DORA est lex specialis : il prévaut lorsqu'il couvre le même terrain (gestion du risque TIC, notification des incidents). NIS2 s'applique aux domaines que DORA ne couvre pas directement (hygiène cybersécurité générale, formation). Un incident notifié au titre de DORA satisfait généralement les deux régimes, mais il convient de vérifier auprès de votre autorité nationale compétente.",
      },
      {
        q: "Quels sont les délais de notification des incidents sous DORA ?",
        a: "Pour les incidents majeurs liés aux TIC : notification initiale sous 4 heures après la classification (et au plus tard 24 heures après la détection), notification intermédiaire, notification finale, et analyse des causes profondes dans un délai d'un mois. Les cybermenaces significatives peuvent également faire l'objet d'une notification volontaire.",
      },
    ],
  },
  ar: {
    title:
      "الامتثال لقانون DORA في قطاع الخدمات المالية: دليل التطبيق لعام 2026",
    metaTitle: "الامتثال لـ DORA في الخدمات المالية: دليل تطبيق 2026",
    metaDescription:
      "الركائز الخمس لقانون DORA بالتفصيل: إدارة مخاطر تقنية المعلومات والاتصالات، الإبلاغ عن الحوادث، اختبار المرونة، مخاطر الأطراف الثالثة، وتبادل المعلومات. ما يحتاجه مدراء أمن المعلومات الماليون بحلول الربع الرابع من 2026.",
    keywords:
      "الامتثال لقانون DORA, متطلبات DORA, DORA الخدمات المالية, تطبيق DORA, ركائز DORA, مخاطر الأطراف الثالثة DORA, اختبار TLPT, المرونة التشغيلية الرقمية",
    excerpt:
      "أصبح قانون DORA ساري المفعول رسميًا منذ يناير 2025، لكن توقعات الجهات الرقابية أصبحت أكثر صرامة خلال عام 2026. الركائز الخمس، والانعكاسات العملية، وما يجب أن يكون مدير أمن المعلومات في القطاع المالي قادرًا على إثباته اليوم.",
    body: `
## قانون DORA بعد ثمانية عشر شهرًا

أصبح قانون المرونة التشغيلية الرقمية (Digital Operational Resilience Act، اللائحة (EU) 2022/2554) ساري المفعول رسميًا منذ 17 يناير 2025. وبعد ثمانية عشر شهرًا، انتقلت السلطات الرقابية (البنك المركزي الأوروبي، والهيئة المصرفية الأوروبية، وهيئة الأوراق المالية والأسواق الأوروبية، والهيئة الأوروبية للتأمين والمعاشات المهنية، والسلطات الوطنية المختصة) بشكل حاسم من مرحلة التوعية إلى مرحلة التطبيق الفعلي. تطرح دورة الرقابة لعام 2026 أسئلة محددة قائمة على الأدلة.

إذا كنت مدير أمن معلومات في كيان مالي يخضع لقانون DORA (بنوك، شركات استثمار، شركات تأمين، مديرو صناديق، مؤسسات دفع، مؤسسات نقود إلكترونية، أطراف مقابلة مركزية، منصات تداول، وكالات تصنيف ائتماني، مزودو خدمات التمويل الجماعي، أو مزودو خدمات تقنية معلومات واتصالات من طرف ثالث ذوو أهمية حرجة)، فمن المتوقع أن تطلب لجنة التدقيق لديك أدلة تثبت الامتثال للركائز الخمس لقانون DORA بحلول الربع الرابع من 2026 على أقصى تقدير.

يستعرض هذا المقال كل ركيزة مع طرح السؤال العملي: ماذا يريد المفتش أن يرى فعليًا؟

## الركيزة الأولى: إدارة مخاطر تقنية المعلومات والاتصالات

المواد من 5 إلى 14. وهي الأساس. يتطلب قانون DORA وجود **إطار موثق ومعتمد من مجلس الإدارة لإدارة مخاطر تقنية المعلومات والاتصالات** يغطي التحديد والحماية والكشف والاستجابة والتعافي والتعلّم والتواصل. من الناحية العملية، يغطي برنامجا ISO 27001 وNIST CSF معظم هذه المتطلبات، مع ثلاث إضافات خاصة بقانون DORA:

- **مساءلة صريحة لمجلس الإدارة.** يجب أن يعتمد الجهاز الإداري الإطار، ويراجعه سنويًا على الأقل، ويشرف على تنفيذه. ويجب أن تُظهر محاضر اجتماعات مجلس الإدارة ذلك.
- **استراتيجية المرونة التشغيلية الرقمية.** وثيقة محددة، مستقلة عن سياسة الأمن، توضح كيف يعتزم الكيان الحفاظ على مرونته التشغيلية. تكتشف كيانات عديدة أن لديها جميع العناصر (سياسات، خطط استمرارية الأعمال، خطط الاستجابة للحوادث) لكن بلا وثيقة استراتيجية شاملة.
- **سجل وتصنيف أصول المعلومات.** جرد لأصول المعلومات وأصول تقنية المعلومات والاتصالات مصنّف حسب الأهمية الحرجة. تجعل المادة 8 هذا المتطلب صريحًا وقابلًا للمراجعة الرقابية.

ما يطلبه المفتش: وثيقة الإطار، والاستراتيجية، وسجل الأصول مع تاريخ آخر تحديث، وثلاث مجموعات من محاضر مجلس الإدارة تُظهر مناقشات الإشراف.

## الركيزة الثانية: إدارة حوادث تقنية المعلومات والاتصالات والإبلاغ عنها

المواد من 15 إلى 23. هذه هي النقطة التي يفرض فيها قانون DORA أشد ضغط تشغيلي. يجب أن تكون الحوادث الكبرى المتعلقة بتقنية المعلومات والاتصالات:

- **مصنّفة** وفقًا للمعايير الواردة في المعايير التقنية التنظيمية (المعاملات المتأثرة، الانتشار الجغرافي، المدة، الأثر الاقتصادي، الأثر على السمعة، أهمية الخدمات الحرجة).
- **مُبلَّغ عنها** إلى السلطة المختصة عبر إشعار من ثلاث مراحل: إشعار أولي خلال 4 ساعات من التصنيف (وفي موعد لا يتجاوز 24 ساعة من الاكتشاف)، وإشعار متوسط، وإشعار نهائي.
- **متبوعة بتحليل السبب الجذري** خلال شهر واحد.

واقعان عمليان:

1. **عتبات التصنيف منخفضة بشكل مفاجئ.** يمكن أن يشكّل عدد قليل من معاملات الدفع المتأثرة عبر عدة دول أعضاء حادثًا "كبيرًا". تكتشف معظم المؤسسات، عند تطبيق المعايير فعليًا على حوادث العام الماضي، أن عدة حوادث كانت من الناحية الفنية واجبة الإبلاغ.
2. **تبدأ مهلة الأربع ساعات فور اكتمال التصنيف.** أدرج خطوة التصنيف ضمن دليل الاستجابة للحوادث حتى تتم بسرعة وتُوثَّق.

يُشجَّع أيضًا الإبلاغ الطوعي عن التهديدات السيبرانية الكبيرة. اعتمدت عدة كيانات سياسة الإفصاح الطوعي عن أي حادث يتجاوز عتبة داخلية أدنى من الحد الإلزامي، على أساس أن ذلك يبني حسن النية لدى الجهات الرقابية.

## الركيزة الثالثة: اختبار المرونة التشغيلية الرقمية

المواد من 24 إلى 27. يتطلب قانون DORA أن تختبر الكيانات مرونتها فعليًا، لا أن تكتفي بتوثيقها. تشمل الاختبارات المطلوبة:

- **برنامج اختبار شامل** سنويًا على الأقل للعمليات الاعتيادية.
- **اختبار الاختراق الموجّه بالتهديدات (TLPT)** كل ثلاث سنوات على الأقل للكيانات المصنّفة كذات أهمية. يجب أن يتبع اختبار TLPT إطار عمل TIBER-EU أو ما يعادله.
- إجراء الاختبارات بواسطة **أطراف مستقلة**، داخلية أو خارجية، لا تربطها أي مصلحة متعارضة.

يُعد اختبار TLPT العنصر الأكثر استهانة به لدى معظم المؤسسات. وخلافًا لاختبار الاختراق التقليدي، يتضمن TLPT محاكاة تكتيكات وتقنيات وإجراءات واقعية لجهات التهديد ضد أنظمة الإنتاج، مع وعي داخلي محدود بالاختبار. ويتطلب تنسيقه فريقًا أبيض مخصصًا، وعلاقات تعاقدية مع مزودي خدمات الفريق الأحمر، وتنسيقًا مسبقًا مع الجهة الرقابية. خصص ميزانية تتراوح بين 300 و800 ألف يورو ومدة زمنية تتراوح بين 6 و9 أشهر لكل دورة.

## الركيزة الرابعة: مخاطر أطراف تقنية المعلومات والاتصالات من الغير

المواد من 28 إلى 44. تُعد هذه الركيزة الأكثر تأثيرًا من الناحية التشغيلية لمعظم المؤسسات. يفرض قانون DORA متطلبات تفصيلية بشأن إدارة مزودي خدمات تقنية المعلومات والاتصالات من الأطراف الثالثة:

- **سجل شامل لجميع الترتيبات التعاقدية** مع مزودي خدمات تقنية المعلومات والاتصالات من الأطراف الثالثة، مع التمييز بين تلك التي تدعم وظائف حرجة أو مهمة.
- **العناية الواجبة قبل التعاقد** مع تقييمات موثقة.
- **بنود تعاقدية موحدة** تغطي عناصر محددة: اتفاقيات مستوى الخدمة، مكان تخزين البيانات، متطلبات الأمن، الإبلاغ عن الحوادث، حقوق التدقيق، استراتيجيات الخروج.
- **مراقبة مخاطر التركّز**: يجب ألا تصبح الكيانات معتمدة بشكل مفرط على مزود واحد من أطراف تقنية المعلومات والاتصالات.
- تُحدَّد **الجهات المزودة الحرجة لخدمات تقنية المعلومات والاتصالات من الأطراف الثالثة (CTPP)** من قبل الهيئات الرقابية الأوروبية وتصبح كيانات خاضعة للرقابة المباشرة.

يُعد متطلب السجل وحده أمرًا غير بسيط. تمتلك معظم المؤسسات جردًا ضمن نظام المشتريات لديها، لكن ليس بالصيغة التي يفرضها قانون DORA. تسرد المادة 28(3) تسعة عشر حقل بيانات محددًا لكل ترتيب تعاقدي.

تمتد المتطلبات التعاقدية لتشمل الإدارات القانونية والمشتريات والأمن. تُعد إعادة التفاوض على العقود القائمة لإضافة البنود التي يفرضها قانون DORA مشروعًا يستغرق عدة أرباع سنوية لمعظم المؤسسات، وهو ما تراجعه بنشاط عمليات التفتيش في الربع الرابع من 2026.

## الركيزة الخامسة: تبادل المعلومات والاستخبارات

المادة 45. أقل الركائز إلزامًا، لكن التركيز عليها يتزايد باستمرار. **يسمح** قانون DORA صراحةً للكيانات المالية بتبادل معلومات التهديدات السيبرانية فيما بينها، بما في ذلك مؤشرات الاختراق والتكتيكات والتقنيات والإجراءات، ضمن مجتمعات موثوقة. ويكتسب هذا الترخيص أهمية لأنه يتجاوز بعض اعتبارات السرية التي كانت تثني سابقًا عن التبادل.

ما تبحث عنه الجهات الرقابية هنا هو أنك قد **نظرت** في المشاركة في ترتيب لتبادل المعلومات، وإما انضممت إلى أحدها (FS-ISAC، أو مراكز تبادل معلومات وطنية، أو مجموعات قطاعية متخصصة)، أو وثّقت أسباب عدم القيام بذلك. ويتزايد التوقع بأن عبارة "نحن لا نتبادل معلومات استخباراتية عن التهديدات" لم تعد إجابة مقبولة لمؤسسة ذات أهمية.

## التداخل مع NIS2

تقع العديد من الكيانات المالية في آن واحد ضمن نطاق NIS2 (كيان أساسي، قطاع مالي). ويُعد قانون DORA قانونًا خاصًا (lex specialis): فهو يسود عندما يغطي نفس المجال. ومن الناحية العملية، يعني هذا:

- بالنسبة لإدارة مخاطر تقنية المعلومات والاتصالات والإبلاغ عن الحوادث، **يُطبَّق قانون DORA وتتنحى NIS2**.
- بالنسبة للجوانب التي لا يغطيها قانون DORA (النظافة السيبرانية العامة، التدريب، إلخ)، تظل NIS2 سارية.
- عادةً ما يفي الإبلاغ عن حادث لسلطة واحدة بموجب DORA بمتطلبات كلا القانونين، لكن يجب التحقق من ذلك مع السلطة الوطنية المختصة لأن الإجراءات قد تختلف.

## ما الذي سيطلبه المفتش في 2026

استنادًا إلى الفحوصات المبكرة لقانون DORA، تبدو قائمة التحقق الرقابية على النحو التالي تقريبًا:

- وثيقة إطار إدارة مخاطر تقنية المعلومات والاتصالات، معتمدة من مجلس الإدارة، ومُراجَعة خلال الاثني عشر شهرًا الماضية.
- استراتيجية المرونة التشغيلية الرقمية.
- سجل أصول المعلومات، مصنّف، ومُحدَّث خلال الستة أشهر الماضية.
- إجراء تصنيف الحوادث الكبرى.
- إشعارات الحوادث للاثني عشر شهرًا الماضية.
- وثيقة برنامج الاختبار السنوي وآخر تقارير الاختبار.
- جدول اختبارات TLPT وآخر عملية تم إنجازها (إن وجدت).
- سجل ترتيبات أطراف تقنية المعلومات والاتصالات الثالثة، بالصيغة الواردة في المادة 28(3) من DORA.
- ثلاثة عقود نموذجية مع أطراف ثالثة تُظهر البنود المطلوبة.
- تحليل مخاطر التركّز.
- ترتيبات تبادل الاستخبارات المتعلقة بالتهديدات.

الحضور بهذا الملف جاهزًا يوفر جهدًا هائلاً في معالجة أوجه القصور لاحقًا.

## كيف تساعد منصة GRC

تُعد جميع متطلبات الأدلة الخاصة بقانون DORA تقريبًا أمورًا تدعمها [منصة GRC متخصصة](/features-landing) بشكل أصيل: السجلات، وربط الأدلة بالضوابط، وسجلات الحوادث، وجرد الموردين مع مستويات المخاطر، ومسارات التدقيق، والتقارير الجاهزة لمجلس الإدارة. المؤسسات التي تواجه أكبر صعوبة مع قانون DORA هي تلك التي تتعامل معه كسلسلة من مشاريع الامتثال المنفصلة في جداول بيانات، بدلًا من اعتباره عمليات مستمرة لمنصة تُنتج الأدلة كنتيجة طبيعية لعملها.

## خاتمة

يُعد قانون DORA أكثر التشريعات المتعلقة بالمرونة التشغيلية إلزامًا وتفصيلًا التي أصدرتها أي ولاية قضائية كبرى. وهو أيضًا من بين الأفضل تصميمًا: تتوافق ركائزه الخمس مع طريقة عمل برامج الأمن والمرونة الناضجة فعليًا. المؤسسات التي ستواجه أسوأ النتائج في دورة الرقابة لعام 2026 هي تلك التي تعاملت مع قانون DORA كتمرين توثيقي بدلًا من اعتباره إعادة تأسيس لطريقة عمل الوظيفة يوميًا.
`,
    faqs: [
      {
        q: "من يخضع لنطاق قانون DORA؟",
        a: "يُطبَّق قانون DORA على مجموعة واسعة من الكيانات المالية في الاتحاد الأوروبي: مؤسسات الائتمان، ومؤسسات الدفع، ومؤسسات النقود الإلكترونية، وشركات الاستثمار، ومزودو خدمات الأصول المشفّرة، والودائع المركزية للأوراق المالية، والأطراف المقابلة المركزية، ومنصات التداول، ومستودعات التداول، ومديرو الصناديق، وشركات التأمين وإعادة التأمين، ووسطاء التأمين، ومؤسسات التقاعد المهني، ووكالات التصنيف الائتماني، ومديرو المؤشرات المرجعية الحرجة، ومزودو خدمات التمويل الجماعي، ومستودعات التوريق. كما يخضع مزودو خدمات تقنية المعلومات والاتصالات الحرجون من الأطراف الثالثة (CTPP) الذين يزودون هذه الكيانات لنطاق القانون بشكل غير مباشر.",
      },
      {
        q: "متى دخل قانون DORA حيز التنفيذ؟",
        a: "نُشر قانون DORA في ديسمبر 2022 وأصبح ساري المفعول في 17 يناير 2025. واكتملت صياغة المعايير التقنية التنفيذية (RTS/ITS) خلال الفترة 2024-2025 وما زالت قيد التنقيح المستمر.",
      },
      {
        q: "ما هو اختبار TLPT بموجب قانون DORA؟",
        a: "اختبار الاختراق الموجّه بالتهديدات (Threat-Led Penetration Testing، أو TLPT) هو شكل متقدم من اختبار الاختراق مطلوب كل ثلاث سنوات على الأقل للكيانات المصنّفة كذات أهمية بموجب قانون DORA. يجب أن يتبع إطار عمل TIBER-EU (أو ما يعادله) ويستخدم تكتيكات وتقنيات وإجراءات واقعية لجهات التهديد ضد أنظمة الإنتاج، مع وعي داخلي محدود بالاختبار. تستغرق هذه العمليات عادةً من 6 إلى 9 أشهر وتكلف ما بين 300 و800 ألف يورو.",
      },
      {
        q: "ما العلاقة بين قانون DORA وتوجيه NIS2؟",
        a: "يُطبَّق كلاهما على العديد من الكيانات المالية، لكن قانون DORA يُعد قانونًا خاصًا (lex specialis): فهو يسود عندما يغطي نفس المجال (إدارة مخاطر تقنية المعلومات والاتصالات، والإبلاغ عن الحوادث). ويُطبَّق NIS2 على المجالات التي لا يغطيها قانون DORA مباشرة (النظافة السيبرانية العامة، التدريب). عادةً ما يفي الحادث المُبلَّغ عنه بموجب DORA بمتطلبات كلا القانونين، لكن يجب التحقق من ذلك مع السلطة الوطنية المختصة.",
      },
      {
        q: "ما هي الجداول الزمنية للإبلاغ عن الحوادث بموجب قانون DORA؟",
        a: "بالنسبة للحوادث الكبرى المتعلقة بتقنية المعلومات والاتصالات: إشعار أولي خلال 4 ساعات من التصنيف (وفي موعد لا يتجاوز 24 ساعة من الاكتشاف)، وإشعار متوسط، وإشعار نهائي، وتحليل للسبب الجذري خلال شهر واحد. يمكن أيضًا الإبلاغ طوعًا عن التهديدات السيبرانية الكبيرة.",
      },
    ],
  },
};

export default translations;
