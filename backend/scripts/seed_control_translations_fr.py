"""Traductions françaises des exigences — STB, « référentiel exploitable en français ».

Measured on the live database: **0 of 4 537 control titles contain a French
accent**. The interface is translated into fr/ar; the requirement corpus is not.
For a Tunisian bank that is the wrong half — an assessor reads « Séparation des
tâches », not "Segregation of duties", and a control marked conforme in a language
the control owner does not read is not evidence of anything.

``control_translations`` (models/control_translation.py) is the mechanism;
``get_framework_controls`` overlays it field by field for the caller's language and
falls back to the original text, so an untranslated framework behaves exactly as it
does today.

Coverage is deliberately narrow and deep
----------------------------------------
ISO/IEC 27001:2022 (118 lines: clauses 4-10 + Annexe A) and the RGPD (36 articles)
only. Those two are what the tender's compliance demo opens, and a correct
translation of 154 requirements is worth more to a bank reviewer than a
machine-mangled pass over all 4 537.

  * The RGPD titles are the **official French rubrics** of Règlement (UE) 2016/679,
    which is published in French — those are exact.
  * The ISO titles follow the terminology of the French version of the standard
    (NF EN ISO/IEC 27001 / 27002:2022) but are **not** a reproduction of ISO's
    copyrighted French text; they are equivalents written for this referential.

Only ``title`` is translated. Descriptions and guidance are left NULL on purpose:
the resolver falls back per field, so an untranslated description keeps showing the
English original rather than a half-translated paragraph, and ``source='human'``
tells the assessor no machine produced these.

Usage:
    cd backend && venv/bin/python -m scripts.seed_control_translations_fr
    cd backend && venv/bin/python -m scripts.seed_control_translations_fr --apply
    cd backend && venv/bin/python -m scripts.seed_control_translations_fr --include-clones --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
Safe to re-run: one row per (control, lang); an existing translation is never
overwritten, so a correction made through the API survives.
"""
import argparse
import os
import sqlite3
import sys
import uuid

LANG = "fr"
SOURCE = "human"

