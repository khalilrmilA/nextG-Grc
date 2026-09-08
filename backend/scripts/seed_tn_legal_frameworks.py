"""Corpus réglementaire tunisien — STB objectif 1, « des lois applicables à l'organisation ».

The tender asks for a centralised referential of « normes, réglementations, lois et
politiques internes ». The library shipped 94 frameworks and **not one Tunisian
text** — no BCT circulaire, no ANSI/audit obligation, no JORT data-protection law —
so the one bank actually issuing the tender could not point at a single requirement
that binds it under its own law.

This seeds that corpus as ordinary built-in frameworks carrying the new
``frameworks.source_type`` classification (``loi`` / ``reglementation``), one
FrameworkControl per article:

    BCT-2006-19       Circulaire aux établissements de crédit n° 2006-19 (contrôle interne)
    BCT-2021-05       Circulaire aux banques et établissements financiers n° 2021-05 (gouvernance)
    TN-LOI-2004-5     Loi n° 2004-5 relative à la sécurité informatique
    TN-DEC-2004-1250  Décret n° 2004-1250 (audit obligatoire périodique de la sécurité informatique)
    TN-LOI-2004-63    Loi organique n° 2004-63 (protection des données à caractère personnel)

HONESTY ABOUT THE TEXTS — read before using this in a tender response
---------------------------------------------------------------------
**No article text below is verbatim.** Every ``description`` is a one- or
two-sentence *summary in French* of the article's obligation, written to be
auditable (a control an assessor can mark conforme / non conforme), not to
reproduce the legal text. Titles are editorial labels, not the official rubrics —
these texts number their articles without titling them.

Fidelity is not uniform, and the difference matters:

  * BCT-2006-19 and BCT-2021-05 were summarised from the official BCT PDFs
    (bct.gov.tn, consulted 2026-09-08); article numbers and substance were read
    directly from the text, so those two are the most reliable here.
  * Loi 2004-5 and Décret 2004-1250 were summarised from the consolidated text
    published on legislation-securite.tn (consulted 2026-09-08).
  * Loi organique 2004-63 has 100+ articles; only the articles that bear on a
    bank's processing obligations are seeded, summarised from the same source.
    Article 18-19 is deliberately seeded as ONE line, because the security
    obligation is stated across both and splitting it would attribute wording to
    an article this script cannot verify.

Articles that create or empower an authority rather than bind the assessed
organisation are omitted on purpose (loi 2004-5 art. 2-4 — creation and missions
of the ANSI; décret 2004-1250 art. 10 — ministerial execution), because a
referential line that nobody can be assessed against is noise in an audit.

**Before any of this is used as evidence, each article must be checked against the
JORT / BCT official text.** The lawful reference is the published text, never this
seed. Amendments after 2026-09-08 are not reflected.

Cross-references (``mapped_controls``) are seeded only where the correspondence is
unambiguous — Tunisian data-protection articles to their RGPD counterparts, BCT
internal-control articles to ISO/IEC 27001. They are indicative, not an equivalence
opinion.

Usage:
    cd backend && venv/bin/python -m scripts.seed_tn_legal_frameworks
    cd backend && venv/bin/python -m scripts.seed_tn_legal_frameworks --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
Safe to re-run: matches on short_name then on (framework, control_id); never
updates a row that already exists, so local edits to a seeded article survive.
"""
import json
import os
import sqlite3
import sys
import uuid

# domain (controlled vocabulary, see scripts/backfill_control_domain.py) ->
# the free-text `category` the rest of the corpus stores, lower-cased. Written
# together so a TN control behaves identically under both the old category filter
# and the new domaine filter, and so the backfill has nothing left to do here.
CATEGORY_OF_DOMAIN = {
    "Organizational": "organizational",
    "Technological": "technological",
    "Physical": "physical",
    "People": "people",
    "GOVERNANCE": "governance",
    "POLICY": "policy",
}

# An article is (control_id, title, description, domain, requirement_type, crosswalk).
# requirement_type None = the article states an objet/champ d'application rather
# than an obligation: labelling it « exigence » would put an unassessable line in
# the register.
_X = "exigence"


# Provenance stamped onto every seeded article's `guidance`, so the caveat is on
# the screen the assessor reads and not only in this file's docstring. An auditor
# marking a control conforme is entitled to know the wording is a summary.
PROVENANCE = {
    "BCT-2006-19": "Résumé non verbatim de l'article. Texte officiel : circulaire BCT n° 2006-19 du "
                   "28 novembre 2006 (bct.gov.tn). À vérifier avant tout usage probatoire.",
    "BCT-2021-05": "Résumé non verbatim de l'article. Texte officiel : circulaire BCT n° 2021-05 du "
                   "19 août 2021 (bct.gov.tn). À vérifier avant tout usage probatoire.",
    "TN-LOI-2004-5": "Résumé non verbatim de l'article. Texte officiel : loi n° 2004-5 du 3 février 2004, "
                     "JORT. À vérifier avant tout usage probatoire.",
    "TN-DEC-2004-1250": "Résumé non verbatim de l'article. Texte officiel : décret n° 2004-1250 du "
                        "25 mai 2004, JORT n° 045. À vérifier avant tout usage probatoire.",
    "TN-LOI-2004-63": "Résumé non verbatim de l'article. Texte officiel : loi organique n° 2004-63 du "
                      "27 juillet 2004, JORT. À vérifier avant tout usage probatoire.",
}


def _guidance(provenance: str, note: str | None) -> str:
    return f"{provenance} {note}" if note else provenance


def _iso(*controls):
    return [{"framework": "ISO27001", "control": c} for c in controls]


def _gdpr(*controls):
    return [{"framework": "GDPR", "control": c} for c in controls]


