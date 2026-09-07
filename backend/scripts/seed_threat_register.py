"""Seed a starter threat register for a bank.

Why this exists: the register shipped with 691 built-in entries, and every one
of them is a MITRE ATT&CK *technique* — "Extra Window Memory Injection",
"Socket Filters". Those describe how an attacker moves inside a compromised
system. They are not what a risk analysis is built on, and you cannot write
"origine probable, objectifs, facteurs aggravants" for one.

Measured before this ran, the whole authored register across 11 tenants was
four entries (Ransomware operator, Malicious insider, Phishing campaign,
Supply-chain compromise), and the register held **nothing** environmental,
physical, human-error or regulatory — the very categories the requirement names
("erreurs humaines, défaillance technique, événements naturels, fournisseurs
défaillants").

These are seeded as built-in, so they are shared and read-only and a tenant
adopts the ones that apply (POST /threats/{id}/adopt), exactly like the
framework library. Adoption is what makes a threat profilable.

**These are a starting point, not an assessment.** The wording is drawn from the
standard taxonomies a bank's risk analysis already uses (EBIOS RM, ISO 27005
annex C, ENISA) and adapted to retail/commercial banking. No probability or
severity is set: those are the organisation's judgement, not something a seed
script can know. Names are in French, the delivery language for this client,
and are editable once adopted.

Usage:
    python -m scripts.seed_threat_register            # dry run
    python -m scripts.seed_threat_register --apply
Safe to re-run: matches on ref_id and never overwrites an existing row.
"""
import os
import sqlite3
import sys
import uuid