# ISO/IEC 27001:2022 — clauses 4 à 10 puis Annexe A, indexés sur le control_id
# tel qu'il est stocké dans le corpus ('4.1', 'a.5.1', …).
ISO27001_FR = {
    # Clauses du système de management
    "4.1": "Compréhension de l'organisation et de son contexte",
    "4.2": "Compréhension des besoins et des attentes des parties intéressées",
    "4.3": "Détermination du domaine d'application du système de management de la sécurité de l'information",
    "4.4": "Système de management de la sécurité de l'information",
    "5.1": "Leadership et engagement",
    "5.2": "Politique",
    "5.3": "Rôles, responsabilités et autorités au sein de l'organisation",
    "6.1.1": "Actions à mettre en œuvre face aux risques et opportunités — Généralités",
    "6.1.2": "Appréciation des risques de sécurité de l'information",
    "6.1.3": "Traitement des risques de sécurité de l'information",
    "6.2": "Objectifs de sécurité de l'information et plans pour les atteindre",
    "6.3": "Planification des modifications",
    "7.1": "Ressources",
    "7.2": "Compétences",
    "7.3": "Sensibilisation",
    "7.4": "Communication",
    "7.5": "Informations documentées",
    "8.1": "Planification et maîtrise opérationnelles",
    "8.2": "Appréciation des risques de sécurité de l'information",
    "8.3": "Traitement des risques de sécurité de l'information",
    "9.1": "Surveillance, mesure, analyse et évaluation",
    "9.2": "Audit interne",
    "9.3": "Revue de direction",
    "10.1": "Amélioration continue",
    "10.2": "Non-conformité et action corrective",
    # Annexe A — mesures organisationnelles
    "a.5.1": "Politiques de sécurité de l'information",
    "a.5.2": "Fonctions et responsabilités liées à la sécurité de l'information",
    "a.5.3": "Séparation des tâches",
    "a.5.4": "Responsabilités de la direction",
    "a.5.5": "Relations avec les autorités",
    "a.5.6": "Relations avec des groupes de travail spécialisés",
    "a.5.7": "Renseignement sur les menaces",
    "a.5.8": "Sécurité de l'information dans la gestion de projet",
    "a.5.9": "Inventaire des informations et autres actifs associés",
    "a.5.10": "Utilisation correcte des informations et autres actifs associés",
    "a.5.11": "Restitution des actifs",
    "a.5.12": "Classification des informations",
    "a.5.13": "Marquage des informations",
    "a.5.14": "Transfert de l'information",
    "a.5.15": "Contrôle d'accès",
    "a.5.16": "Gestion des identités",
    "a.5.17": "Informations d'authentification",
    "a.5.18": "Droits d'accès",
    "a.5.19": "Sécurité de l'information dans les relations avec les fournisseurs",
    "a.5.20": "Prise en compte de la sécurité de l'information dans les accords conclus avec les fournisseurs",
    "a.5.21": "Gestion de la sécurité de l'information dans la chaîne d'approvisionnement des TIC",
    "a.5.22": "Surveillance, revue et gestion des changements des services fournisseurs",
    "a.5.23": "Sécurité de l'information dans l'utilisation de services en nuage",
    "a.5.24": "Planification et préparation de la gestion des incidents de sécurité de l'information",
    "a.5.25": "Appréciation des événements de sécurité de l'information et prise de décision",
    "a.5.26": "Réponse aux incidents de sécurité de l'information",
    "a.5.27": "Tirer des enseignements des incidents de sécurité de l'information",
    "a.5.28": "Recueil de preuves",
    "a.5.29": "Sécurité de l'information durant une perturbation",
    "a.5.30": "Préparation des TIC pour la continuité d'activité",
    "a.5.31": "Exigences légales, statutaires, réglementaires et contractuelles",
    "a.5.32": "Droits de propriété intellectuelle",
    "a.5.33": "Protection des enregistrements",
    "a.5.34": "Protection de la vie privée et des données à caractère personnel (DCP)",
    "a.5.35": "Revue indépendante de la sécurité de l'information",
    "a.5.36": "Conformité aux politiques, règles et normes de sécurité de l'information",
    "a.5.37": "Procédures d'exploitation documentées",
    # Annexe A — mesures liées aux personnes
    "a.6.1": "Sélection des candidats",
    "a.6.2": "Conditions générales d'embauche",
    "a.6.3": "Sensibilisation, apprentissage et formation à la sécurité de l'information",
    "a.6.4": "Processus disciplinaire",
    "a.6.5": "Responsabilités après la fin ou le changement d'un contrat de travail",
    "a.6.6": "Engagements de confidentialité ou de non-divulgation",
    "a.6.7": "Travail à distance",
    "a.6.8": "Déclaration des événements de sécurité de l'information",
    # Annexe A — mesures physiques
    "a.7.1": "Périmètres de sécurité physique",
    "a.7.2": "Contrôles d'accès physique",
    "a.7.3": "Sécurisation des bureaux, des salles et des équipements",
    "a.7.4": "Surveillance de la sécurité physique",
    "a.7.5": "Protection contre les menaces physiques et environnementales",
    "a.7.6": "Travail dans les zones sécurisées",
    "a.7.7": "Bureau propre et écran vide",
    "a.7.8": "Emplacement et protection du matériel",
    "a.7.9": "Sécurité des actifs hors des locaux",
    "a.7.10": "Supports de stockage",
    "a.7.11": "Services généraux",
    "a.7.12": "Sécurité du câblage",
    "a.7.13": "Maintenance du matériel",
    "a.7.14": "Mise au rebut ou réutilisation sécurisée du matériel",
    # Annexe A — mesures technologiques
    "a.8.1": "Terminaux finaux des utilisateurs",
    "a.8.2": "Privilèges d'accès",
    "a.8.3": "Restriction d'accès à l'information",
    "a.8.4": "Accès au code source",
    "a.8.5": "Authentification sécurisée",
    "a.8.6": "Dimensionnement",
    "a.8.7": "Protection contre les programmes malveillants",
    "a.8.8": "Gestion des vulnérabilités techniques",
    "a.8.9": "Gestion de la configuration",
    "a.8.10": "Suppression de l'information",
    "a.8.11": "Masquage des données",
    "a.8.12": "Prévention de la fuite de données",
    "a.8.13": "Sauvegarde de l'information",
    "a.8.14": "Redondance des moyens de traitement de l'information",
    "a.8.15": "Journalisation",
    "a.8.16": "Activités de surveillance",
    "a.8.17": "Synchronisation des horloges",
    "a.8.18": "Utilisation de programmes utilitaires à privilèges",
    "a.8.19": "Installation de logiciels sur des systèmes en exploitation",
    "a.8.20": "Sécurité des réseaux",
    "a.8.21": "Sécurité des services réseau",
    "a.8.22": "Cloisonnement des réseaux",
    "a.8.23": "Filtrage web",
    "a.8.24": "Utilisation de la cryptographie",
    "a.8.25": "Cycle de vie de développement sécurisé",
    "a.8.26": "Exigences de sécurité des applications",
    "a.8.27": "Principes d'ingénierie et d'architecture des systèmes sécurisés",
    "a.8.28": "Codage sécurisé",
    "a.8.29": "Tests de sécurité dans le développement et l'acceptation",
    "a.8.30": "Développement externalisé",
    "a.8.31": "Séparation des environnements de développement, de test et de production",
    "a.8.32": "Gestion des changements",
    "a.8.33": "Informations de test",
    "a.8.34": "Protection des systèmes d'information pendant les tests d'audit",
}