BCT_2006_19 = [
    ("Art. 3", "Définition et composantes du système de contrôle interne",
     "L'établissement met en place un système de contrôle interne assurant en permanence la sécurité, "
     "l'efficacité et l'efficience des opérations, la protection des actifs, la fiabilité de l'information "
     "financière et la conformité. Il comprend un contrôle des opérations et procédures, une organisation "
     "comptable et du traitement de l'information, des systèmes de mesure et de maîtrise des risques et un "
     "système de documentation et d'information, adaptés à la nature et au volume de l'activité.",
     "GOVERNANCE", _X, _iso("4.4", "5.1")),
    ("Art. 4", "Conception du dispositif par l'organe de direction et approbation par le Conseil",
     "L'organe de direction identifie les sources de risques internes et externes, met en place un système "
     "d'évaluation des risques et de mesure de la rentabilité, définit les procédures de contrôle interne et "
     "une méthode de surveillance du respect des politiques internes, et prévoit les moyens humains et "
     "matériels nécessaires. Le système de contrôle interne doit être approuvé par le Conseil d'Administration "
     "ou le Conseil de Surveillance.",
     "GOVERNANCE", _X, _iso("5.1", "6.1.1")),
    ("Art. 5", "Cohérence des dispositifs sur base consolidée",
     "L'établissement surveillé sur base consolidée s'assure que les systèmes de contrôle interne des sociétés "
     "financières qu'il contrôle exclusivement sont cohérents et compatibles entre eux, et adaptés à "
     "l'organisation du groupe et à l'activité des entités contrôlées.",
     "GOVERNANCE", _X, []),
    ("Art. 6", "Objets du contrôle des opérations et des procédures internes",
     "Le dispositif vérifie la conformité des opérations et procédures aux textes en vigueur et aux normes "
     "professionnelles, le respect des procédures de décision et des limites de risque, la qualité de "
     "l'information comptable et financière, les conditions d'évaluation, d'enregistrement, de conservation et "
     "de disponibilité de cette information — en garantissant la piste d'audit — et la qualité des systèmes "
     "d'information et de communication. Il englobe les activités externalisées.",
     "Organizational", _X, _iso("a.5.36", "a.5.19")),
    ("Art. 7", "Contrôle permanent et contrôle périodique",
     "L'établissement dispose d'agents chargés du contrôle permanent (conformité, sécurité, validation des "
     "opérations, surveillance des risques) et d'agents distincts chargés du contrôle périodique par voie "
     "d'enquêtes, portant sur la conformité, le niveau de risque effectivement encouru, le respect des "
     "procédures et l'efficacité du contrôle permanent.",
     "Organizational", _X, _iso("a.5.35", "9.2")),
    ("Art. 8", "Indépendance des unités de contrôle et structure d'audit interne permanente",
     "Une stricte indépendance est assurée entre les unités qui engagent les opérations et celles qui les "
     "contrôlent, par un rattachement hiérarchique différent ou une séparation claire des fonctions "
     "d'autorisation, d'exécution, de comptabilisation et de contrôle. L'établissement dispose en permanence "
     "d'une structure d'audit interne indépendante des entités opérationnelles et désigne un responsable "
     "d'audit interne dont l'identité et le CV sont communiqués à la Banque Centrale de Tunisie.",
     "Organizational", _X, _iso("a.5.3", "9.2")),
    ("Art. 9", "Information du Conseil et comptes rendus des responsables du contrôle",
     "Le Conseil est tenu informé de la désignation des responsables des contrôles permanent et périodique. "
     "Ces responsables rendent compte à l'organe de direction et, lorsque cela est jugé nécessaire, "
     "directement au Conseil ou au Comité Permanent d'Audit Interne.",
     "GOVERNANCE", _X, _iso("5.3")),
    ("Art. 10", "Adéquation des moyens et programme annuel de missions de contrôle",
     "Le nombre, la qualification et les moyens des agents de contrôle — en particulier les outils de suivi et "
     "les méthodes d'analyse des risques — doivent être adaptés à l'activité et à la taille de l'établissement. "
     "Les moyens du contrôle périodique doivent permettre un cycle complet d'investigations de l'ensemble des "
     "activités sur un nombre d'exercices aussi limité que possible ; un programme de missions est établi au "
     "moins une fois par an.",
     "Organizational", _X, _iso("9.2", "7.1")),
    ("Art. 11", "Périmètre d'application du contrôle périodique",
     "Le système de contrôle s'intègre dans l'organisation, les méthodes et les procédures de chaque activité, "
     "et le contrôle périodique s'applique à tout l'établissement, y compris ses agences, ainsi qu'à l'ensemble "
     "des entreprises contrôlées de manière exclusive.",
     "Organizational", _X, []),
    ("Art. 12", "Piste d'audit",
     "L'organisation comptable garantit une piste d'audit permettant de reconstituer les opérations dans un "
     "ordre chronologique, de justifier toute information par une pièce d'origine avec un cheminement "
     "ininterrompu jusqu'au document de synthèse et réciproquement, et d'expliquer l'évolution des soldes d'un "
     "arrêté comptable à l'autre. Les informations destinées à la Banque Centrale de Tunisie et celles servant "
     "au calcul des normes prudentielles respectent cette piste d'audit.",
     "Technological", _X, _iso("a.8.15", "a.5.28")),
    ("Art. 13", "Contrôle périodique de la fiabilité de l'information et des méthodes d'évaluation",
     "L'établissement s'assure par un contrôle périodique de l'exhaustivité, de la fiabilité et de la "
     "pertinence des informations et du caractère approprié des méthodes d'évaluation et de comptabilisation. "
     "Pour les opérations porteuses de risques de marché, un rapprochement au moins mensuel est effectué entre "
     "les résultats de gestion et les résultats comptabilisés, et les écarts sont identifiés et analysés.",
     "Organizational", _X, []),
    ("Art. 14", "Sécurité des systèmes d'information et procédures de secours informatique",
     "L'établissement détermine le niveau de sécurité informatique adéquat au regard des normes technologiques "
     "et des exigences de ses métiers et s'assure de l'adaptation de son système d'information à son niveau "
     "d'activité et à la nature de ses risques. Le contrôle des systèmes d'information doit permettre de "
     "s'assurer que le niveau de sécurité est périodiquement apprécié et que les actions correctrices sont "
     "entreprises à temps, et que des procédures de secours informatique existent et sont testées "
     "périodiquement. Les supports d'information et de documentation sont conservés dans des conditions "
     "présentant le maximum de sécurité contre la détérioration, la manipulation ou le vol.",
     "Technological", _X, _iso("a.5.36", "a.8.8", "a.8.13")),
    ("Art. 15", "Plans de continuité de l'activité",
     "L'établissement dispose de plans de continuité de l'activité assurant, selon divers scénarios de crise y "
     "compris des chocs extrêmes, le maintien même temporaire des prestations essentielles puis la reprise "
     "planifiée des activités ; il s'assure de leur cohérence et de leur efficacité dans un plan global, et "
     "soumet l'organisation et la disponibilité de ses ressources humaines, immobilières, techniques et "
     "financières à une évaluation régulière au regard des risques de continuité.",
     "Organizational", _X, _iso("a.5.29", "a.5.30")),
    ("Art. 16", "Systèmes de mesure, de surveillance et de maîtrise des risques",
     "L'établissement met en place des systèmes d'analyse, de mesure et de surveillance permettant de s'assurer "
     "que les risques encourus — notamment de crédit, de marché, de taux global d'intérêt, de liquidité, de "
     "règlement, ainsi que les risques opérationnels — sont correctement évalués et maîtrisés.",
     "GOVERNANCE", _X, _iso("6.1.2", "6.1.3")),
    ("Art. 48", "Examen annuel du contrôle interne par le Conseil",
     "Le Conseil d'Administration ou de Surveillance procède au moins une fois par an à l'examen de l'activité "
     "et des résultats du contrôle interne, sur la base des informations transmises par l'organe de direction, "
     "les responsables des contrôles et le Comité Permanent d'Audit Interne.",
     "GOVERNANCE", _X, _iso("9.3")),
    ("Art. 49", "Information annuelle du Conseil et du comité d'audit",
     "L'organe de direction informe au moins une fois par an le Conseil et le Comité Permanent d'Audit Interne "
     "des enseignements tirés de la mesure des risques, des mesures prises pour assurer la continuité de "
     "l'activité et de l'appréciation portée sur l'efficacité des dispositifs en place, ainsi que des mesures "
     "prises pour contrôler les activités externalisées et des risques qui en résultent.",
     "GOVERNANCE", _X, _iso("9.3", "a.5.22")),
    ("Art. 50", "Manuels de procédures et documentation du contrôle interne",
     "L'établissement élabore et tient à jour des manuels de procédures décrivant les modalités "
     "d'enregistrement, de traitement et de restitution des informations, les schémas comptables et les "
     "procédures d'engagement. Il établit une documentation du contrôle interne précisant notamment les niveaux "
     "de responsabilité, les moyens affectés, les règles d'indépendance, **les procédures relatives à la "
     "sécurité des systèmes d'information et de communication et aux plans de continuité de l'activité**, et "
     "une description des systèmes de mesure et de surveillance des risques. Cette documentation est mise à "
     "disposition du comité d'audit, des commissaires aux comptes et de la Banque Centrale de Tunisie.",
     "POLICY", _X, _iso("7.5", "a.5.37", "a.5.1")),
    ("Art. 51", "Communication des rapports de contrôle périodique",
     "Les rapports établis à la suite des vérifications périodiques sont communiqués à l'organe de direction, "
     "au Conseil, au Comité Permanent d'Audit Interne et à la société-mère pour les établissements affiliés à "
     "un groupe, et tenus à la disposition des commissaires aux comptes et de la Banque Centrale de Tunisie.",
     "Organizational", _X, _iso("9.2")),
    ("Art. 52", "Rapport annuel sur les conditions du contrôle interne",
     "L'établissement élabore au moins une fois par an un rapport sur les conditions dans lesquelles le "
     "contrôle interne est assuré, comportant notamment la description des actions de contrôle permanent, "
     "l'inventaire des enquêtes périodiques faisant ressortir les principales insuffisances relevées **ainsi "
     "qu'un suivi des mesures correctrices prises**, les modifications significatives des dispositifs, les "
     "conditions d'application des procédures des nouvelles activités, les contrôles des succursales à "
     "l'étranger, les actions projetées et la liste des conventions avec les personnes liées.",
     "GOVERNANCE", _X, _iso("9.1", "10.2")),
    ("Art. 53", "Rapport annuel sur la mesure et la surveillance des risques",
     "L'établissement élabore au moins une fois par an un rapport sur la mesure et la surveillance des risques "
     "auxquels il est exposé, incluant les informations communiquées au Conseil au titre de l'article 49 et "
     "comportant l'évaluation, la mesure et le suivi de la sécurité des moyens de paiement qu'il émet ou gère "
     "au regard des normes internes et des recommandations de la Banque Centrale de Tunisie.",
     "GOVERNANCE", _X, _iso("9.1")),
    ("Art. 54", "Délais de communication des rapports annuels",
     "Les rapports prévus aux articles 52 et 53 sont communiqués au Conseil, au Comité Permanent d'Audit "
     "Interne, aux commissaires aux comptes et à la Banque Centrale de Tunisie au plus tard quatre mois après "
     "la clôture de l'exercice comptable et au moins quinze jours avant la tenue de l'assemblée générale "
     "ordinaire.",
     "GOVERNANCE", _X, []),
    ("Art. 55", "Politique écrite de communication financière",
     "L'établissement se dote d'une politique écrite en matière de communication financière, approuvée par le "
     "Conseil, définissant l'approche retenue pour déterminer les informations à diffuser.",
     "POLICY", _X, _iso("a.5.1")),
    ("Art. 56", "Composition et indépendance du Comité Permanent d'Audit Interne",
     "Le Comité Permanent d'Audit Interne est placé sous l'autorité du Conseil et se compose d'au moins trois "
     "membres, dont un président choisi par ses pairs, désignés par le Conseil et choisis autant que possible "
     "parmi les administrateurs qualifiés en matière financière et comptable. Les dirigeants exécutifs ne "
     "peuvent en être membres, et toute vacance est pourvue sans délai.",
     "GOVERNANCE", _X, _iso("5.3")),
    ("Art. 57", "Attributions du Comité Permanent d'Audit Interne",
     "Le Comité vérifie la clarté des informations fournies et apprécie la cohérence des systèmes de mesure, de "
     "surveillance et de maîtrise des risques ; examine les insuffisances du contrôle interne relevées et "
     "**l'adoption des mesures correctrices** ; contrôle et coordonne les activités de la structure d'audit "
     "interne ; agrée la désignation du responsable de l'audit interne et des auditeurs ; propose la nomination "
     "des commissaires aux comptes et des auditeurs externes et donne un avis sur le programme et les résultats "
     "de leurs contrôles.",
     "GOVERNANCE", _X, _iso("9.2", "10.2")),
    ("Art. 58", "Documents mis à disposition du comité, dont le suivi des recommandations",
     "L'établissement fournit au Comité tout document utile et notamment **les rapports des missions d'audit "
     "interne ainsi que le suivi des recommandations desdites missions**, la documentation du contrôle interne, "
     "les notes de stratégie et projections financières, les états financiers, les notifications de contrôle de "
     "la Banque Centrale de Tunisie, les rapports des autorités publiques, des commissaires aux comptes et des "
     "auditeurs externes, et les rapports des agences de notation.",
     "GOVERNANCE", _X, _iso("9.2", "10.2")),
    ("Art. 59", "Fonctionnement du comité : réunions, quorum et procès-verbaux",
     "Le Comité se réunit sur convocation de son président au moins quatre fois par an, ne délibère valablement "
     "qu'en présence d'au moins trois de ses membres et prend ses décisions par consensus. Il peut inviter tout "
     "dirigeant, le responsable de l'audit interne, les commissaires aux comptes et les auditeurs externes. Un "
     "procès-verbal est établi pour chaque séance, le secrétariat étant assuré par la structure d'audit interne.",
     "GOVERNANCE", _X, _iso("7.5")),
    ("Art. 60", "Programme d'activité du comité et déclenchement de missions",
     "Le Comité informe le Conseil de son programme d'activité et peut, lorsqu'il le juge nécessaire, proposer "
     "au Conseil de faire entreprendre par l'organe de direction toute mission ou enquête.",
     "GOVERNANCE", _X, _iso("9.2")),
    ("Art. 61", "Rapport d'activité annuel du comité",
     "Le Comité rend compte régulièrement au Conseil de l'exercice de sa mission et lui remet, avant la réunion "
     "consacrée à l'approbation des états financiers annuels, un rapport d'activité dont copie est adressée à "
     "la Banque Centrale de Tunisie au moins quinze jours avant l'assemblée générale ordinaire.",
     "GOVERNANCE", _X, _iso("9.3")),
]