# (ref, name, category, threat_type, actors, vectors, description)
THREATS = [
    # ── Technologique ────────────────────────────────────────────────────────
    ("BQ-TEC-01", "Rançongiciel sur le système d'information", "cyber_attack", "technologique",
     ["cybercriminel", "ransomware-gang"], ["email", "vpn", "poste de travail"],
     "Chiffrement massif des données et des sauvegardes accessibles, avec demande de rançon et menace de divulgation."),
    ("BQ-TEC-02", "Intrusion externe sur une application exposée", "cyber_attack", "technologique",
     ["cybercriminel", "hacktiviste"], ["internet", "application web"],
     "Exploitation d'une faille sur un service exposé (banque en ligne, portail client) pour accéder au système d'information interne."),
    ("BQ-TEC-03", "Déni de service distribué sur les services en ligne", "cyber_attack", "technologique",
     ["hacktiviste", "cybercriminel"], ["internet"],
     "Saturation des canaux digitaux rendant la banque en ligne et l'application mobile indisponibles pour la clientèle."),
    ("BQ-TEC-04", "Compromission d'un compte à privilèges", "cyber_attack", "technologique",
     ["cybercriminel", "insider"], ["annuaire", "administration à distance"],
     "Prise de contrôle d'un compte administrateur permettant un accès étendu et la désactivation des mesures de sécurité."),
    ("BQ-TEC-05", "Exploitation d'une vulnérabilité non corrigée", "cyber_attack", "technologique",
     ["cybercriminel"], ["réseau", "application"],
     "Utilisation d'une vulnérabilité connue et publiée sur un composant non mis à jour dans les délais."),
    ("BQ-TEC-06", "Panne matérielle d'un équipement critique", "technical_failure", "technologique",
     [], ["matériel"],
     "Défaillance d'un serveur, d'une baie de stockage ou d'un équipement réseau supportant un service essentiel."),
    ("BQ-TEC-07", "Corruption ou perte de données", "technical_failure", "technologique",
     [], ["stockage", "base de données"],
     "Altération ou perte irréversible de données métier à la suite d'un incident technique, logiciel ou humain."),
    ("BQ-TEC-08", "Restauration de sauvegarde impossible", "technical_failure", "technologique",
     [], ["sauvegarde"],
     "Sauvegardes absentes, incomplètes, chiffrées par un attaquant ou non testées, empêchant le retour à l'état antérieur."),
    ("BQ-TEC-09", "Obsolescence d'un composant en fin de support", "technical_failure", "technologique",
     [], ["système", "application"],
     "Maintien en production d'un composant qui ne reçoit plus de correctifs de sécurité de son éditeur."),
    ("BQ-TEC-10", "Compromission de la chaîne logicielle", "supply_chain", "technologique",
     ["nation-state", "cybercriminel"], ["dépendance logicielle", "mise à jour éditeur"],
     "Introduction de code malveillant via une bibliothèque tierce, une mise à jour éditeur ou un outil de développement."),
    ("BQ-TEC-11", "Attaque sur la monétique et les distributeurs", "cyber_attack", "technologique",
     ["cybercriminel"], ["réseau monétique", "accès physique"],
     "Manipulation des automates, du switch monétique ou des flux de compensation pour détourner des fonds."),
    ("BQ-TEC-12", "Compromission des paiements interbancaires", "cyber_attack", "technologique",
     ["nation-state", "cybercriminel"], ["poste opérateur", "réseau interbancaire"],
     "Émission d'ordres de paiement frauduleux via le canal interbancaire après compromission d'un poste ou d'un opérateur."),

    # ── Organisationnelle ────────────────────────────────────────────────────
    ("BQ-ORG-01", "Fraude interne d'un collaborateur", "insider_threat", "organisationnelle",
     ["insider"], ["applications métier", "abus de droits"],
     "Détournement de fonds ou manipulation d'opérations par une personne disposant d'un accès légitime."),
    ("BQ-ORG-02", "Divulgation volontaire d'informations confidentielles", "insider_threat", "organisationnelle",
     ["insider"], ["messagerie", "support amovible", "cloud personnel"],
     "Exfiltration délibérée de données clients ou de documents sensibles par un collaborateur ou un prestataire."),
    ("BQ-ORG-03", "Abus de droits d'un administrateur", "insider_threat", "organisationnelle",
     ["insider"], ["administration système"],
     "Utilisation de privilèges techniques au-delà du besoin d'en connaître, sans traçabilité ni contrôle."),
    ("BQ-ORG-04", "Hameçonnage ciblé des collaborateurs", "social_engineering", "organisationnelle",
     ["cybercriminel"], ["email", "téléphone", "SMS"],
     "Campagne visant à obtenir des identifiants ou à faire exécuter une pièce jointe malveillante."),
    ("BQ-ORG-05", "Fraude au président et usurpation d'identité", "social_engineering", "organisationnelle",
     ["cybercriminel"], ["email", "téléphone"],
     "Sollicitation d'un virement urgent en se faisant passer pour un dirigeant, un fournisseur ou un client."),
    ("BQ-ORG-06", "Départ non maîtrisé d'un collaborateur clé", "human_error", "organisationnelle",
     [], ["processus RH"],
     "Perte de compétence critique et accès non révoqués à la suite d'un départ mal accompagné."),
    ("BQ-ORG-07", "Accès non révoqué après un départ ou une mutation", "insider_threat", "organisationnelle",
     ["insider"], ["gestion des habilitations"],
     "Comptes et droits maintenus au-delà du besoin, faute de revue d'habilitations effective."),
    ("BQ-ORG-08", "Non-respect d'une obligation réglementaire", "legal_regulatory", "organisationnelle",
     [], ["processus de conformité"],
     "Manquement à une exigence du régulateur bancaire ou à la réglementation sur les données personnelles."),
    ("BQ-ORG-09", "Sanction d'une autorité de régulation", "legal_regulatory", "organisationnelle",
     [], ["contrôle réglementaire"],
     "Décision de sanction, mise en demeure ou restriction d'activité à la suite d'un contrôle."),

    # ── Opérationnelle ───────────────────────────────────────────────────────
    ("BQ-OPE-01", "Erreur de manipulation en production", "human_error", "operationnelle",
     [], ["exploitation"],
     "Action involontaire d'un exploitant entraînant une interruption, une perte de données ou une exposition."),
    ("BQ-OPE-02", "Erreur de saisie sur une opération bancaire", "human_error", "operationnelle",
     [], ["applications métier"],
     "Saisie erronée d'un montant, d'un bénéficiaire ou d'un paramètre, avec impact financier ou client."),
    ("BQ-OPE-03", "Changement non maîtrisé en production", "human_error", "operationnelle",
     [], ["gestion des changements"],
     "Mise en production sans test, sans validation ou sans procédure de retour arrière."),
    ("BQ-OPE-04", "Défaillance d'un prestataire d'infogérance", "supply_chain", "operationnelle",
     [], ["sous-traitance"],
     "Interruption de service, manquement contractuel ou défaillance financière d'un prestataire opérant un service essentiel."),
    ("BQ-OPE-05", "Interruption d'un service cloud tiers", "supply_chain", "operationnelle",
     [], ["cloud"],
     "Indisponibilité prolongée d'un service hébergé chez un fournisseur externe supportant une activité métier."),
    ("BQ-OPE-06", "Défaillance d'un opérateur de télécommunications", "supply_chain", "operationnelle",
     [], ["réseau opérateur"],
     "Coupure des liaisons entre le siège, les agences et les centres de traitement."),
    ("BQ-OPE-07", "Indisponibilité d'un processus métier critique", "technical_failure", "operationnelle",
     [], ["processus métier"],
     "Arrêt d'un processus essentiel au-delà de la durée maximale d'interruption admissible."),
    ("BQ-OPE-08", "Perte ou vol d'un document papier sensible", "physical", "operationnelle",
     [], ["archivage", "transport"],
     "Disparition d'un dossier client, d'un contrat ou d'un support contenant des données confidentielles."),
    ("BQ-OPE-09", "Non-conformité d'un sous-traitant à ses engagements", "supply_chain", "operationnelle",
     [], ["sous-traitance"],
     "Écart entre les exigences de sécurité contractuelles et les pratiques réelles du prestataire."),

    # ── Environnementale ─────────────────────────────────────────────────────
    ("BQ-ENV-01", "Incendie dans un site technique", "physical", "environnementale",
     [], ["site"],
     "Sinistre détruisant tout ou partie d'une salle serveurs, d'une agence ou d'un centre de traitement."),
    ("BQ-ENV-02", "Dégât des eaux ou inondation", "natural_disaster", "environnementale",
     [], ["site"],
     "Infiltration ou inondation rendant un local technique inexploitable."),
    ("BQ-ENV-03", "Coupure électrique prolongée", "physical", "environnementale",
     [], ["alimentation électrique"],
     "Perte d'alimentation dépassant l'autonomie des onduleurs et des groupes électrogènes."),
    ("BQ-ENV-04", "Panne de climatisation en salle serveurs", "physical", "environnementale",
     [], ["environnement technique"],
     "Élévation de température entraînant l'arrêt ou la dégradation des équipements."),
    ("BQ-ENV-05", "Séisme", "natural_disaster", "environnementale",
     [], ["site"],
     "Événement sismique affectant la disponibilité des sites et la sécurité des personnes."),
    ("BQ-ENV-06", "Intrusion physique dans un local sensible", "physical", "environnementale",
     ["cybercriminel", "insider"], ["contrôle d'accès"],
     "Accès non autorisé à une salle serveurs, une salle des coffres ou un local de brassage."),
    ("BQ-ENV-07", "Vol de matériel informatique", "physical", "environnementale",
     [], ["site", "mobilité"],
     "Soustraction d'un poste, d'un portable ou d'un support contenant des données de la banque."),
    ("BQ-ENV-08", "Indisponibilité massive du personnel", "natural_disaster", "environnementale",
     [], ["ressources humaines"],
     "Épidémie, mouvement social ou événement externe privant la banque d'une part importante de ses effectifs."),
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

    cols = {r[1] for r in cur.execute("PRAGMA table_info(threats)").fetchall()}
    if "threat_type" not in cols:
        print("ERROR: run scripts/migrate_add_threat_profile_governance.py first")
        conn.close()
        return 2

    existing = {r[0] for r in cur.execute(
        "SELECT ref_id FROM threats WHERE is_builtin = 1").fetchall()}

    to_add = [t for t in THREATS if t[0] not in existing]
    by_family: dict[str, int] = {}
    for ref, _n, _c, ttype, *_ in to_add:
        by_family[ttype] = by_family.get(ttype, 0) + 1

    print(f"{len(THREATS)} starter threats defined; {len(to_add)} not yet in the catalogue.")
    for fam, n in sorted(by_family.items()):
        print(f"   {n:3}  {fam}")
    if not to_add:
        print("Nothing to do.")
        conn.close()
        return 0

    if apply:
        import json
        for ref, name, category, ttype, actors, vectors, desc in to_add:
            cur.execute(
                "INSERT INTO threats (id, ref_id, name, description, category, threat_type, "
                "typical_threat_actors, typical_attack_vectors, affected_assets, mitre_ids, "
                "is_builtin, is_pending, tenant_id, profile_status, review_frequency_months) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,1,0,NULL,'draft',12)",
                (str(uuid.uuid4()), ref, name, desc, category, ttype,
                 json.dumps(actors, ensure_ascii=False), json.dumps(vectors, ensure_ascii=False),
                 "[]", "[]"),
            )
        conn.commit()
        print(f"\nAdded {len(to_add)} starter threats to the shared catalogue.")
        print("Tenants adopt the ones that apply (Threat Library -> Add to my register),")
        print("then complete and validate each profile.")
    else:
        print("\nDry run — re-run with --apply to write.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