# RGPD — intitulés officiels des articles du règlement (UE) 2016/679, version française.
GDPR_FR = {
    "art.5": "Principes relatifs au traitement des données à caractère personnel",
    "art.6": "Licéité du traitement",
    "art.7": "Conditions applicables au consentement",
    "art.8": "Conditions applicables au consentement des enfants en ce qui concerne les services de la "
             "société de l'information",
    "art.9": "Traitement portant sur des catégories particulières de données à caractère personnel",
    "art.12": "Transparence des informations et communications et modalités de l'exercice des droits de la "
              "personne concernée",
    "art.13": "Informations à fournir lorsque des données à caractère personnel sont collectées auprès de la "
              "personne concernée",
    "art.14": "Informations à fournir lorsque les données à caractère personnel n'ont pas été collectées "
              "auprès de la personne concernée",
    "art.15": "Droit d'accès de la personne concernée",
    "art.16": "Droit de rectification",
    "art.17": "Droit à l'effacement (« droit à l'oubli »)",
    "art.18": "Droit à la limitation du traitement",
    "art.19": "Obligation de notification en ce qui concerne la rectification ou l'effacement de données à "
              "caractère personnel ou la limitation du traitement",
    "art.20": "Droit à la portabilité des données",
    "art.21": "Droit d'opposition",
    "art.22": "Décision individuelle automatisée, y compris le profilage",
    "art.24": "Responsabilité du responsable du traitement",
    "art.25": "Protection des données dès la conception et protection des données par défaut",
    "art.26": "Responsables conjoints du traitement",
    "art.27": "Représentants des responsables du traitement ou des sous-traitants qui ne sont pas établis "
              "dans l'Union",
    "art.28": "Sous-traitant",
    "art.29": "Traitement effectué sous l'autorité du responsable du traitement ou du sous-traitant",
    "art.30": "Registre des activités de traitement",
    "art.31": "Coopération avec l'autorité de contrôle",
    "art.32": "Sécurité du traitement",
    "art.33": "Notification à l'autorité de contrôle d'une violation de données à caractère personnel",
    "art.34": "Communication à la personne concernée d'une violation de données à caractère personnel",
    "art.35": "Analyse d'impact relative à la protection des données",
    "art.36": "Consultation préalable",
    "art.37": "Désignation du délégué à la protection des données",
    "art.38": "Fonction du délégué à la protection des données",
    "art.39": "Missions du délégué à la protection des données",
    "art.44": "Principe général applicable aux transferts",
    "art.45": "Transferts fondés sur une décision d'adéquation",
    "art.46": "Transferts moyennant des garanties appropriées",
    "art.83": "Conditions générales pour imposer des amendes administratives",
}