BCT_2021_05 = [
    ("Art. 35", "Missions communes des comités du Conseil",
     "Les comités analysent en profondeur les questions relevant de leurs attributions pour éclairer les "
     "décisions du Conseil, lui rendent compte régulièrement de leurs travaux et appréciations, l'informent de "
     "tout événement susceptible de porter préjudice à la solidité et à la réputation de l'établissement, "
     "examinent les rapports des fonctions de contrôle, des commissaires aux comptes et des autorités de "
     "contrôle, peuvent proposer toute mission ou enquête, et soumettent un rapport annuel détaillé de leurs "
     "activités. Le Conseil demeure responsable en dernier ressort.",
     "GOVERNANCE", _X, _iso("5.1", "5.3")),
    ("Art. 36", "Composition des comités et vacance de poste",
     "La composition de chaque comité tient compte des qualifications de ses membres au regard de ses "
     "attributions, et toute vacance de poste est comblée dans les meilleurs délais par le Conseil.",
     "GOVERNANCE", _X, _iso("7.2")),
    ("Art. 37", "Fonctionnement des comités, procès-verbaux et charte",
     "Tout comité se réunit au moins chaque trimestre — au moins tous les deux mois pour les établissements "
     "systémiques ou soumis aux articles 101 et 102 de la loi 2016-48 —, ne délibère valablement qu'en présence "
     "de trois membres, et consigne dans un procès-verbal détaillé les délibérations, décisions et "
     "recommandations, les opinions divergentes **et le suivi de la mise en œuvre des décisions des réunions "
     "précédentes**. Chaque comité élabore une charte approuvée par le Conseil, et le comité d'audit et le "
     "comité des risques instaurent un cadre de coordination.",
     "GOVERNANCE", _X, _iso("7.5")),
    ("Art. 38", "Attributions du comité d'audit et suivi des plans d'actions",
     "Le comité d'audit s'assure de la qualité du dispositif de production de l'information financière et de la "
     "cohérence des systèmes de mesure et de maîtrise des risques, définit les politiques d'audit, surveille "
     "l'organisation et l'efficacité du contrôle interne, examine les insuffisances relevées, **suit la "
     "réalisation des plans d'actions visant la régularisation des insuffisances soulevées dans les rapports "
     "d'audit interne et externes et les rapports d'inspection de la Banque Centrale de Tunisie**, contrôle les "
     "activités de la structure d'audit interne et valide son programme, propose la nomination des commissaires "
     "aux comptes, et veille à ce que l'audit interne dispose des moyens nécessaires.",
     "GOVERNANCE", _X, _iso("9.2", "10.2")),
    ("Art. 39", "Qualification des membres du comité d'audit",
     "Le président du comité d'audit doit disposer d'une qualification académique et professionnelle et d'une "
     "expertise solide en finance, comptabilité ou audit ; les membres doivent justifier d'une expérience dans "
     "l'un de ces domaines, adaptée à la complexité de l'activité et au profil de risque de l'établissement.",
     "People", _X, _iso("7.2")),
    ("Art. 40", "Attributions du comité des risques",
     "Le comité des risques assiste le Conseil dans la conception et la mise à jour de la politique de gestion "
     "des risques et la fixation des limites d'exposition, l'approbation des systèmes de mesure et de "
     "surveillance des risques, le contrôle du respect de l'appétence pour le risque, l'analyse et le suivi des "
     "expositions — notamment crédit, marché, liquidité et **risque opérationnel** —, l'évaluation de la "
     "politique de provisionnement, l'adoption des actions correctrices, **l'approbation des plans de "
     "continuité d'activité** et la désignation du responsable de la fonction de gestion des risques.",
     "GOVERNANCE", _X, _iso("6.1.1", "6.1.3", "a.5.29")),
    ("Art. 41", "Qualification des membres du comité des risques",
     "Le président du comité des risques doit disposer d'une solide qualification académique et professionnelle "
     "et d'une bonne expertise en gestion des risques ; les membres doivent justifier d'une expérience adaptée "
     "à la complexité des opérations et à la nature des métiers de l'établissement.",
     "People", _X, _iso("7.2")),
    ("Art. 45", "Obligations de l'organe de direction, dont la protection des données personnelles",
     "L'organe de direction assure la communication de toutes les informations pertinentes nécessaires à la "
     "prise de décision par le Conseil et ses comités et met à leur disposition les moyens nécessaires, met en "
     "place un dispositif de protection des usagers des services bancaires ainsi que **des dispositifs en "
     "matière de protection des données à caractère personnel**, et veille au respect du code de déontologie "
     "par l'ensemble du personnel.",
     "Organizational", _X, _iso("a.5.34")),
    ("Art. 46", "Alerte immédiate du Conseil",
     "L'organe de direction alerte immédiatement le Conseil de tout événement pouvant impacter la situation "
     "financière et le profil de risque de l'établissement, provoquer un dysfonctionnement du système de "
     "contrôle interne et augmenter les risques de non-conformité, ou **altérer la continuité des activités "
     "critiques**.",
     "GOVERNANCE", _X, _iso("a.5.24", "a.5.25")),
    ("Art. 53", "Gouvernance de groupe et adéquation des systèmes d'information consolidés",
     "L'organe d'administration de l'entité consolidante établit un cadre de gouvernance pour chaque filiale, "
     "approuve la stratégie et la politique de risque du groupe, met en place des contrôles des conflits "
     "d'intérêts intragroupe, s'assure de l'adéquation des dispositifs de contrôle interne, de conformité et de "
     "gestion des risques à chaque filiale, et **s'assure de l'adéquation des systèmes d'information, de "
     "l'existence de pistes d'audit robustes et de contrôles adéquats** pour l'identification, la mesure, la "
     "gestion et la limitation des risques au niveau consolidé.",
     "GOVERNANCE", _X, _iso("a.8.15", "a.5.19")),
    ("Art. 54", "Filiales à l'étranger et obstacles réglementaires",
     "L'entité consolidante disposant de filiales à l'étranger s'assure qu'elles mettent en place un dispositif "
     "de contrôle de la conformité de leurs opérations et informe la Banque Centrale de Tunisie lorsque la "
     "réglementation du pays d'accueil fait obstacle à l'application de la circulaire.",
     "GOVERNANCE", _X, _iso("a.5.31")),
]

