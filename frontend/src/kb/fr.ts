import type { KbArticle } from "./types";

// Base de connaissances en français. Même structure et même ordre que en.ts :
// un article par module ; `id` est le segment de route pour que le bouton « ? »
// de l’en-tête ouvre l’article de la page courante.
// Balisage autorisé dans les chaînes : **gras** et `code`.
// Les libellés entre ** reprennent les chaînes FR réellement affichées par l’application
// (locales/fr.ts, eliteLocales.ts, menuLocales.ts) ; les libellés non traduits dans
// l’interface sont conservés tels qu’affichés (en anglais).
export const kbFr: KbArticle[] = [
  // ───────────────────────────── Vue d’ensemble ─────────────────────────────
  {
    id: "dashboard",
    route: "/dashboard",
    group: "overview",
    title: "Tableau de bord",
    summary: "Votre page d’accueil : une vue d’ensemble en temps réel de la conformité, des risques, des constats d’audit et des attestations de politiques, sur tous les modules.",
    keywords: ["accueil", "vue d’ensemble", "KPI", "indicateurs", "score", "posture", "synthèse de direction", "executive summary", "widgets", "dashboard"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le tableau de bord réunit en un seul endroit les chiffres clés de toute la plateforme. Tant qu’aucun référentiel principal n’est choisi, il affiche une carte d’accueil avec un bouton **Sélectionner les référentiels**. Ensuite, il affiche **Vos référentiels** (une carte par référentiel), le plan d’action de conformité, le tableau de bord des recommandations et les KPI de la plateforme : risques ouverts, conformité moyenne, constats d’audit ouverts et attestation des politiques. Les dirigeants et les RSSI voient aussi une **Synthèse de direction** avec un score de posture de sécurité pondéré et les principaux risques.",
      },
      {
        heading: "Comment explorer un référentiel",
        steps: [
          "Cliquez sur une carte sous **Vos référentiels**.",
          "Consultez le Score global, les Contrôles couverts, les Lacunes ouvertes, les Documents manquants et l’indicateur Prêt pour certification.",
          "Utilisez les **Actions rapides** (Lancer l’analyse, Voir le rapport de lacunes, Téléverser des documents, Générer des politiques) pour passer directement au travail.",
          "S’il n’existe pas encore d’évaluation, cliquez sur **Nouvelle évaluation** ou **Démarrer l’évaluation**.",
        ],
      },
      {
        heading: "Comment personnaliser et exporter",
        steps: [
          "Cliquez sur **Personnaliser** pour afficher, masquer ou réordonner les sections et les KPI, puis enregistrez la disposition.",
          "Choisissez un intervalle d’actualisation (de désactivé à 1 heure) ou cliquez sur **Actualiser** pour mettre à jour immédiatement.",
          "Cliquez sur **Exporter** et choisissez PDF ou Excel pour télécharger le tableau de bord.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Seuls les administrateurs, RSSI, responsables conformité et responsables des politiques voient la carte **Ajouter un référentiel**.",
          "Les graphiques peuvent être enregistrés sous forme d’image avec **Exporter en image**.",
        ],
      },
    ],
  },
  {
    id: "getting-started",
    route: "/dashboard",
    group: "start",
    title: "Premiers pas avec GRC Eye",
    summary: "Une visite rapide pour votre première connexion : fonctionnement des menus, changement de langue, où trouver de l’aide et quoi mettre en place la première semaine.",
    keywords: ["prise en main", "onboarding", "première connexion", "visite guidée", "navigation", "menu", "barre latérale", "sidebar", "langue", "aide", "arabe", "français"],
    sections: [
      {
        heading: "Votre première connexion",
        body: "Connectez-vous avec l’adresse e-mail et le mot de passe temporaire envoyés par votre administrateur. Si l’authentification à deux facteurs est activée pour votre compte, un code à 6 chiffres issu de votre application d’authentification vous sera également demandé. Lors de vos premières visites, une courte visite guidée présente les principales zones. Un bandeau de lecture seule s’affiche en haut de l’écran si votre compte dispose d’un accès en consultation.",
      },
      {
        heading: "S’orienter : la barre latérale",
        body: "La barre latérale gauche est organisée en menus repliables, un par domaine : **Vue d’ensemble**, **Gestion des actifs**, **Gestion des risques**, **Gestion de l’Exposition**, **Gestion de la conformité**, **Gestion des contrôles**, **Gestion des audits**, **Politiques et documents**, **Gestion des tiers**, **Gouvernance** et **Rapports et support**. Cliquez sur le nom d’un menu pour l’ouvrir ou le fermer. Vous ne voyez que les pages autorisées par votre rôle. Un élément grisé avec un cadenas signifie que ce module n’est pas activé pour votre organisation. En bas se trouvent **Documentation** (ce site), **Paramètres** et **Aide & Support**.",
      },
      {
        heading: "Langue et aide",
        steps: [
          "Cliquez sur le bouton de langue (drapeau et code) dans l’en-tête et choisissez **EN**, **FR** ou **AR**. L’arabe bascule toute l’interface de droite à gauche.",
          "Cliquez à tout moment sur l’icône **?** à côté du bouton de langue. Elle ouvre cette documentation au guide de la page sur laquelle vous vous trouvez. Dans la documentation, appuyez sur **Ctrl K** pour rechercher dans tous les guides.",
          "Utilisez l’icône en forme de cloche pour voir vos notifications, et le bouton flottant de l’assistant IA pour les questions rapides.",
        ],
      },
      {
        heading: "Première semaine recommandée",
        steps: [
          "**Actifs** : enregistrez vos principaux systèmes, applications et données, avec un propriétaire et une valorisation DIC (CIA).",
          "**Risques** : ajoutez vos risques clés dans le Registre des risques et évaluez leur vraisemblance et leur impact.",
          "**Référentiels et conformité** : choisissez votre ou vos référentiels, puis créez une évaluation de conformité et lancez l’analyse IA.",
          "**Contrôles** : enregistrez les contrôles déjà en place dans Contrôles appliqués (Applied Controls) et suivez les lacunes dans le Plan d’action.",
          "**Politiques** : créez ou générez vos politiques essentielles et envoyez-les pour attestation.",
          "**Rapports** : téléchargez un Résumé exécutif pour partager l’avancement.",
        ],
      },
    ],
  },
  {
    id: "analytics",
    route: "/analytics",
    group: "overview",
    title: "Analytique et tableaux de bord",
    summary: "KPI par module sur l’ensemble du programme de gestion des risques, avec filtres et export Excel/CSV/PDF.",
    keywords: ["KPI", "indicateurs", "métriques", "graphiques", "export", "excel", "csv", "heatmap", "carte de chaleur", "tendance", "statistiques", "analytics"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La page Analytique affiche une tuile par module (Actifs, Vulnérabilités, Menaces, Risques, Contrôles, Gouvernance, Audit, Recommandations) avec les totaux, le nombre par gravité et des répartitions par type, statut, catégorie ou priorité. La vue Risques comprend une carte de chaleur 5×5 vraisemblance × impact. Disponible si l’Elite Pack est activé pour votre organisation. Chaque tuile n’est visible que des rôles auxquels elle est destinée ; les autres voient « Vue restreinte ».",
      },
      {
        heading: "Comment filtrer et approfondir",
        steps: [
          "Utilisez la barre **Filtres** pour choisir une période (des 30 derniers jours à toute la période) et une gravité.",
          "Cliquez sur l’icône d’agrandissement d’une tuile pour ouvrir une vue détaillée de ce module.",
          "Cliquez sur **Réinitialiser les filtres** pour revenir à la vue complète.",
        ],
      },
      {
        heading: "Comment exporter des données",
        steps: [
          "Dans **Export de rapport**, choisissez un jeu de données : registre des risques, vulnérabilités, inventaire des actifs, contrôles appliqués, audits ou bibliothèque des menaces.",
          "Cliquez sur **Excel** ou **CSV** pour le télécharger.",
          "Pour exporter une seule tuile, utilisez son menu d’export (PDF ou Excel), ou enregistrez un graphique avec **Exporter en image**.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Les filtres sont conservés dans l’adresse de la page : vous pouvez mettre en favori ou partager une vue filtrée.",
          "Définissez un intervalle d’actualisation automatique si la page reste affichée sur un écran.",
        ],
      },
    ],
  },

  // ──────────────────────── Gestion des actifs et des risques ────────────────────────
  {
    id: "assets",
    route: "/assets",
    group: "assets",
    title: "Inventaire des actifs",
    summary: "Le registre de vos actifs primordiaux et actifs supports, avec valorisation DIC, propriétaire, statut et cycle de vie.",
    keywords: ["inventaire", "actifs", "CMDB", "serveur", "application", "base de données", "CIA", "DIC", "propriétaire", "cycle de vie", "fin de vie", "end-of-life"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Les actifs sont la base des risques, des vulnérabilités, des incidents et du périmètre de conformité. Chaque actif a un type (serveur, application, base de données, service cloud, données, processus, personne, etc.), une classe (**Principal** ou **Support**), une criticité, un propriétaire métier et une cotation de confidentialité, d’intégrité et de disponibilité de 1 à 5.",
      },
      {
        heading: "Comment ajouter un actif",
        steps: [
          "Cliquez sur **Nouvel actif**.",
          "Saisissez le **Nom** et le **Propriétaire métier** (tous deux obligatoires), puis choisissez le type, la classe et la criticité.",
          "Cotez la confidentialité, l’intégrité et la disponibilité (1–5) et ajoutez une valeur métier.",
          "Définissez le statut (opérationnel, dégradé, hors service…) et l’étape du cycle de vie (acquisition, en service, maintenance, retiré), puis enregistrez.",
        ],
      },
      {
        heading: "Comment retrouver des actifs",
        steps: [
          "Utilisez **Rechercher des actifs…** et les filtres de criticité, de classe et de statut.",
          "Utilisez le menu des colonnes pour afficher ou masquer des colonnes.",
          "Cliquez sur **Tableau de bord** pour afficher des graphiques, comme la répartition par statut.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Un bandeau vous avertit lorsque des actifs approchent ou ont dépassé leur fin de vie.",
          "Rattachez les actifs aux départements et aux processus métiers dans **Cartographie des actifs**.",
        ],
      },
    ],
  },
  {
    id: "asset-graph",
    route: "/asset-graph",
    group: "assets",
    title: "Cartographie des actifs",
    summary: "Une carte interactive reliant les entités de votre organisation, les processus métiers et les actifs qui les supportent.",
    keywords: ["carte", "cartographie", "graphe", "entité", "département", "processus métier", "dépendances", "cartography", "map"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Cartographie des actifs montre qui dépend de quoi. Les entités organisationnelles (départements, agences), les processus métiers et les actifs sont représentés en anneaux reliés, ce qui permet de voir l’impact d’un actif sur l’activité. Les entités et processus créés ici peuvent aussi servir à filtrer les risques et à définir le périmètre des évaluations de conformité. Disponible si ce module est activé pour votre organisation.",
      },
      {
        heading: "Comment construire la carte",
        steps: [
          "Dans **Entités organisationnelles**, cliquez sur **+** et saisissez le nom de l’entité, son type (p. ex. département, agence) et éventuellement son entité parente.",
          "Dans **Processus métiers**, cliquez sur **+**, saisissez le nom du processus, choisissez son entité, sa criticité et son propriétaire, puis liez les actifs qui le supportent.",
          "Cliquez sur un nœud du graphe pour mettre en évidence ses connexions directes.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Utilisez **Toutes les entités** et **Tous les types d’actifs** pour cibler le graphe ; **Effacer les filtres** le réinitialise.",
          "Supprimer une entité détache ses entités enfants au lieu de les supprimer.",
        ],
      },
    ],
  },
  {
    id: "risks",
    route: "/risks",
    group: "risk",
    title: "Registre des risques",
    summary: "Votre liste centrale des risques, cotés en vraisemblance × impact, avec carte des risques, appétence au risque et validation de la cible.",
    keywords: ["risque", "registre des risques", "risk register", "heatmap", "carte de chaleur", "vraisemblance", "probabilité", "impact", "appétence", "risque résiduel", "risque inhérent", "export"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le Registre des risques enregistre chaque risque avec une catégorie, un statut, une vraisemblance et un impact (1–5). Le score et la gravité sont calculés automatiquement. Une **Carte des risques** 5×5 montre la position des risques ; cliquez sur une cellule pour filtrer la liste.",
      },
      {
        heading: "Comment ajouter un risque",
        steps: [
          "Cliquez sur **Nouveau risque**.",
          "Saisissez le **Titre du risque** et une description, puis choisissez une catégorie et un statut (Identifié, Évalué, Traitement planifié, Traitement en cours, Traité, Accepté, Clôturé).",
          "Réglez la vraisemblance et l’impact avec les curseurs et observez la mise à jour du score.",
          "Ajoutez des étiquettes (séparées par des virgules) et enregistrez.",
        ],
      },
      {
        heading: "Comment définir l’appétence et valider une cible",
        steps: [
          "Cliquez sur un risque pour ouvrir son détail.",
          "Dans **Appétence au risque**, cliquez sur **Modifier** pour définir le seuil d’appétence ainsi que la vraisemblance et l’impact cibles.",
          "Lorsque la cible est dans l’appétence, cliquez sur **Valider la cible** et ajoutez éventuellement des notes de calcul.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Seuls les RSSI et les gestionnaires de risques peuvent valider une cible, et la validation est bloquée tant que la cible dépasse l’appétence.",
          "Utilisez **Exporter CSV** pour télécharger le registre.",
          "La vue détaillée comprend un panneau **AI Risk Analysis** (analyse IA du risque) pour obtenir rapidement un second avis.",
        ],
      },
    ],
  },
  {
    id: "risk-scenarios",
    route: "/risk-scenarios",
    group: "risk",
    title: "Scénarios de risque",
    summary: "Décrivez comment une menace pourrait exploiter une vulnérabilité sur un actif, et évaluez le risque actuel par rapport au risque cible avec une décision de traitement.",
    keywords: ["scénario", "scénario de risque", "menace", "vulnérabilité", "actif", "traitement", "priorité", "EBIOS", "historique des versions", "scenario"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Un scénario de risque relie menaces, vulnérabilités, actifs, incidents passés et contrôles appliqués en un seul enchaînement. Vous cotez la probabilité et l’impact actuels et cibles, choisissez un traitement (Réduire, Accepter, Transférer, Éviter ou Non traité) et indiquez votre degré de confiance (Force de la connaissance).",
      },
      {
        heading: "Comment créer un scénario",
        steps: [
          "Cliquez sur **Ajouter un scénario**.",
          "Saisissez un nom et une description, puis liez les menaces, vulnérabilités, actifs, incidents et contrôles appliqués concernés.",
          "Définissez la probabilité et l’impact actuels et cibles (1–5), le traitement et la force de la connaissance.",
          "Ajoutez la source de menace, une justification et une **Date de prochaine révision**, puis enregistrez.",
        ],
      },
      {
        heading: "Comment prioriser et suivre les changements",
        steps: [
          "Cliquez sur **Critères de priorisation** pour définir le poids de la criticité des actifs, le poids de l’exposition réglementaire et le seuil d’alerte. Les scénarios au-dessus du seuil déclenchent une notification aux propriétaires et au RSSI.",
          "Triez la liste par **Priorité** pour voir ce qui compte le plus.",
          "Ouvrez **Historique des versions**, cliquez sur **Créer un instantané**, puis utilisez **Comparer** pour voir ce qui a changé entre deux versions.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Vous pouvez créer un scénario directement depuis un incident avec **Create risk scenario from this incident** (Créer un scénario de risque à partir de cet incident).",
          "Un badge **En retard** signale les scénarios dont la date de révision est dépassée.",
        ],
      },
    ],
  },
  {
    id: "risk-cartography",
    route: "/risk-cartography",
    group: "risk",
    title: "Cartographie des risques",
    summary: "Créez vos propres cartes des risques avec taille de grille, libellés d’axes, zones de couleur et positions manuelles personnalisés, et exportez-les en PDF.",
    keywords: ["carte des risques", "cartographie", "heatmap", "matrice", "zones", "grille", "PDF", "risk map", "cartography"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Cartographie des risques permet de créer plusieurs cartes des risques indépendantes, par exemple une par département ou par catégorie, chacune avec sa propre grille et ses propres couleurs. Une carte peut être définie comme carte par défaut.",
      },
      {
        heading: "Comment créer une carte",
        steps: [
          "Cliquez sur **Nouvelle cartographie**.",
          "Dans **Général**, saisissez un nom, une description et un périmètre (tous les risques, par contrôle, par catégorie ou par étiquette).",
          "Dans **Grille**, choisissez un modèle (3×3, 4×4, 5×5) ou une taille personnalisée, et nommez les axes de vraisemblance et d’impact.",
          "Dans **Zones de risque**, nommez chaque zone, définissez son score min/max et sa couleur, puis enregistrez.",
        ],
      },
      {
        heading: "Comment ajuster et partager",
        steps: [
          "Ouvrez une carte et cliquez sur **Modifier les positions**, sélectionnez un risque, puis cliquez sur une cellule pour le déplacer.",
          "Utilisez **Remettre à la position d’origine** pour annuler un déplacement manuel.",
          "Cliquez sur **Exporter en PDF** pour télécharger la carte.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Les risques déplacés sont marqués **Repositionné**, afin que les lecteurs sachent que la position a été fixée manuellement."],
      },
    ],
  },
  {
    id: "risk-treatment",
    route: "/risk-treatment",
    group: "risk",
    title: "Traitement des risques",
    summary: "Enregistrez la décision de traitement de chaque risque (réduire, accepter, transférer, éviter) avec suivi du calendrier, du coût et de l’avancement.",
    keywords: ["plan de traitement", "traitement des risques", "treatment plan", "réduire", "atténuer", "accepter", "transférer", "éviter", "assurance", "budget", "échéance"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque plan de traitement est rattaché à un risque et, le cas échéant, à des scénarios de risque. Il suit l’option retenue, l’avancement, l’échéance et le coût estimé, et signale les plans en retard, à risque ou en dépassement de budget. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment créer un plan de traitement",
        steps: [
          "Cliquez sur **Nouveau traitement** et choisissez le risque.",
          "Liez les scénarios de risque si nécessaire et choisissez l’option : Réduire, Accepter, Transférer ou Éviter.",
          "Saisissez une description, le pourcentage d’avancement, l’échéance et le coût estimé.",
          "Pour **Transférer**, indiquez à qui le risque est transféré (p. ex. une police d’assurance). Pour **Accepter**, une justification d’acceptation est obligatoire.",
        ],
      },
      {
        heading: "Comment mettre à jour un plan",
        steps: [
          "Cliquez sur **Remplacer** sur le plan.",
          "Modifiez les informations et décrivez **Qu’est-ce qui a changé dans ce nouveau plan ?**",
          "Enregistrez. L’ancien plan est conservé dans **Historique des versions**.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Passez à la vue **Par responsable** pour voir les plans de chaque responsable, leur avancement moyen et les dépassements de budget."],
      },
    ],
  },

  // ──────────────────────── Vulnérabilités et menaces ────────────────────────
  {
    id: "vulnerabilities",
    route: "/vulnerabilities",
    group: "exposure",
    title: "Vulnérabilités",
    summary: "Suivez et corrigez les vulnérabilités de sécurité, de la saisie manuelle, de l’import des scanners et des connecteurs automatiques jusqu’à la clôture.",
    keywords: ["CVE", "CVSS", "vulnérabilité", "scan", "scanner", "nessus", "tenable", "qualys", "openvas", "import", "connecteur", "EASM", "surface d’attaque", "correctif", "patch", "remédiation"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Cette page liste chaque vulnérabilité connue avec sa référence (p. ex. un CVE), sa gravité, son score CVSS, son statut et sa date limite de remédiation. Les statuts vont de « en attente de validation » et « validée », en passant par « ouverte » et « en remédiation », jusqu’à « atténuée », « acceptée », « clôturée » ou « faux positif ». Les tuiles KPI indiquent le total, les vulnérabilités ouvertes, celles en remédiation et le CVSS moyen.",
      },
      {
        heading: "Comment ajouter et gérer une vulnérabilité",
        steps: [
          "Cliquez sur **Ajouter une vulnérabilité** et saisissez l’identifiant de référence et le nom, puis la gravité, le score CVSS, la source (test d’intrusion, scan, manuel, bug bounty) et les systèmes affectés.",
          "Cliquez sur une ligne pour l’ouvrir. Mettez à jour le statut, la gravité, le CVSS ou la date limite de remédiation et cliquez sur **Enregistrer**.",
          "Pour les éléments en attente de revue, un RSSI clique sur **Valider**.",
          "Dans **Score d’impact**, choisissez le contexte opérationnel (exposé sur Internet, production, interne…) et cliquez sur **Recalculer**, ou sur **Ajuster manuellement** avec une justification. Liez les scénarios de risque que cet impact alimente.",
        ],
      },
      {
        heading: "Importer les résultats d’un scanner",
        steps: [
          "Cliquez sur **Importer un scan**.",
          "Choisissez le scanner : CSV générique, OpenVAS, Qualys ou Nessus / Tenable.",
          "Téléversez le fichier (`.csv`, `.nessus` ou `.xml`). Les résultats sont analysés, les doublons ignorés et les résultats rapprochés automatiquement de vos actifs. Les rapports XML sont reconnus d’après leur contenu : un rapport XML OpenVAS / Greenbone est donc bien lu comme OpenVAS.",
          "Lisez le message de résultat, qui indique combien de résultats ont été importés, rapprochés et ignorés.",
        ],
        tips: ["Vous n’êtes pas sûr du format ? Utilisez **Télécharger un exemple de CSV OpenVAS pour tester**."],
      },
      {
        heading: "Connecteurs de scanners",
        steps: [
          "Cliquez sur **Connecteurs**, puis sur **Ajouter un connecteur**.",
          "Donnez-lui un nom et choisissez l’outil. **Tenable.io**, **Nessus (Professional / Manager)** et **Qualys VM** récupèrent les vulnérabilités automatiquement. Saisissez l’URL de base du scanner, puis la clé d’accès et la clé secrète (Tenable.io, Nessus) ou le nom d’utilisateur et le mot de passe API (Qualys VM).",
          "Pour une récupération planifiée, cochez **Synchronisation automatique** et choisissez **Quotidienne**, **Hebdomadaire** ou **Mensuelle**, puis cliquez sur **Ajouter**.",
          "Sur la ligne du connecteur, cliquez sur **Tester** pour vérifier que le scanner est joignable et que les identifiants sont acceptés (rien n’est importé), puis sur **Synchroniser** pour récupérer les résultats. Chaque exécution est enregistrée.",
          "Chaque ligne affiche la date de la dernière synchronisation et son statut (ou **Jamais synchronisé**). Vous pouvez activer ou désactiver la **Synchronisation automatique** et changer sa fréquence directement sur la ligne.",
        ],
        tips: [
          "Nessus nécessite une édition qui autorise l’accès API, comme Nessus Manager. Si votre édition ne le permet pas, exportez le scan au format `.nessus` et utilisez **Importer un scan**.",
          "OpenVAS / Greenbone fonctionne uniquement par import de fichier : il ne peut pas être interrogé à distance. Exportez le rapport en XML ou CSV et utilisez **Importer un scan**.",
          "Les connecteurs **EASM (surface d’attaque externe)** récupèrent les vulnérabilités de votre plateforme de surface d’attaque : saisissez son URL de base, la clé API, le mode d’authentification et le chemin de l’endpoint des vulnérabilités, puis cliquez sur **Tester** — la correspondance des champs s’affiche avec un aperçu. Les domaines et IP nouvellement découverts sont créés comme actifs (étiquette `easm`) ; attribuez-leur un propriétaire lors de la revue.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "La création, la modification et la suppression de vulnérabilités sont réservées aux RSSI, gestionnaires de risques et administrateurs ; les imports de scanners aux RSSI et analystes sécurité.",
          "L’import de scans, les connecteurs et le score d’impact sont des fonctionnalités de l’Elite Pack.",
        ],
      },
    ],
  },
  {
    id: "cve",
    route: "/cve",
    group: "exposure",
    title: "Base de connaissances CVE",
    summary: "Recherchez dans le catalogue public des CVE du NVD, maintenez-le à jour et décidez quelles CVE concernent votre environnement.",
    keywords: ["CVE", "NVD", "CWE", "KEV", "exploitée", "exploited", "CISA", "tri", "triage", "pertinence", "bulletin", "avis de sécurité", "correctif", "patch"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Base de connaissances CVE est une copie consultable du catalogue NVD, enrichie des types de faiblesses CWE de MITRE et de la liste CISA des vulnérabilités activement exploitées (KEV). Vous pouvez trier chaque CVE comme pertinente, à surveiller ou non pertinente pour votre organisation. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment rechercher et trier",
        steps: [
          "Saisissez un identifiant CVE ou un mot-clé dans **Rechercher un identifiant CVE ou une description…**.",
          "Affinez par type de faiblesse (CWE), CVSS minimum, date de publication, **Activement exploitées** et pertinence, puis cliquez sur **Rechercher**.",
          "Définissez la pertinence directement dans le tableau avec la liste déroulante **Trier…**.",
          "Ouvrez la fiche complète pour lire le vecteur d’attaque, les contournements connus, les modèles d’attaque et les correctifs, puis renseignez la pertinence, les notes internes et les actifs liés et cliquez sur **Enregistrer**.",
        ],
      },
      {
        heading: "Comment actualiser le catalogue",
        steps: ["Cliquez sur **Synchroniser depuis NVD** pour récupérer les CVE des 7 derniers jours et mettre à jour le catalogue CWE. Seuls les analystes sécurité et les RSSI peuvent synchroniser."],
      },
      {
        heading: "Astuces",
        tips: ["Un badge **Exploitée** signale les CVE présentes dans la liste CISA KEV ; la fiche indique leur date limite de remédiation."],
      },
    ],
  },
  {
    id: "threats",
    route: "/threats",
    group: "exposure",
    title: "Bibliothèque des menaces",
    summary: "Un catalogue de menaces — intégrées, MITRE ATT&CK et flux en temps réel — que vous adoptez dans votre propre registre et profil.",
    keywords: ["menace", "threat", "MITRE", "ATT&CK", "CISA", "SANS", "flux", "feed", "renseignement sur les menaces", "threat intelligence", "CTI", "profil de menace", "veille"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Bibliothèque des menaces combine un catalogue intégré, les techniques MITRE ATT&CK et des menaces récupérées automatiquement toutes les 24 heures depuis CISA KEV, SANS ISC et des sources liées à la chaîne d’approvisionnement. Les nouveaux éléments des flux restent **En attente de révision** jusqu’à ce que quelqu’un les approuve. Les menaces qui vous appartiennent peuvent être liées à des scénarios de risque.",
      },
      {
        heading: "Comment ajouter ou adopter des menaces",
        steps: [
          "Cliquez sur **Ajouter une menace** et saisissez une référence, un nom, une description, une catégorie, les sources de menace et les identifiants MITRE ATT&CK.",
          "Pour une menace intégrée, ouvrez-la et cliquez sur **Ajouter à mon registre**.",
          "Cliquez une fois sur **Importer MITRE ATT&CK** pour charger plus de 700 techniques, ou sur **Récupérer maintenant** pour interroger les flux immédiatement.",
          "Dans la zone **En attente de révision**, cliquez sur **Approuver** ou **Rejeter** (ou **Tout approuver**). Dans **Veille des menaces**, envoyez les éléments utiles **Vers le registre** ou **Écarter**-les.",
        ],
      },
      {
        heading: "Comment construire un profil de menace",
        steps: [
          "Ouvrez une menace qui vous appartient et cliquez sur **Ajouter un profil**.",
          "Décrivez l’origine, les objectifs, le mode opératoire, les conditions et les facteurs aggravants, et définissez la fréquence, la probabilité, la gravité et la famille de menace. Liez les actifs et les vulnérabilités.",
          "Une fois le profil complet, un RSSI ou un gestionnaire de risques clique sur **Valider le profil**, puis plus tard sur **Enregistrer une revue**.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Utilisez le filtre **Revue en retard** pour trouver les profils qui demandent de l’attention.",
          "L’ajout de menaces et l’approbation des éléments de flux sont réservés aux analystes sécurité et aux RSSI.",
        ],
      },
    ],
  },
  {
    id: "incidents",
    route: "/incidents",
    group: "exposure",
    title: "Incidents",
    summary: "Enregistrez les incidents de sécurité, mettez-les à jour tout au long de leur cycle de vie et transformez-les en scénarios de risque.",
    keywords: ["incident", "incident de sécurité", "violation de données", "breach", "malware", "logiciel malveillant", "hameçonnage", "phishing", "panne", "notification", "événement de sécurité", "modifier", "statut", "cycle de vie", "chronologie", "cause racine", "post-mortem", "retour d’expérience"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le registre des incidents liste chaque incident de sécurité avec sa catégorie (violation de données, accès non autorisé, logiciel malveillant, hameçonnage, déni de service, menace interne, sécurité physique, panne système, violation de politique, autre), sa gravité et son statut (Ouvert, En investigation, Contenu, Résolu, Clôturé, Post-mortem). Les tuiles KPI indiquent le total ainsi que les incidents ouverts, en investigation et critiques.",
      },
      {
        heading: "Comment déclarer un incident",
        steps: [
          "Cliquez sur **Signaler un incident**.",
          "Saisissez le titre et la description, puis choisissez la catégorie et la gravité.",
          "Liez les vulnérabilités et actifs concernés, et listez les autres systèmes affectés.",
          "Cochez **Notification de violation requise** si l’incident doit être déclaré à une autorité, puis enregistrez.",
        ],
      },
      {
        heading: "Comment ouvrir et mettre à jour un incident",
        steps: [
          "Cliquez sur la ligne d’un incident pour ouvrir sa fenêtre de détail. L’en-tête indique qui l’a signalé, sa date de création et sa dernière mise à jour.",
          "Les pastilles de statut suivent le cycle de vie dans l’ordre : Ouvert, Investigation en cours, Confiné, Résolu, Clôturé, Retour d’expérience. Cliquez sur une pastille, ou sur **Passer à** suivi du statut suivant, pour le changer. Le changement est enregistré immédiatement, et le passage à Confiné ou Résolu renseigne automatiquement la date correspondante si elle est encore vide.",
          "Mettez à jour les sections utiles : **Vue d’ensemble** (titre, description, catégorie, gravité, personne assignée, étiquettes), **Chronologie** (dates de détection, de confinement et de résolution), **Périmètre et impact** (actifs et vulnérabilités liés, systèmes affectés, utilisateurs affectés, impact financier, types de données, impact métier), **Réponse et résolution** (actions de confinement, cause racine, actions de remédiation, retours d’expérience, URL du post-mortem) et **Notification de violation** (date d’envoi de la notification et référence réglementaire).",
          "Cliquez sur **Enregistrer**. Le bouton n’est actif qu’après une modification, et seuls les champs modifiés sont enregistrés.",
          "Pour supprimer l’incident, cliquez sur **Supprimer**, puis confirmez avec **Supprimer** dans la barre rouge (ou **Annuler**). La suppression est définitive.",
        ],
      },
      {
        heading: "Comment tirer les leçons d’un incident",
        steps: ["Cliquez sur l’icône **Create risk scenario from this incident** (Créer un scénario de risque à partir de cet incident) sur la ligne, ou sur le bouton du même nom en bas de la fenêtre de l’incident. Un scénario prérempli s’ouvre dans Scénarios de risque pour que vous le complétiez."],
      },
      {
        heading: "Astuces",
        tips: [
          "Utilisez la zone de recherche et les filtres de gravité et de statut pour retrouver rapidement un incident.",
          "La déclaration, la modification et la suppression des incidents sont réservées aux analystes sécurité, RSSI et administrateurs. Les autres utilisateurs peuvent ouvrir un incident, mais en lecture seule.",
        ],
      },
    ],
  },

  // ──────────────────────── Conformité et contrôles ────────────────────────
  {
    id: "compliance",
    route: "/compliance",
    group: "compliance",
    title: "Évaluations de conformité",
    summary: "Évaluez votre organisation par rapport à un référentiel : téléversez vos documents, laissez l’IA analyser chaque contrôle, examinez les lacunes et planifiez la remédiation.",
    keywords: ["évaluation", "conformité", "analyse d’écarts", "gap analysis", "lacunes", "ISO 27001", "SOC 2", "preuves", "evidence", "analyse IA", "SoA", "DdA", "déclaration d’applicabilité", "traçabilité", "score"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque évaluation mesure un référentiel sur un périmètre choisi (toute l’organisation, une entité, un processus ou des actifs). L’IA lit vos documents, évalue chaque contrôle et produit un score de conformité et un rapport de lacunes. La page liste vos évaluations avec des filtres En cours, En révision, Terminée et Brouillon, ainsi qu’un tableau de bord exportable en Excel ou PDF.",
      },
      {
        heading: "Comment mener une évaluation",
        steps: [
          "Cliquez sur **Nouvelle évaluation**, donnez-lui un nom, choisissez le référentiel, le périmètre et l’échelle de conformité, puis cliquez sur **Créer une évaluation**.",
          "Dans **Téléverser & Analyser**, déposez vos politiques et preuves (PDF, DOCX, XLSX, XLS, TXT — jusqu’à 10 Mo chacun).",
          "Cliquez sur **Lancer l’analyse IA**. L’analyse prend généralement 1 à 5 minutes et se termine par votre score de conformité.",
          "Utilisez la **Liste de documents** pour voir quels documents obligatoires manquent encore.",
        ],
      },
      {
        heading: "Comment examiner les résultats et les lacunes",
        steps: [
          "Dans **Résultats**, ouvrez un contrôle pour lire l’évaluation de l’IA. Utilisez **Remplacer le statut** si vous n’êtes pas d’accord, ajoutez une justification, désignez un responsable ou cliquez sur **Générer une politique**.",
          "Dans **Rapport de lacunes**, cliquez sur **Accepter la lacune** ou **Rejeter la lacune**, ou sur **Accepter tout le critique**. Les lacunes acceptées deviennent des actions dans le Plan d’action.",
          "Cliquez sur **Générer un plan 90 jours** pour obtenir une feuille de route de remédiation, et sur **Matrice de traçabilité** pour voir les liens exigence → preuve.",
          "Utilisez **Exporter CSV**, **Rapport complet**, **DdA / SoA** ou **Partager** pour diffuser les résultats.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Une preuve rattachée à un contrôle est automatiquement partagée avec les contrôles équivalents des autres référentiels ; voir l’onglet **Multi-référentiels**.",
          "Choisissez **Afficher à l’auditeur** ou **Cacher à l’auditeur** pour chaque fichier de la liste de documents.",
          "Les contrôles obligatoires ne peuvent pas être définis comme Non applicable.",
        ],
      },
    ],
  },
  {
    id: "framework",
    route: "/framework",
    group: "compliance",
    title: "Référentiels",
    summary: "Parcourez les normes et réglementations intégrées, personnalisez-les en copie modifiable, importez ou créez des référentiels sur mesure, ou rédigez-en un de zéro.",
    keywords: ["référentiel", "framework", "norme", "standard", "réglementation", "ISO", "NIST", "GDPR", "RGPD", "NIS2", "DORA", "personnaliser", "cloner", "import", "constructeur", "correspondance", "crosswalk", "de zéro", "politique interne", "référentiel maison"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La bibliothèque de référentiels contient les normes, réglementations et lois intégrées ainsi que les référentiels personnalisés de votre organisation. Ouvrez un référentiel pour consulter ses contrôles, les indicateurs d’obligation et les équivalences dans d’autres référentiels. Les référentiels intégrés sont en lecture seule et partagés ; vos copies personnalisées sont entièrement modifiables.",
      },
      {
        heading: "Comment personnaliser un référentiel intégré",
        steps: [
          "Cliquez sur **Personnaliser** sur la carte d’un référentiel intégré. Une copie modifiable est créée dans votre espace de travail.",
          "Sur la page de modification, renommez le référentiel, modifiez ou supprimez des contrôles, ou cliquez sur **Ajouter un contrôle** (créé de zéro ou importé d’un autre référentiel).",
          "Ajoutez si besoin des traductions pour les titres et descriptions des contrôles.",
          "Utilisez **Comparer à la source** pour voir ce qui a changé, et **Resynchroniser depuis la source** pour récupérer les mises à jour tout en conservant vos modifications.",
        ],
      },
      {
        heading: "Comment créer ou importer un référentiel personnalisé",
        steps: [
          "Cliquez sur **Créer un Cadre Personnalisé** et renseignez le nom, la version, le secteur, la région et une description du cas d’usage.",
          "Parcourez les contrôles des référentiels existants et sélectionnez ceux dont vous avez besoin.",
          "Cliquez sur **Obtenir des Suggestions IA** pour des contrôles supplémentaires, ou sur **Ajouter Votre Propre Contrôle**, puis sur **Sauvegarder le Référentiel**.",
          "Ou cliquez sur **Importer un référentiel** pour charger un fichier CSV, Excel ou YAML. Cochez **Validate without importing** (valider sans importer) pour tester le fichier au préalable.",
        ],
      },
      {
        heading: "Comment créer un référentiel de zéro",
        steps: [
          "Cliquez sur **Créer de zéro** (à côté de **Importer un référentiel** et **Créer un Cadre Personnalisé**).",
          "Dans **Détails du référentiel**, saisissez le nom, le nom court, la version, la description et l’organisme émetteur, choisissez le **Type de source** (Norme, Réglementation, Loi ou Politique interne) ainsi que les régions et secteurs applicables, puis cliquez sur **Enregistrer les détails**.",
          "Dans **Ajouter un contrôle**, saisissez la référence et le titre du contrôle, puis, si besoin, sa catégorie, son **Domaine**, son **Type d’exigence** (Exigence, Recommandation ou Mesure), sa description et son guide de mise en œuvre.",
          "Dans **Contrôles correspondants**, indiquez les contrôles équivalents d’autres référentiels (p. ex. `ISO27001:A.5.1, PCI-DSS:1.1`), ajoutez des mots-clés, cochez **Obligatoire** si le contrôle ne peut pas être déclaré non applicable, et ajoutez des **Exigences** avec un niveau must / should / may.",
          "Cliquez sur **Ajouter un contrôle**, et recommencez pour chaque contrôle de votre référentiel.",
        ],
        tips: ["Utilisez **Créer de zéro** pour saisir votre propre norme, réglementation ou politique interne. Utilisez **Créer un Cadre Personnalisé** pour assembler un référentiel à partir de contrôles déjà présents dans la bibliothèque."],
      },
      {
        heading: "Astuces",
        tips: [
          "Sélectionnez des contrôles dans un référentiel et cliquez sur **Générer avec IA** pour rédiger les politiques correspondantes.",
          "Réimporter un fichier met à jour les contrôles ayant la même référence au lieu de les dupliquer.",
          "Choisissez votre référentiel principal dans **Paramètres → Référentiel**.",
        ],
      },
    ],
  },
  {
    id: "requirements",
    route: "/requirements",
    group: "compliance",
    title: "Référentiel des exigences",
    summary: "Un registre unique et consultable de toutes les exigences issues de vos normes, réglementations, lois et politiques internes, avec les décisions d’applicabilité.",
    keywords: ["exigence", "requirement", "applicabilité", "non applicable", "SoA", "DdA", "registre", "réglementation", "loi"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le Référentiel des exigences regroupe dans une seule liste toutes les exigences de toutes vos sources, pour que vous décidiez une seule fois si chacune s’applique à vous. Les exigences sans décision sont considérées comme applicables.",
      },
      {
        heading: "Comment enregistrer une décision d’applicabilité",
        steps: [
          "Recherchez ou filtrez par registre, référentiel, source, domaine, type ou applicabilité.",
          "Cliquez sur une exigence pour ouvrir son détail, y compris ses équivalences et les politiques internes qui la couvrent.",
          "Choisissez **Applicable**, **Non applicable** ou **Partiellement applicable**, ainsi que le périmètre (toute l’organisation, un département ou un processus métier).",
          "Ajoutez une justification (obligatoire pour Non applicable) et une date de révision, puis cliquez sur **Enregistrer la décision**.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Utilisez **Ouvrir dans son registre** pour accéder au référentiel source."],
      },
    ],
  },
  {
    id: "action-plan",
    route: "/action-plan",
    group: "compliance",
    title: "Plan d’action de conformité",
    summary: "Un tableau de tâches priorisé construit à partir de toutes vos lacunes de conformité acceptées, suivi de « À faire » à « Terminé ».",
    keywords: ["plan d’action", "action plan", "remédiation", "kanban", "à faire", "lacune", "gap", "corrective", "préventive", "en retard"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Lorsque vous acceptez une lacune dans une évaluation de conformité, une action apparaît ici. Le tableau présente toutes les actions de toutes les évaluations en quatre colonnes : À faire, En cours, Terminé et Annulé, avec une barre de progression globale et le nombre d’éléments en retard et bloquants.",
      },
      {
        heading: "Comment traiter les actions",
        steps: [
          "Filtrez par référentiel, priorité ou nature (corrective ou préventive).",
          "Faites glisser une carte d’une colonne à l’autre, ou utilisez **Démarrer**, **Marquer comme terminé** et **Rouvrir**.",
          "Ouvrez une carte pour modifier le responsable, la priorité, les dates, la récurrence et les notes, et pour joindre des preuves.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Les cartes marquées **BLOQUANT** ou **(En retard)** sont à traiter en priorité.",
          "Terminer une action peut clôturer automatiquement l’exigence associée.",
        ],
      },
    ],
  },
  {
    id: "control-effectiveness",
    route: "/control-effectiveness",
    group: "controls",
    title: "Efficacité des contrôles",
    summary: "Évaluez sur cinq critères dans quelle mesure chaque contrôle appliqué fonctionne réellement, et assurez le suivi de ceux jugés inefficaces.",
    keywords: ["efficacité", "effectiveness", "test des contrôles", "évaluation", "quatre yeux", "four-eyes", "performance", "assurance"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque évaluation note un contrôle de 0 à 2 sur cinq critères : Formalisme, Type de contrôle, Temporalité, Traçabilité et Principe des quatre yeux. Le total donne un niveau de performance : performant (8 ou plus), moyennement performant (5–7) ou non performant. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment évaluer un contrôle",
        steps: [
          "Cliquez sur **Nouvelle évaluation** et choisissez le contrôle.",
          "Notez les cinq critères.",
          "Indiquez sur quoi repose l’évaluation (audit interne, test technique, indicateur de performance, revue documentaire ou entretien) et ajoutez une référence de preuve et des notes.",
          "Définissez la date de la prochaine évaluation et enregistrez.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Les contrôles déclarés inefficaces apparaissent dans une liste de suivi jusqu’à ce qu’un plan d’action soit enregistré."],
      },
    ],
  },
  {
    id: "applied-controls",
    route: "/applied-controls",
    group: "controls",
    title: "Contrôles appliqués",
    summary: "Le registre des mesures de sécurité en place ou prévues, avec coût, effort, avancement, expiration et validation.",
    keywords: ["contrôle", "mesure de sécurité", "safeguard", "mesure", "mise en œuvre", "coût", "validation", "sign-off", "expiration", "NIST CSF"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Les contrôles appliqués sont les mesures réellement opérées par votre organisation. Chacun a un statut (planifié, en cours, mis en œuvre, non applicable, obsolète), un coût, un avancement, une date d’expiration et une validation (en attente, validé, rejeté). Les contrôles peuvent être liés à des scénarios de risque.",
      },
      {
        heading: "Comment ajouter un contrôle",
        steps: [
          "Cliquez sur **Ajouter un contrôle**.",
          "Saisissez la référence, le nom, la catégorie et la description.",
          "Ajoutez l’effort, le coût, le coût récurrent, la date prévue (ETA) et la date d’expiration, et liez les scénarios de risque qu’il réduit.",
          "Enregistrez. Un valideur habilité clique ensuite sur **Valider** ou **Rejeter** (avec un motif).",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Le panneau **Controls needing attention** (contrôles nécessitant une attention) liste les contrôles expirés, arrivant à expiration, rejetés, jamais évalués ou non validés.",
          "La suppression d’un contrôle exige une justification, et chaque modification est conservée dans l’historique des changements.",
          "Une validation est signalée lorsque le contrôle a été modifié après sa signature.",
        ],
      },
    ],
  },
  {
    id: "security-exceptions",
    route: "/security-exceptions",
    group: "controls",
    title: "Exceptions et dérogations",
    summary: "Demandez, approuvez et suivez les exceptions formelles aux règles de sécurité et les acceptations de risques, avec mesures compensatoires et dates d’expiration.",
    keywords: ["exception", "dérogation", "waiver", "acceptation du risque", "risk acceptance", "approbation", "mesure compensatoire", "contrôle compensatoire", "expiration"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Lorsqu’une règle ne peut pas être respectée, enregistrez une exception plutôt que de l’ignorer. Les exceptions ont un type (risque, contrôle, vulnérabilité, exigence, actif), une gravité, une justification, des mesures compensatoires et une date d’expiration. Les statuts sont : en attente d’approbation, approuvée, rejetée, expirée et révoquée. Un second onglet suit les **Acceptations de risques**.",
      },
      {
        heading: "Comment demander une exception",
        steps: [
          "Dans **Exceptions**, cliquez sur **Nouvelle exception**.",
          "Saisissez le titre, la justification et la date d’expiration (obligatoires), ainsi que la description, la gravité, le type et les mesures compensatoires.",
          "Enregistrez. L’exception reste en attente d’approbation.",
          "Un RSSI l’ouvre et clique sur **Approuver** ou **Rejeter** (avec un motif).",
        ],
      },
      {
        heading: "Comment enregistrer une acceptation de risque",
        steps: [
          "Ouvrez l’onglet **Acceptations de risques** et cliquez sur **Nouvelle acceptation de risque**.",
          "Saisissez le nom, la justification et la date d’expiration, puis enregistrez pour approbation.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Principe des quatre yeux : la personne qui a demandé une exception ne peut pas l’approuver.",
          "Les éléments dont la date est dépassée affichent un badge **Expirée**.",
        ],
      },
    ],
  },

  // ──────────────────────────────── Audit ────────────────────────────────
  {
    id: "audits",
    route: "/audits",
    group: "audit",
    title: "Audits",
    summary: "Planifiez et conduisez des audits internes, externes, de certification et réglementaires : plan, constats, preuves, approbation et diffusion du rapport.",
    keywords: ["audit", "constat", "finding", "non-conformité", "auditeur", "preuves", "evidence", "rapport d’audit", "mission d’audit", "engagement"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque audit passe par les étapes Planification, Travaux terrain, Révision, Rapport et Clôturé. Un audit peut s’appuyer sur un référentiel ou une grille d’évaluation, un périmètre (entités, processus, systèmes), un auditeur principal et une périodicité (ponctuel, annuel, semestriel — les audits récurrents sont automatiquement replanifiés à leur clôture).",
      },
      {
        heading: "Comment créer et conduire un audit",
        steps: [
          "Cliquez sur **Nouvel audit**, renseignez le titre, le type, les dates, le périmètre, le référentiel ou la grille d’évaluation, l’auditeur principal et la périodicité, puis enregistrez.",
          "Ouvrez l’audit. Dans **Plan d’audit**, cliquez sur **Générer avec l’IA** ou rédigez le plan, puis cliquez sur **Enregistrer le plan**.",
          "Dans **Constats**, cliquez sur **Nouveau constat** et renseignez le type (non-conformité majeure ou mineure, observation, piste d’amélioration), la gravité, le contrôle, la recommandation, le responsable et l’échéance.",
          "Téléversez les pièces justificatives dans **Preuves**, et échangez dans **Échanges** (en interne ou de façon partagée).",
        ],
      },
      {
        heading: "Comment produire le rapport",
        steps: [
          "Dans **Rapport**, cliquez sur **Générer le rapport**, puis sur **Soumettre à validation**.",
          "Une autre personne clique sur **Approuver** ou **Rejeter** (avec un motif).",
          "Une fois le rapport approuvé, téléchargez le PDF et cliquez sur **Diffuser le rapport** pour l’envoyer aux destinataires.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Utilisez **Ajouter un auditeur** et l’onglet **Comptes auditeurs** pour créer des comptes auditeurs et les affecter aux évaluations de conformité. Les auditeurs se connectent à leur propre Portail auditeur.",
          "La clôture d’un constat exige une note ; les constats clôturés ne peuvent pas être supprimés.",
        ],
      },
    ],
  },
  {
    id: "recommendations",
    route: "/recommendations",
    group: "audit",
    title: "Suivi des recommandations",
    summary: "Suivez chaque recommandation émise par un audit jusqu’à sa clôture effective.",
    keywords: ["recommandation", "suivi d’audit", "follow-up", "remédiation", "en retard", "taux de clôture"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Cette page suit les recommandations d’audit avec un responsable, une échéance, une priorité et un avancement. Les statuts sont En attente, En cours, Clôturée, Rejetée et En retard. Les KPI indiquent le total, les éléments en retard et le taux de clôture, avec un tableau de bord par gravité, statut et responsable.",
      },
      {
        heading: "Comment suivre une recommandation",
        steps: [
          "Les recommandations se créent dans un audit, dans son onglet **Recommandations**, avec un responsable, une échéance, une priorité et un constat lié.",
          "Mettez à jour l’avancement avec **Modifier** au fil des travaux.",
          "Cliquez sur **Clôturer la recommandation** et ajoutez une note de clôture une fois le travail terminé.",
          "Cliquez sur **Actualiser les statuts** pour recalculer les statuts à partir des actions liées.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Filtrez par statut, responsable ou audit, ou cochez **En retard uniquement** avant une réunion de suivi."],
      },
    ],
  },
  {
    id: "audit-grids",
    route: "/audit-grids",
    group: "audit",
    title: "Grilles d’évaluation",
    summary: "Concevez vos propres listes de contrôle d’audit avec sections, points à évaluer et échelle de conformité personnalisée.",
    keywords: ["grille d’évaluation", "evaluation grid", "liste de contrôle", "checklist", "modèle d’audit", "échelle de conformité", "questionnaire"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Une grille d’évaluation est la liste de contrôle que suit l’auditeur. Vous pouvez la créer de zéro ou l’initialiser à partir d’un référentiel, et définir les niveaux de conformité utilisés pour coter chaque point. Seuls les administrateurs, RSSI et responsables conformité peuvent gérer les grilles.",
      },
      {
        heading: "Comment construire une grille",
        steps: [
          "Cliquez sur **Nouvelle grille** et saisissez un nom et un objectif.",
          "Utilisez éventuellement **Initialiser depuis un référentiel** pour copier ses contrôles sous forme de lignes modifiables.",
          "Cliquez sur **Ajouter une ligne** et saisissez la référence, le point à évaluer et les consignes.",
          "Ajustez les niveaux de conformité (libellé EN/FR/AR, couleur, pondération, et si le niveau ouvre une lacune). **Rétablir les niveaux par défaut** revient à Conforme / Partiellement conforme / Non conforme / Non applicable.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Sélectionnez la grille lors de la création d’un audit pour l’utiliser à la place des contrôles du référentiel."],
      },
    ],
  },

  // ─────────────────────────── Politiques et documents ───────────────────────────
  {
    id: "policies",
    route: "/policies",
    group: "documents",
    title: "Politiques",
    summary: "Gérez vos politiques de la révision à l’approbation et à la publication, avec historique des versions et attestations du personnel.",
    keywords: ["politique", "policy", "procédure", "approbation", "version", "attestation", "prise de connaissance", "acknowledgement", "cycle de révision", "PSSI"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque politique a une catégorie, un propriétaire, un cycle de révision (tous les 6 mois, tous les ans ou tous les 2 ans), des dates d’entrée en vigueur et d’expiration et des contrôles liés. Les statuts sont Brouillon, En révision, Approuvée, Publiée et Retirée ; les révisions en retard sont signalées.",
      },
      {
        heading: "Comment créer et approuver une politique",
        steps: [
          "Cliquez sur **Nouvelle politique**, renseignez les informations et enregistrez.",
          "Dans **Contenu**, rédigez le texte ou utilisez **Rédiger avec l’IA**, puis cliquez sur **Enregistrer nouvelle version** avec un résumé des modifications.",
          "Dans **Vue d’ensemble**, utilisez le **Workflow d’approbation** : **Soumettre pour révision**, puis **Approuver**, puis **Publier**.",
        ],
      },
      {
        heading: "Comment recueillir les attestations",
        steps: [
          "Ouvrez l’onglet **Attestations**.",
          "Cliquez sur **Demander une attestation**, choisissez les utilisateurs et une échéance, puis cliquez sur **Envoyer** — ou utilisez **Envoyer à tous les utilisateurs**.",
          "Suivez chaque personne : En attente, Pris connaissance ou En retard.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "**Restore this version** (restaurer cette version), dans l’historique des versions, rétablit un texte antérieur.",
          "Utilisez **Exporter en PDF** pour partager une politique en dehors de la plateforme.",
          "Besoin d’un premier jet ? Cliquez sur **Ouvrir le générateur**.",
        ],
      },
    ],
  },
  {
    id: "policy-generator",
    route: "/policy-generator",
    group: "documents",
    title: "Générateur de documents",
    summary: "Générez avec l’IA des politiques, procédures et plans adaptés à votre organisation. Chaque document est enregistré comme une seule politique versionnée.",
    keywords: ["IA", "AI", "générer", "générateur", "modèle", "modèle de politique", "procédure", "PCA", "BCP", "PRA", "DRP", "réponse aux incidents", "SoA", "DdA"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le Générateur de documents rédige pour vous des documents GRC répartis en quatre groupes : documents fondamentaux (p. ex. politique de sécurité de l’information, périmètre du SMSI, DdA/SoA), politiques de sécurité (contrôle d’accès, usage acceptable, mots de passe, BYOD…), procédures et standards (réponse aux incidents, gestion des changements, sauvegarde…) et plans (PCA, PRA, plan de réponse aux incidents, plan de traitement des risques).",
      },
      {
        heading: "Comment générer un document",
        steps: [
          "Choisissez le type de document.",
          "Renseignez le contexte de votre organisation : nom de l’entreprise, taille, secteur, pays, référentiels visés et, éventuellement, contrôles visés et exigences particulières.",
          "Cliquez sur **Générer le Document**. À la fin de la génération, le document est enregistré automatiquement, une seule fois, comme politique en brouillon. Vous le retrouvez dans **Documents Précédents** et dans Politiques.",
          "Relisez le résultat et modifiez-le si nécessaire. Cliquer sur **Régénérer** pour le même document ajoute une nouvelle version à ce brouillon au lieu de créer une autre politique.",
          "Cliquez sur **Enregistrer comme Brouillon** pour enregistrer vos modifications comme nouvelle version de la même politique. Le bouton est grisé tant que rien n’a changé depuis le dernier enregistrement.",
          "Cliquez sur **Approuver & Enregistrer** pour approuver la version en cours et passer la politique au statut approuvé. Votre nom est enregistré comme approbateur.",
        ],
      },
      {
        heading: "Comment reprendre un document précédent",
        steps: [
          "Dans **Documents Précédents**, cliquez sur un document pour ouvrir sa version en cours.",
          "Modifiez-le, puis cliquez sur **Enregistrer comme Brouillon** ou **Approuver & Enregistrer**. Vos modifications sont ajoutées comme nouvelle version de ce document, et non enregistrées comme une copie.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Chaque document généré donne une seule politique avec son propre historique de versions : enregistrer plusieurs fois ne crée jamais de doublon. Choisir un autre type de document démarre une nouvelle politique.",
          "L’approbation est réservée aux responsables des politiques et aux RSSI (ainsi qu’aux administrateurs).",
          "Utilisez **Copier** ou **Télécharger PDF** pour réutiliser le texte ailleurs.",
          "Faites toujours relire le texte produit par l’IA par un responsable avant de l’approuver.",
        ],
      },
    ],
  },
  {
    id: "ocr",
    route: "/ocr",
    group: "documents",
    title: "Capture de documents (OCR)",
    summary: "Transformez des documents numérisés et des images en texte consultable ou en PDF interrogeables.",
    keywords: ["OCR", "numérisation", "scan", "reconnaissance de texte", "PDF", "image", "PDF interrogeable", "searchable PDF", "extraction"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Capture de documents lit les fichiers PDF, PNG, JPEG et TIFF et en extrait le texte en français, en anglais ou en arabe. Les PDF qui contiennent déjà du texte sont lus directement ; chaque page indique si elle a utilisé la couche texte ou l’OCR. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment extraire le texte",
        steps: [
          "Faites glisser un fichier sur la page ou parcourez vos dossiers pour le sélectionner.",
          "Choisissez la langue du document.",
          "Cliquez sur **Extraire le texte**.",
          "Utilisez **Copier**, **Télécharger .txt**, **PDF texte** ou **PDF interrogeable** (le document numérisé d’origine avec du texte sélectionnable).",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Des numérisations nettes et droites donnent de bien meilleurs résultats. Des limites de taille et de nombre de pages s’appliquent."],
      },
    ],
  },

  // ─────────────────────────────── Tiers ───────────────────────────────
  {
    id: "vendors",
    route: "/vendors",
    group: "third_parties",
    title: "Tiers (TPRM)",
    summary: "Gérez les risques liés aux tiers : registre des fournisseurs, questionnaire de présélection, revue de contrat par l’IA avec approbation du RSSI, collaboration et cartographie des risques.",
    keywords: ["tiers", "fournisseur", "prestataire", "sous-traitant", "vendor", "supplier", "third party", "TPRM", "contrat", "DPA", "questionnaire", "due diligence", "signature électronique", "e-signature"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le registre liste chaque tiers avec son niveau de risque (Critique, Élevé, Moyen, Faible), son statut, son score de risque, son DPA, l’expiration de son contrat et ses services. Les KPI mettent en évidence le score de risque moyen, les DPA manquants et les fournisseurs en cours de revue.",
      },
      {
        heading: "Comment ajouter un tiers",
        steps: [
          "Cliquez sur **Ajouter un tiers** et saisissez les informations de l’entreprise, les services, le niveau, le statut, le DPA et l’expiration du contrat. Vous pouvez joindre le contrat pour une revue par l’IA.",
          "Cliquez sur **Next: Questionnaire** (étape suivante : questionnaire) et répondez aux 15 questions de présélection sur la sécurité, la conformité et les opérations.",
          "Cliquez sur **Analyze with AI** (analyser avec l’IA), examinez les conclusions de l’IA (niveau de risque, points forts, préoccupations, signaux d’alerte) et le score de risque proposé, puis cliquez sur **Save 3rd Party** (enregistrer le tiers).",
        ],
      },
      {
        heading: "Fonctionnement de l’approbation des contrats",
        steps: [
          "Téléversez un contrat. L’IA l’analyse (statut **AI Analyzing**, puis **Ready for CISO**, c’est-à-dire prêt pour le RSSI).",
          "Le RSSI clique sur **Révision des contrats**, ouvre le contrat, lit les conclusions de l’IA et clique sur **Approve Contract** (approuver) ou **Reject Contract** (rejeter ; commentaires obligatoires en cas de rejet).",
          "Une fois le contrat approuvé, cliquez sur **Send to Vendor** (envoyer au fournisseur).",
          "Utilisez **Start Collaboration with Vendor** pour négocier : partagez un lien, travaillez ensemble sur les points ouverts et un plan, échangez par messagerie, cliquez sur **Mark Agreed** (marquer comme convenu), puis les deux parties signent l’accord en saisissant leur nom complet.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Ouvrez l’onglet **Cartographie des risques** d’un fournisseur et cliquez sur **Évaluation des risques IA** pour une vue des risques multidimensionnelle.",
          "L’onglet Vue d’ensemble vous avertit lorsqu’un DPA est manquant.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Gouvernance ───────────────────────────────
  {
    id: "governance",
    route: "/governance",
    group: "governance",
    title: "Gouvernance",
    summary: "Définissez qui est responsable de quoi (RACI), tenez un référentiel documentaire de gouvernance avec contrôle d’accès, et animez les comités de pilotage.",
    keywords: ["RACI", "responsabilité", "comité", "comité de pilotage", "steering committee", "gestion documentaire", "référentiel documentaire", "charte", "compte rendu", "procès-verbal"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Gouvernance réunit trois éléments : une matrice RACI des activités et décisions, un référentiel pour les documents de gouvernance (chartes, comptes rendus, procédures, plans…) et vos comités de pilotage. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment remplir la matrice RACI",
        steps: [
          "Saisissez une **Activité / décision** et choisissez R, A, C ou I.",
          "Choisissez la partie responsable **Par rôle** (ou un rôle personnalisé) ou **By group** (par groupe), ainsi que le module, puis cliquez sur **Ajouter**.",
          "Utilisez **Preview role** (aperçu du rôle) pour voir toutes les responsabilités d’un rôle.",
        ],
      },
      {
        heading: "Comment gérer les documents et les comités",
        steps: [
          "Cliquez sur **Nouveau document**, saisissez le titre, la typologie, le module, le niveau d’accès et le contenu.",
          "Utilisez **Gérer les accès** pour accorder des droits de consultation, de modification ou de validation à un utilisateur ou à un rôle.",
          "Cliquez sur **Nouveau comité** et définissez son nom, sa périodicité, ses membres, sa prochaine réunion ainsi que les politiques et documents liés.",
        ],
      },
    ],
  },
  {
    id: "regulatory",
    route: "/regulatory",
    group: "governance",
    title: "Mises à jour réglementaires",
    summary: "Suivez les réglementations nouvelles ou modifiées, leur impact et leurs échéances, avec des propositions de l’IA à examiner.",
    keywords: ["réglementation", "veille réglementaire", "changement réglementaire", "regulatory change", "loi", "échéance", "GDPR", "RGPD", "NIS2", "horizon scanning"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Chaque mise à jour enregistre la réglementation, la source, l’impact (de critique à informatif), la date d’entrée en vigueur et l’échéance. Les statuts passent de nouveau à en révision, action requise, puis finalement mis en œuvre ou non applicable.",
      },
      {
        heading: "Comment suivre les mises à jour",
        steps: [
          "Cliquez sur **Récupérer (IA)** pour obtenir des propositions de mises à jour, puis cliquez sur **Approuver** ou **Rejeter** pour chacune dans **Propositions IA — En attente de votre révision**.",
          "Ou cliquez sur **Ajouter** et saisissez le titre, la source, la réglementation, l’impact, les dates, l’URL et la description.",
          "Cliquez sur une ligne pour voir le détail et mettre à jour son statut.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Les RSSI et administrateurs peuvent cliquer sur **Contrôle de référentiel en brouillon** pour transformer une mise à jour en nouveau contrôle dans un référentiel personnalisé."],
      },
    ],
  },
  {
    id: "archiving",
    route: "/archiving",
    group: "governance",
    title: "Archivage et rétention",
    summary: "Archivez des enregistrements avec une durée de conservation, consultez-les sans les restaurer, exportez l’archive et automatisez l’archivage par des règles.",
    keywords: ["archive", "archivage", "rétention", "durée de conservation", "purge", "gestion des enregistrements", "records management", "export", "intégrité"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "L’archivage prend un instantané d’un enregistrement (risque, politique, audit, contrôle, évaluation, document, vulnérabilité) avec une durée de conservation. Vous pouvez consulter l’instantané, y compris les constats enfants et les fichiers de preuve avec contrôle d’intégrité, sans le restaurer. Disponible si l’Elite Pack est activé pour votre organisation.",
      },
      {
        heading: "Comment archiver et exporter",
        steps: [
          "Cliquez sur **Archiver**, choisissez le type d’entité et l’enregistrement, définissez la conservation en jours et indiquez un motif.",
          "Cliquez sur **Consulter** sur un enregistrement archivé pour l’afficher en lecture seule.",
          "Utilisez **Exporter**, **CSV** ou **PDF** pour télécharger l’archive.",
        ],
      },
      {
        heading: "Comment automatiser avec des règles",
        steps: [
          "Dans **Règles d’archivage**, cliquez sur **Nouvelle règle**.",
          "Choisissez l’entité, la conservation et les critères (par exemple `status=closed AND age_days>365`).",
          "Cochez **Activer dès la création** et enregistrez. Le tableau affiche la dernière et la prochaine exécution.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Seuls les administrateurs peuvent cliquer sur **Purger expirés**, et doivent saisir PURGE pour confirmer."],
      },
    ],
  },
  {
    id: "webhooks",
    route: "/webhooks",
    group: "governance",
    title: "Webhooks",
    summary: "Envoyez en temps réel des notifications d’événements de GRC Eye vers vos autres outils.",
    keywords: ["webhook", "intégration", "API", "notification", "événements", "SIEM", "Slack", "Teams"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Un webhook envoie un message à l’adresse de votre choix chaque fois que des événements sélectionnés se produisent, par exemple la création d’un risque, la résolution d’un incident, l’ajout d’un constat d’audit ou la publication d’une politique. Seuls les administrateurs du tenant peuvent gérer les webhooks.",
      },
      {
        heading: "Comment ajouter un webhook",
        steps: [
          "Cliquez sur **Ajouter un webhook**.",
          "Saisissez l’URL du webhook et une description.",
          "Cochez au moins un événement (vous pouvez sélectionner tout un module d’un coup), puis cliquez sur **Créer le webhook**.",
          "Cliquez sur **Tester** pour envoyer un ping de test et vérifier la réponse.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["Les webhooks ne sont pas modifiables : supprimez-en un et recréez-le pour changer ses événements."],
      },
    ],
  },

  // ─────────────────────────────── Rapports et support ───────────────────────────────
  {
    id: "reports",
    route: "/reports",
    group: "reporting",
    title: "Rapports",
    summary: "Générez, prévisualisez et téléchargez des rapports PDF, et planifiez leur envoi automatique par e-mail.",
    keywords: ["rapport", "reporting", "PDF", "résumé exécutif", "executive summary", "rapport hebdomadaire", "planification", "e-mail", "téléchargement"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Cinq rapports PDF sont disponibles : Résumé exécutif, Rapport du registre des risques, Rapport de conformité, Rapport sur les risques tiers et Rapport d’audit. Ils sont générés en temps réel et couvrent les 7 derniers jours. Chaque rapport généré est conservé dans un historique avec une empreinte d’intégrité.",
      },
      {
        heading: "Comment obtenir un rapport",
        steps: [
          "Cliquez sur **Aperçu** sur la carte d’un rapport pour l’afficher dans la page.",
          "Cliquez sur **Télécharger** pour enregistrer le PDF.",
          "Utilisez le bouton d’historique pour retrouver les versions précédentes.",
        ],
      },
      {
        heading: "Comment planifier un rapport",
        steps: [
          "Dans **Rapports automatisés**, cliquez sur **Nouvelle planification**.",
          "Saisissez un nom, le type de rapport, la fréquence (quotidienne, hebdomadaire, mensuelle), l’heure et le jour.",
          "Ajoutez les adresses e-mail des destinataires, cochez **Activé** et enregistrez. Utilisez **Exécuter maintenant** pour l’envoyer immédiatement.",
        ],
        tips: ["Les rapports planifiés sont une fonctionnalité de l’Elite Pack."],
      },
    ],
  },
  {
    id: "support",
    route: "/support",
    group: "reporting",
    title: "Support",
    summary: "Ouvrez des tickets de support, suivez les réponses et discutez en direct avec l’équipe support.",
    keywords: ["aide", "support", "ticket", "demande de support", "contact", "chat en direct", "live chat", "bug", "anomalie"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Le Support vous permet de soumettre et de suivre vos demandes auprès de l’équipe GRC Eye. Les tickets passent par les statuts Ouvert, En cours, En attente, Résolu et Fermé.",
      },
      {
        heading: "Comment ouvrir un ticket",
        steps: [
          "Cliquez sur **Nouveau ticket**.",
          "Saisissez un titre, une description claire et une priorité (Faible, Moyen, Élevé, Urgent), puis cliquez sur **Soumettre le ticket**.",
          "Ouvrez le ticket pour lire les réponses et répondez avec **Envoyer**.",
        ],
      },
      {
        heading: "Astuces",
        tips: [
          "Lorsque le support lance un chat en direct, cliquez sur **Accepter** pour le rejoindre.",
          "Un badge **Nouvelle réponse** et une notification dans la cloche vous indiquent que le support a répondu.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Compte ───────────────────────────────
  {
    id: "settings",
    route: "/settings",
    group: "account",
    title: "Paramètres",
    summary: "Votre profil, les référentiels de l’espace de travail, les préférences de notification, le mot de passe et la sécurité, l’accès à l’IA et l’apparence.",
    keywords: ["paramètres", "réglages", "settings", "profil", "mot de passe", "notifications", "thème", "mode sombre", "dark mode", "LDAP", "Active Directory", "annuaire", "sessions"],
    sections: [
      {
        heading: "Contenu des Paramètres",
        body: "**Profil** affiche votre nom et votre e-mail (gérés par votre administrateur). **Référentiel** définit vos référentiels principal et secondaires. **Notifications** gère les alertes par e-mail et dans l’application pour chaque événement. **Sécurité** permet de changer votre mot de passe, de configurer ou de désactiver l’authentification à deux facteurs (la désactivation demande un code en cours de votre application) et de révoquer les sessions actives. **AI Access** (accès IA) affiche votre consommation IA mensuelle. **Apparence** modifie le thème, la couleur d’accent, la taille de police et la densité sur ce navigateur.",
      },
      {
        heading: "Comment changer votre mot de passe",
        steps: [
          "Ouvrez **Paramètres → Sécurité**.",
          "Saisissez votre mot de passe actuel, puis le nouveau deux fois.",
          "Cliquez sur **Mettre à jour le mot de passe**.",
        ],
      },
      {
        heading: "Comment définir vos référentiels",
        steps: [
          "Ouvrez **Paramètres → Référentiel**.",
          "Choisissez un référentiel principal et, éventuellement, des référentiels secondaires, puis enregistrez.",
        ],
        tips: ["Seuls les administrateurs, RSSI, responsables conformité et responsables des politiques peuvent modifier les référentiels de l’espace de travail."],
      },
      {
        heading: "Astuces",
        tips: ["Les administrateurs du tenant peuvent connecter un annuaire d’entreprise (AD/LDAP) dans l’onglet **Annuaire (AD/LDAP)** afin que le personnel se connecte avec son compte d’entreprise."],
      },
    ],
  },
  {
    id: "mfa-setup",
    route: "/mfa-setup",
    group: "account",
    title: "Authentification à deux facteurs",
    summary: "Protégez votre compte avec un code à 6 chiffres issu d’une application d’authentification, en plus de votre mot de passe.",
    keywords: ["MFA", "2FA", "double authentification", "authentification à deux facteurs", "two-factor", "TOTP", "application d’authentification", "authenticator", "sécurité", "code de connexion"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "Avec l’authentification à deux facteurs, un mot de passe volé ne suffit pas pour accéder à votre compte. Après la saisie de votre mot de passe, un code issu d’une application d’authentification comme Google Authenticator ou Microsoft Authenticator vous sera également demandé. Vous pouvez aussi y accéder depuis **Paramètres → Sécurité**.",
      },
      {
        heading: "Comment l’activer",
        steps: [
          "Cliquez sur **Activer la 2FA**.",
          "Scannez le QR code avec votre application d’authentification (ou copiez-y la clé secrète).",
          "Saisissez le code à 6 chiffres affiché dans l’application et cliquez sur **Vérifier et activer**.",
        ],
      },
      {
        heading: "Déroulement de la connexion",
        steps: [
          "Saisissez votre e-mail et votre mot de passe comme d’habitude.",
          "Sur l’écran **Vérification à deux facteurs**, saisissez le code à 6 chiffres en cours et cliquez sur **Vérifier**.",
          "Si le code est refusé, attendez le code suivant et réessayez, ou cliquez sur **Retour à la connexion**.",
        ],
      },
      {
        heading: "Comment la désactiver",
        steps: [
          "Là où s’affiche **L'authentification à deux facteurs est activée**, cliquez sur **Désactiver**.",
          "Saisissez le code à 6 chiffres en cours de votre application d’authentification et cliquez sur **Désactiver la double authentification**. Cliquez sur **Annuler** pour la conserver.",
          "Si le code est refusé comme invalide ou expiré, attendez le code suivant dans l’application et réessayez.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["La double authentification ne peut être désactivée qu’avec un code valide de votre application. Si vous perdez votre téléphone, demandez à votre administrateur de vous aider à récupérer l’accès."],
      },
    ],
  },
  {
    id: "company-admin",
    route: "/company-admin",
    group: "account",
    title: "Gestion d’équipe",
    summary: "Invitez des membres, attribuez des rôles et organisez les personnes en groupes. Réservé aux administrateurs du tenant.",
    keywords: ["utilisateurs", "équipe", "inviter", "invitation", "rôles", "permissions", "droits d’accès", "groupes", "réinitialiser le mot de passe", "désactiver", "users"],
    sections: [
      {
        heading: "À quoi ça sert",
        body: "La Gestion d’équipe est l’endroit où l’administrateur de votre organisation crée les comptes et décide de ce que chacun peut voir et faire. Seuls les administrateurs du tenant peuvent l’ouvrir ; le lien se trouve en bas de la barre latérale.",
      },
      {
        heading: "Comment inviter un membre",
        steps: [
          "Cliquez sur **Inviter un membre**.",
          "Saisissez le prénom, le nom et l’e-mail, et choisissez un ou plusieurs rôles (p. ex. RSSI, gestionnaire de risques, responsable conformité, auditeur, lecteur).",
          "Cliquez sur **Créer un compte** et copiez le mot de passe temporaire. Il n’est affiché qu’une seule fois — transmettez-le à la personne de manière sécurisée.",
        ],
      },
      {
        heading: "Comment gérer les accès",
        steps: [
          "Utilisez les actions de ligne pour modifier les rôles, réinitialiser un mot de passe, activer ou désactiver, ou supprimer un utilisateur.",
          "Dans **Groupes**, cliquez sur **Créer un groupe**, ajoutez des membres et choisissez les rôles accordés par le groupe.",
          "Utilisez les **Règles personnalisées** dans les rôles d’un utilisateur pour exclure un rôle qu’il obtiendrait sinon via un groupe.",
        ],
      },
      {
        heading: "Astuces",
        tips: ["La **Référence des accès par rôle** explique ce que chaque rôle peut faire ; l’onglet **Journal d’activité** montre ce que chaque membre a fait."],
      },
    ],
  },
];