# short_name of the built-in framework -> {control_id: titre français}
CATALOGUE = {
    "ISO27001": ISO27001_FR,
    "GDPR": GDPR_FR,
}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--include-clones", action="store_true",
                    help="also translate tenant forks cloned from these built-ins")
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args(argv)

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    known = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "control_translations" not in known:
        print("ERROR: table `control_translations` does not exist yet.")
        print("       It is created by create_all() — restart the backend once, then re-run.")
        conn.close()
        return 2

    fw_cols = {r[1] for r in cur.execute("PRAGMA table_info(frameworks)").fetchall()}
    can_follow_clones = args.include_clones and "cloned_from_framework_id" in fw_cols
    if args.include_clones and not can_follow_clones:
        print("NOTE: frameworks.cloned_from_framework_id is missing — run")
        print("      scripts/migrate_add_stb_referential_columns.py to follow tenant forks.")

    planned: list[tuple] = []
    for short_name, titles in CATALOGUE.items():
        base = cur.execute(
            "SELECT id, name FROM frameworks WHERE short_name = ? AND is_builtin = 1 "
            "AND tenant_id IS NULL", (short_name,)
        ).fetchall()
        if not base:
            print(f"\n{short_name}: not found as a built-in framework — skipped.")
            continue

        targets = list(base)
        if can_follow_clones:
            for fid, _n in base:
                targets += cur.execute(
                    "SELECT id, name FROM frameworks WHERE cloned_from_framework_id = ?", (fid,)
                ).fetchall()

        for fw_id, fw_name in targets:
            controls = cur.execute(
                "SELECT id, control_id, title FROM framework_controls WHERE framework_id = ?",
                (fw_id,),
            ).fetchall()
            translated = {
                r[0] for r in cur.execute(
                    "SELECT t.control_id FROM control_translations t "
                    "JOIN framework_controls c ON c.id = t.control_id "
                    "WHERE c.framework_id = ? AND t.lang = ?", (fw_id, LANG)
                ).fetchall()
            }

            to_add, already, no_entry = [], 0, []
            for db_id, control_id, en_title in controls:
                fr = titles.get(control_id)
                if fr is None:
                    no_entry.append((control_id, en_title))
                    continue
                if db_id in translated:
                    already += 1
                    continue
                to_add.append((db_id, control_id, fr))

            print(f"\n{short_name:<10} {fw_name[:56]}")
            print(f"   {len(controls)} exigence(s) — {len(to_add)} à traduire, "
                  f"{already} déjà traduite(s), {len(no_entry)} sans entrée")
            for _db_id, control_id, fr in to_add:
                print(f"      + {control_id:<10} {fr[:76]}")
            if no_entry:
                # Never silently partial: an untranslated control is listed, not
                # guessed at. It keeps showing its English title, which is today's
                # behaviour, and the gap is visible to whoever runs this.
                print(f"   SANS TRADUCTION ({len(no_entry)}) — restent en anglais :")
                for control_id, en_title in no_entry:
                    print(f"      - {control_id:<10} {(en_title or '')[:70]}")

            planned += [(str(uuid.uuid4()), db_id, LANG, fr, None, None, SOURCE)
                        for db_id, _cid, fr in to_add]

    print(f"\n{len(planned)} translation row(s) to create.")
    if not planned:
        conn.close()
        return 0
    if not args.apply:
        print("Dry run — re-run with --apply to write.")
        conn.close()
        return 0

    cur.executemany(
        "INSERT INTO control_translations "
        "(id, control_id, lang, title, description, guidance, source) VALUES (?,?,?,?,?,?,?)",
        planned,
    )
    conn.commit()
    conn.close()
    print(f"Wrote {len(planned)} French title(s), source={SOURCE!r}.")
    print("Only `title` is translated: description and guidance stay NULL and fall back")
    print("to the original text, field by field, in get_framework_controls.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