TN_LOI_2004_5 = [
    ("Art. 1", "Objet — organisation de la sécurité informatique",
     "La loi organise la sécurité informatique et fixe les règles générales de protection des systèmes "
     "informatiques et des réseaux.",
     "GOVERNANCE", None, []),
    ("Art. 5", "Régime d'audit obligatoire et périodique de la sécurité informatique",
     "Les systèmes informatiques et réseaux des organismes publics sont soumis à un audit obligatoire et "
     "périodique de la sécurité informatique, à l'exception des systèmes relevant de la défense nationale, de "
     "l'intérieur et du développement local. Le périmètre exact, la périodicité et les modalités sont fixés par "
     "le décret n° 2004-1250, qui étend l'obligation à des organismes privés.",
     "GOVERNANCE", _X, _iso("9.2", "a.5.35")),
    ("Art. 6", "Défaut d'audit — mise en demeure et désignation d'office",
     "L'agence nationale de la sécurité informatique avertit l'organisme qui n'a pas fait procéder à l'audit et "
     "lui accorde un délai d'un mois pour l'effectuer ; à défaut, elle désigne un expert pour réaliser l'audit "
     "aux frais de l'organisme.",
     "GOVERNANCE", _X, []),
    ("Art. 7", "Accès de l'agence et des experts à la documentation de sécurité",
     "L'organisme est tenu de permettre à l'agence nationale de la sécurité informatique et aux experts "
     "auditeurs d'accéder à la documentation relative à la sécurité informatique nécessaire à "
     "l'accomplissement de leurs missions.",
     "Organizational", _X, _iso("a.5.28", "7.5")),
    ("Art. 8", "Recours à des experts auditeurs certifiés",
     "Les opérations d'audit ne peuvent être réalisées que par des experts, personnes physiques ou morales, "
     "préalablement certifiés par l'agence nationale de la sécurité informatique.",
     "Organizational", _X, _iso("a.5.19", "a.5.20")),
    ("Art. 9", "Confidentialité des informations découvertes lors de l'audit",
     "Il est interdit de divulguer les informations dont l'expert auditeur a eu connaissance à l'occasion de "
     "l'audit ; les contrevenants encourent les sanctions prévues par le code pénal.",
     "People", _X, _iso("a.6.6")),
    ("Art. 10", "Déclaration immédiate des attaques et perturbations à l'agence",
     "Tout exploitant d'un système informatique ou d'un réseau est tenu d'informer immédiatement l'agence "
     "nationale de la sécurité informatique des attaques ou perturbations susceptibles d'entraver le "
     "fonctionnement d'un autre système informatique ou réseau.",
     "Organizational", _X, _iso("a.5.24", "a.5.25", "a.6.8")),
    ("Art. 11", "Isolement du système compromis",
     "L'agence nationale de la sécurité informatique peut proposer l'isolement du système informatique ou du "
     "réseau compromis jusqu'à la résolution de l'incident ; la décision est prononcée par le ministre chargé "
     "des technologies de la communication.",
     "Organizational", _X, _iso("a.5.26")),
]

TN_DEC_2004_1250 = [
    ("Art. 1", "Objet du décret",
     "Le décret fixe les systèmes informatiques et réseaux soumis à l'audit obligatoire périodique de la "
     "sécurité informatique, les critères relatifs à la nature de l'audit et à sa périodicité, et les "
     "procédures de suivi de l'application des recommandations contenues dans le rapport d'audit.",
     "GOVERNANCE", None, []),
    ("Art. 2", "Organismes soumis à l'audit obligatoire",
     "Sont soumis à l'audit obligatoire périodique les systèmes informatiques et réseaux des organismes "
     "publics, ainsi que ceux des organismes privés que sont les opérateurs de réseaux de télécommunications, "
     "les fournisseurs de services internet, les entreprises dont les réseaux sont interconnectés par des "
     "réseaux publics de télécommunications, et les entreprises qui traitent des données à caractère personnel "
     "de leurs clients.",
     "GOVERNANCE", _X, []),
    ("Art. 3", "Démarche de la mission d'audit",
     "L'audit est mené par investigation sur le terrain et couvre le volet organisationnel de la sécurité, "
     "l'analyse technique de la sécurité de l'ensemble des composants du système avec des tests de résistance, "
     "et l'évaluation des risques découlant des vulnérabilités découvertes.",
     "Organizational", _X, _iso("9.2", "a.8.8")),
    ("Art. 4", "Contenu du rapport d'audit",
     "L'expert auditeur remet un rapport signé et scellé comportant une évaluation complète de la sécurité du "
     "système audité, l'analyse des défaillances organisationnelles et techniques relevées avec l'évaluation "
     "des risques associés, et les solutions de sécurité proposées.",
     "Organizational", _X, _iso("9.2", "10.2")),
    ("Art. 5", "Périodicité de l'audit",
     "L'audit de la sécurité des systèmes informatiques et des réseaux est effectué de manière périodique, au "
     "moins une fois tous les douze mois ; l'agence nationale de la sécurité informatique peut proroger ce "
     "délai de trois mois dans des circonstances exceptionnelles.",
     "GOVERNANCE", _X, _iso("9.2")),
    ("Art. 6", "Transmission du rapport à l'agence",
     "L'organisme audité transmet à l'agence nationale de la sécurité informatique le rapport d'audit et les "
     "procès-verbaux dans un délai de dix jours, par lettre recommandée, document électronique fiable ou dépôt "
     "direct contre décharge.",
     "Organizational", _X, []),
    ("Art. 7", "Informations complémentaires et vérifications sur place",
     "Après examen du rapport d'audit, l'agence peut demander tout renseignement ou document complémentaire et "
     "procéder à des vérifications sur le terrain.",
     "GOVERNANCE", _X, []),
    ("Art. 8", "Rejet du rapport d'audit non conforme",
     "L'agence peut rejeter le rapport lorsque les procédures d'audit n'ont pas été respectées ou lorsqu'il ne "
     "comporte pas les éléments requis ; un nouveau rapport doit alors être présenté dans un délai de deux "
     "mois, à défaut de quoi l'agence désigne un expert aux frais de l'organisme.",
     "GOVERNANCE", _X, []),
    ("Art. 9", "Délai de mise en conformité du secteur privé",
     "Les organismes du secteur privé visés par le décret disposent d'un délai de douze mois à compter de sa "
     "publication pour se conformer à ses dispositions.",
     "GOVERNANCE", _X, []),
]

TN_LOI_2004_63 = [
    ("Art. 7", "Déclaration préalable auprès de l'INPDP",
     "Le responsable du traitement doit déposer une déclaration préalable auprès de l'Instance Nationale de "
     "Protection des Données à Caractère Personnel pour chaque finalité de traitement ; le silence de "
     "l'instance pendant un mois vaut acceptation.",
     "GOVERNANCE", _X, _gdpr("art.30", "art.36")),
    ("Art. 8", "Contenu de la demande d'autorisation, dont les mesures de sécurité",
     "La demande d'autorisation doit indiquer l'identité du responsable du traitement, les finalités "
     "poursuivies, les catégories de données traitées **et les mesures de sécurité mises en place** pour "
     "protéger les données.",
     "GOVERNANCE", _X, _gdpr("art.30", "art.32")),
    ("Art. 10", "Finalités licites, déterminées et explicites",
     "Les données à caractère personnel ne peuvent être collectées que pour des finalités licites, déterminées "
     "et explicites.",
     "Organizational", _X, _gdpr("art.5", "art.6")),
    ("Art. 11", "Loyauté, exactitude et mise à jour des données",
     "Les données doivent être traitées loyalement et être exactes, précises et mises à jour.",
     "Organizational", _X, _gdpr("art.5")),
    ("Art. 14", "Interdiction de principe des données sensibles",
     "Le traitement des données relatives aux origines raciales ou génétiques, aux convictions religieuses, aux "
     "opinions politiques, philosophiques ou syndicales et à la santé est interdit, sauf dans les cas "
     "d'exception prévus par la loi (consentement exprès, données rendues publiques par la personne concernée, "
     "finalités scientifiques notamment).",
     "Organizational", _X, _gdpr("art.9")),
    ("Art. 18-19", "Sécurité et confidentialité du traitement",
     "Le responsable du traitement doit prendre les précautions nécessaires pour assurer la sécurité des "
     "données et empêcher tout accès, modification ou consultation non autorisés.",
     "Technological", _X, _gdpr("art.32"),
     "Ligne unique pour deux articles : l'obligation de sécurité est portée conjointement par les "
     "articles 18 et 19 et la répartition exacte du texte entre eux n'a pas pu être vérifiée sur le JORT."),
    ("Art. 23", "Obligation de confidentialité perpétuelle",
     "L'obligation de confidentialité s'impose à toute personne intervenant dans le traitement et subsiste même "
     "après la fin du traitement.",
     "People", _X, _gdpr("art.28", "art.29")),
    ("Art. 27", "Consentement exprès et écrit",
     "Le traitement de données à caractère personnel ne peut être effectué qu'avec le consentement exprès et "
     "écrit de la personne concernée, sauf dérogation légale.",
     "Organizational", _X, _gdpr("art.6", "art.7")),
    ("Art. 28", "Traitement des données d'un enfant",
     "Le traitement des données à caractère personnel d'un enfant requiert le consentement de son tuteur et "
     "l'autorisation du juge des tutelles.",
     "Organizational", _X, _gdpr("art.8")),
    ("Art. 32", "Droit d'accès de la personne concernée",
     "La personne concernée a le droit d'accéder à ses données à caractère personnel et de demander leur "
     "correction, rectification, mise à jour ou suppression.",
     "Organizational", _X, _gdpr("art.15", "art.16")),
    ("Art. 40", "Rectification et suppression des données inexactes",
     "La personne concernée peut demander la rectification, le complètement, la modification ou la suppression "
     "de ses données lorsqu'elles sont inexactes ou traitées en violation de la loi.",
     "Organizational", _X, _gdpr("art.16", "art.17")),
    ("Art. 42", "Droit d'opposition et suspension du traitement",
     "La personne concernée peut s'opposer au traitement de ses données pour des raisons valables ; "
     "l'opposition entraîne la suspension immédiate du traitement jusqu'à décision sur son bien-fondé.",
     "Organizational", _X, _gdpr("art.21", "art.18")),
    ("Art. 45", "Destruction des données au terme de la finalité",
     "Les données doivent être détruites à l'expiration du délai fixé pour leur conservation ou dès la "
     "réalisation des finalités pour lesquelles elles ont été collectées.",
     "Organizational", _X, _gdpr("art.5", "art.17")),
    ("Art. 50", "Interdiction des transferts portant atteinte aux intérêts vitaux",
     "Le transfert de données à caractère personnel vers l'étranger est interdit lorsqu'il est susceptible de "
     "porter atteinte à la sécurité publique ou aux intérêts vitaux de la Tunisie.",
     "Organizational", _X, _gdpr("art.44")),
    ("Art. 52", "Autorisation préalable de l'INPDP pour tout transfert à l'étranger",
     "Tout transfert de données à caractère personnel vers l'étranger est subordonné à l'autorisation préalable "
     "de l'Instance Nationale de Protection des Données à Caractère Personnel.",
     "Organizational", _X, _gdpr("art.44", "art.46")),
    ("Art. 86", "Sanctions du transfert illicite à l'étranger",
     "Le transfert de données à caractère personnel vers l'étranger en violation de la loi est puni d'un "
     "emprisonnement de deux à cinq ans et d'une amende de 5 000 à 50 000 dinars.",
     "GOVERNANCE", _X, _gdpr("art.83")),
    ("Art. 87", "Sanctions du traitement illicite de données sensibles",
     "Le traitement de données sensibles en dehors des cas autorisés est puni d'un emprisonnement de deux ans "
     "et d'une amende de 10 000 dinars.",
     "GOVERNANCE", _X, _gdpr("art.83")),
    ("Art. 90", "Sanctions du traitement sans déclaration ni autorisation",
     "Le traitement de données à caractère personnel sans la déclaration ou l'autorisation préalable requise, "
     "ou leur communication sans le consentement de la personne concernée, est puni d'un emprisonnement d'un an "
     "et d'une amende de 5 000 dinars.",
     "GOVERNANCE", _X, _gdpr("art.83")),
]

# (short_name, name, version, issuing_body, source_type, description, articles)
FRAMEWORKS = [
    ("BCT-2006-19",
     "Circulaire BCT aux établissements de crédit n° 2006-19 — Contrôle interne",
     "2006",
     "Banque Centrale de Tunisie",
     "reglementation",
     "Circulaire aux établissements de crédit n° 2006-19 du 28 novembre 2006 relative au contrôle interne : "
     "système de contrôle interne, piste d'audit, sécurité des systèmes d'information, plans de continuité "
     "de l'activité, reporting annuel et Comité Permanent d'Audit Interne. Articles résumés — se référer au "
     "texte officiel de la BCT.",
     BCT_2006_19),
    ("BCT-2021-05",
     "Circulaire BCT aux banques et établissements financiers n° 2021-05 — Cadre de gouvernance",
     "2021",
     "Banque Centrale de Tunisie",
     "reglementation",
     "Circulaire n° 2021-05 du 19 août 2021 relative au cadre de gouvernance des banques et des établissements "
     "financiers : comités du Conseil, comité d'audit, comité des risques, obligations de l'organe de direction "
     "et gouvernance de groupe. Articles résumés — se référer au texte officiel de la BCT.",
     BCT_2021_05),
    ("TN-LOI-2004-5",
     "Loi n° 2004-5 du 3 février 2004 relative à la sécurité informatique",
     "2004",
     "République Tunisienne (JORT)",
     "loi",
     "Loi instituant le régime d'audit obligatoire et périodique de la sécurité informatique, le recours à des "
     "experts auditeurs certifiés par l'ANSI et la déclaration immédiate des attaques. Articles résumés — se "
     "référer au JORT.",
     TN_LOI_2004_5),
    ("TN-DEC-2004-1250",
     "Décret n° 2004-1250 du 25 mai 2004 — Audit obligatoire périodique de la sécurité informatique",
     "2004",
     "République Tunisienne (JORT)",
     "reglementation",
     "Décret d'application de la loi n° 2004-5 : organismes soumis à l'audit obligatoire, démarche d'audit, "
     "contenu du rapport, périodicité de douze mois, transmission à l'ANSI et suivi des recommandations. "
     "Articles résumés — se référer au JORT.",
     TN_DEC_2004_1250),
    ("TN-LOI-2004-63",
     "Loi organique n° 2004-63 du 27 juillet 2004 — Protection des données à caractère personnel",
     "2004",
     "République Tunisienne (JORT)",
     "loi",
     "Loi organique tunisienne sur la protection des données à caractère personnel : déclaration préalable "
     "auprès de l'INPDP, licéité et loyauté du traitement, données sensibles, sécurité et confidentialité, "
     "droits des personnes, conservation, transferts à l'étranger et sanctions. Sélection des articles qui "
     "s'appliquent à un établissement bancaire, résumés — se référer au JORT.",
     TN_LOI_2004_63),
]


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(apply: bool) -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    fw_cols = {r[1] for r in cur.execute("PRAGMA table_info(frameworks)").fetchall()}
    ct_cols = {r[1] for r in cur.execute("PRAGMA table_info(framework_controls)").fetchall()}
    if "source_type" not in fw_cols or "domain" not in ct_cols:
        print("ERROR: the STB referential columns are missing.")
        print("       Run: python -m scripts.migrate_add_stb_referential_columns")
        conn.close()
        return 2

    total_new_fw = 0
    total_new_ctrl = 0
    for short_name, name, version, body, source_type, description, articles in FRAMEWORKS:
        row = cur.execute(
            "SELECT id FROM frameworks WHERE short_name = ? AND is_builtin = 1 AND tenant_id IS NULL",
            (short_name,),
        ).fetchone()
        fw_id = row[0] if row else str(uuid.uuid4())
        state = "exists" if row else "NEW"
        print(f"\n{short_name:<18} [{state}] {name}")
        print(f"   source_type={source_type}  {len(articles)} article(s)")
        provenance = PROVENANCE[short_name]

        if not row:
            total_new_fw += 1
            if apply:
                cur.execute(
                    "INSERT INTO frameworks (id, name, short_name, version, description, issuing_body, "
                    "applicable_regions, applicable_industries, status, is_builtin, tenant_id, source_type) "
                    "VALUES (?,?,?,?,?,?,?,?,'active',1,NULL,?)",
                    (fw_id, name, short_name, version, description, body,
                     json.dumps(["TN"]), json.dumps(["banking", "financial_services"]),
                     source_type),
                )
        elif apply and "source_type" in fw_cols:
            # The only field ever updated on an existing row: an earlier run (or a
            # hand-created framework with the same short_name) may predate the
            # column, and leaving it NULL would keep the row out of the « source »
            # filter this whole objective is about. Everything else is left alone.
            cur.execute(
                "UPDATE frameworks SET source_type = ? WHERE id = ? AND source_type IS NULL",
                (source_type, fw_id),
            )

        existing_controls = {
            r[0] for r in cur.execute(
                "SELECT control_id FROM framework_controls WHERE framework_id = ?", (fw_id,)
            ).fetchall()
        }
        new_articles = [a for a in articles if a[0] not in existing_controls]
        print(f"   {len(existing_controls)} article(s) present, {len(new_articles)} to add")

        for order, article in enumerate(articles):
            control_id, title, desc, domain, req_type, crosswalk = article[:6]
            note = article[6] if len(article) > 6 else None
            if control_id in existing_controls:
                continue
            total_new_ctrl += 1
            category = CATEGORY_OF_DOMAIN[domain]
            print(f"      + {control_id:<10} [{domain:<14}] {title[:60]}")
            if apply:
                cur.execute(
                    "INSERT INTO framework_controls (id, framework_id, control_id, title, description, "
                    "guidance, category, parent_id, sort_order, mapped_controls, tags, is_mandatory, "
                    "domain, requirement_type) "
                    "VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), fw_id, control_id, title, desc,
                     _guidance(provenance, note), category, order,
                     json.dumps(crosswalk, ensure_ascii=False), json.dumps(["tunisie"]),
                     # A « champ d'application » line is not something an organisation
                     # can be found conforme or non conforme against, so it stays
                     # optional; every real obligation is mandatory.
                     1 if req_type else 0,
                     domain, req_type),
                )

    print(f"\n{total_new_fw} framework(s) and {total_new_ctrl} article(s) to create.")
    if not apply:
        conn.rollback()
        conn.close()
        print("Dry run — re-run with --apply to write.")
        return 0
    conn.commit()
    conn.close()
    if total_new_fw or total_new_ctrl:
        print("Written. Articles that state an obligation are is_mandatory=1 — a legal or")
        print("regulatory requirement cannot be marked « non applicable »; the objet /")
        print("champ d'application lines are left optional because nothing is assessed on them.")
        print("REMINDER: article texts are summaries. Verify against the JORT / BCT text")
        print("before using any of this as evidence in a tender or an audit.")
    else:
        print("Nothing to write — the corpus is already seeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
