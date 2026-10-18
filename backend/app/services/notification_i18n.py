"""Server-side localisation of in-app notifications and their e-mail leg.

Notifications are written once, in English (``title`` / ``message``), and most
writers also store the i18n triple ``title_key`` / ``message_key`` / ``params``.
Nothing ever rendered that triple: the SPA displays ``title`` / ``message`` as
served, so a French or Arabic user read every bell entry in English.

This module renders a notification in the reader's language at READ time, so
no stored row is rewritten (webhooks, the activity trail and any other consumer
keep the English text they always had):

* a row with a known key is formatted from :data:`CATALOG` with its params;
* a row without a key (written before keys existed, or by a writer that never
  set one) is matched against the English templates of the same catalog —
  every template doubles as a regular expression — and the captured params are
  re-rendered;
* anything else is returned exactly as stored.

English is never re-rendered: the stored English text IS the English rendering.

Data inside a notification (a risk title, a vendor name, a feed item, an AI
gap description) is the user's or the source's own text and is never
translated here; vocabulary values the platform owns (severity, treatment
option, validation state…) are, through :data:`PARAM_VOCAB`.
"""
from __future__ import annotations

import logging
import re
import string
from functools import lru_cache

logger = logging.getLogger(__name__)

LANGS = ("en", "fr", "ar")

# ── Catalog ──────────────────────────────────────────────────────────────────
# "en" mirrors the writer's English f-string EXACTLY (format specs included —
# "{risk:.50}" is the writer's risk.title[:50]); it is what the legacy matcher
# turns into a regex. "en_alt" lists other English wordings the same key has
# been written with. fr/ar may use the derived params described in
# _derived_params (ndays, ip_where, ctrl_paren, ctrl_for).
CATALOG: dict[str, dict] = {
    # ── Third parties: contracts ──
    "notifications.contract_expired.title": {
        "en": "Contract EXPIRED: {vendor}",
        "fr": "Contrat EXPIRÉ : {vendor}",
        "ar": "عقد منتهي الصلاحية: {vendor}",
    },
    "notifications.contract_expired.message": {
        "en": "The contract with {vendor} expired {days} days ago. Immediate action required.",
        "fr": "Le contrat avec {vendor} a expiré il y a {ndays}. Une action immédiate est requise.",
        "ar": "انتهت صلاحية العقد مع {vendor} منذ {ndays}. يلزم اتخاذ إجراء فوري.",
    },
    "notifications.contract_expires_today.title": {
        "en": "Contract expires TODAY: {vendor}",
        "fr": "Le contrat expire AUJOURD'HUI : {vendor}",
        "ar": "ينتهي العقد اليوم: {vendor}",
    },
    "notifications.contract_expires_today.message": {
        "en": "The contract with {vendor} expires today!",
        "fr": "Le contrat avec {vendor} expire aujourd'hui !",
        "ar": "ينتهي العقد مع {vendor} اليوم!",
    },
    "notifications.contract_expiring.title": {
        "en": "Contract expiring in {days} days: {vendor}",
        "fr": "Contrat arrivant à échéance dans {ndays} : {vendor}",
        "ar": "ينتهي العقد خلال {ndays}: {vendor}",
    },
    "notifications.contract_expiring.message": {
        "en": "The contract with {vendor} expires in {days} days. Start renewal process.",
        "en_alt": ("The contract with {vendor} will expire in {days} days. Renewal needed.",),
        "fr": "Le contrat avec {vendor} expire dans {ndays}. Lancez le processus de renouvellement.",
        "ar": "ينتهي العقد مع {vendor} خلال {ndays}. يرجى البدء في إجراءات التجديد.",
    },
    "notifications.contract_renewal_reminder.title": {
        "en": "Contract renewal reminder: {vendor}",
        "fr": "Rappel de renouvellement de contrat : {vendor}",
        "ar": "تذكير بتجديد العقد: {vendor}",
    },
    "notifications.contract_renewal_reminder.message": {
        "en": "Contract with {vendor} expires in {days} days. Plan renewal activities.",
        "fr": "Le contrat avec {vendor} expire dans {ndays}. Planifiez les actions de renouvellement.",
        "ar": "ينتهي العقد مع {vendor} خلال {ndays}. يرجى التخطيط لإجراءات التجديد.",
    },
    "notifications.contract_pending_review.title": {
        "en": "Contract awaiting your review: {vendor}",
        "fr": "Contrat en attente de votre revue : {vendor}",
        "ar": "عقد بانتظار مراجعتكم: {vendor}",
    },
    "notifications.contract_pending_review.message": {
        "en": "A contract from {vendor} has been analyzed by AI and needs your approval.",
        "fr": "Un contrat de {vendor} a été analysé par l'IA et requiert votre approbation.",
        "ar": "تم تحليل عقد من {vendor} بواسطة الذكاء الاصطناعي ويتطلب موافقتكم.",
    },
    # ── Third parties: action plans & collaboration ──
    "notifications.vendor_action_overdue.title": {
        "en": "Action plan item OVERDUE: {vendor}",
        "fr": "Action du plan EN RETARD : {vendor}",
        "ar": "بند خطة العمل متأخر: {vendor}",
    },
    "notifications.vendor_action_overdue.message": {
        "en": "Item '{action}' was due {days} day(s) ago and is still incomplete. Check with {vendor}.",
        "fr": "L'action « {action} » était due il y a {ndays} et n'est toujours pas terminée. Vérifiez auprès de {vendor}.",
        "ar": "كان البند «{action}» مستحقاً منذ {ndays} ولم يكتمل بعد. يرجى المتابعة مع {vendor}.",
    },
    "notifications.vendor_action_today.title": {
        "en": "Action plan item due TODAY: {vendor}",
        "fr": "Action du plan à échéance AUJOURD'HUI : {vendor}",
        "ar": "بند خطة العمل مستحق اليوم: {vendor}",
    },
    "notifications.vendor_action_today.message": {
        "en": "Item '{action}' is due today. Verify with {vendor}.",
        "fr": "L'action « {action} » arrive à échéance aujourd'hui. Vérifiez auprès de {vendor}.",
        "ar": "البند «{action}» مستحق اليوم. يرجى التحقق مع {vendor}.",
    },
    "notifications.vendor_action_due.title": {
        "en": "Action plan deadline in {days} day(s): {vendor}",
        "fr": "Échéance du plan d'action dans {ndays} : {vendor}",
        "ar": "موعد خطة العمل خلال {ndays}: {vendor}",
    },
    "notifications.vendor_action_due.message": {
        "en": "Item '{action}' deadline is in {days} day(s). Follow up with {vendor} to confirm progress.",
        "fr": "L'action « {action} » arrive à échéance dans {ndays}. Relancez {vendor} pour confirmer l'avancement.",
        "ar": "يحين موعد البند «{action}» خلال {ndays}. يرجى المتابعة مع {vendor} لتأكيد التقدم.",
    },
    "notifications.collab_vendor_message.title": {
        "en": "New message from {sender} ({vendor})",
        "fr": "Nouveau message de {sender} ({vendor})",
        "ar": "رسالة جديدة من {sender} ({vendor})",
    },
    "notifications.collab_vendor_message.message": {
        # The vendor's own words — data, never translated.
        "en": "{preview}", "fr": "{preview}", "ar": "{preview}",
    },
    # ── Risks ──
    "notifications.risk_review_overdue.title": {
        "en": "Risk review OVERDUE: {risk:.50}",
        "fr": "Revue du risque EN RETARD : {risk:.50}",
        "ar": "مراجعة الخطر متأخرة: {risk:.50}",
    },
    "notifications.risk_review_overdue.message": {
        "en": "Risk '{risk}' review is overdue by {days} days.",
        "fr": "La revue du risque « {risk} » accuse un retard de {ndays}.",
        "ar": "مراجعة الخطر «{risk}» متأخرة بـ{ndays}.",
    },
    "notifications.risk_review_today.title": {
        "en": "Risk review due TODAY: {risk:.50}",
        "fr": "Revue du risque prévue AUJOURD'HUI : {risk:.50}",
        "ar": "مراجعة الخطر مستحقة اليوم: {risk:.50}",
    },
    "notifications.risk_review_today.message": {
        "en": "Risk '{risk}' needs to be reviewed today.",
        "fr": "Le risque « {risk} » doit être revu aujourd'hui.",
        "ar": "يجب مراجعة الخطر «{risk}» اليوم.",
    },
    "notifications.risk_review_due.title": {
        "en": "Risk review due in {days} days",
        "fr": "Revue de risque prévue dans {ndays}",
        "ar": "مراجعة خطر مستحقة خلال {ndays}",
    },
    "notifications.risk_review_due.message": {
        "en": "Risk '{risk}' needs review within {days} days.",
        "fr": "Le risque « {risk} » doit être revu sous {ndays}.",
        "ar": "يجب مراجعة الخطر «{risk}» خلال {ndays}.",
    },
    "notifications.risk_review_upcoming.title": {
        "en": "Upcoming risk review in {days} days",
        "fr": "Revue de risque à venir dans {ndays}",
        "ar": "مراجعة خطر قادمة خلال {ndays}",
    },
    "notifications.risk_review_upcoming.message": {
        "en": "Risk '{risk}' scheduled for review in {days} days.",
        "fr": "La revue du risque « {risk} » est planifiée dans {ndays}.",
        "ar": "مراجعة الخطر «{risk}» مجدولة خلال {ndays}.",
    },
    "notifications.risk_over_appetite.title": {
        "en": "Risk over appetite: {risk:.50}",
        "fr": "Risque au-delà de l'appétence : {risk:.50}",
        "ar": "خطر يتجاوز مستوى الرغبة في المخاطر: {risk:.50}",
    },
    "notifications.risk_over_appetite.message": {
        "en": ("Risk '{risk}' has a residual score of {score} which exceeds the appetite "
               "threshold of {threshold}. Treatment is required."),
        "fr": ("Le risque « {risk} » présente un score résiduel de {score}, supérieur au seuil "
               "d'appétence de {threshold}. Un traitement est requis."),
        "ar": ("الخطر «{risk}» درجته المتبقية {score} وهي تتجاوز حد الرغبة في المخاطر البالغ "
               "{threshold}. تلزم معالجته."),
    },
    "notifications.risk_target_over_appetite.title": {
        "en": "Target risk still over appetite: {risk:.50}",
        "fr": "Risque cible toujours au-delà de l'appétence : {risk:.50}",
        "ar": "الخطر المستهدف لا يزال يتجاوز مستوى الرغبة: {risk:.50}",
    },
    "notifications.risk_target_over_appetite.message": {
        "en": ("Risk '{risk}' has a TARGET score of {target_score} which still exceeds the "
               "appetite threshold of {threshold} even after the planned treatment. The "
               "treatment plan may need to be strengthened."),
        "fr": ("Le risque « {risk} » présente un score CIBLE de {target_score}, qui dépasse encore "
               "le seuil d'appétence de {threshold} même après le traitement prévu. Le plan de "
               "traitement doit peut-être être renforcé."),
        "ar": ("الخطر «{risk}» درجته المستهدفة {target_score} وهي لا تزال تتجاوز حد الرغبة في "
               "المخاطر البالغ {threshold} حتى بعد المعالجة المخططة. قد يلزم تعزيز خطة المعالجة."),
    },
    "notifications.risk_new.title": {
        "en": "New {severity} risk: {risk}",
        "fr": "Nouveau risque ({severity}) : {risk}",
        "ar": "خطر جديد ({severity}): {risk}",
    },
    "notifications.risk_new.message": {
        "en": "A new {severity} severity risk has been added to the risk register.",
        "fr": "Un nouveau risque de gravité « {severity} » a été ajouté au registre des risques.",
        "ar": "تمت إضافة خطر جديد بدرجة خطورة «{severity}» إلى سجل المخاطر.",
    },
    "notifications.treatment_overdue.title": {
        "en": "Treatment plan OVERDUE: {risk:.50}",
        "fr": "Plan de traitement EN RETARD : {risk:.50}",
        "ar": "خطة المعالجة متأخرة: {risk:.50}",
    },
    "notifications.treatment_overdue.message": {
        "en": ("The {option} treatment plan for risk '{risk}' was due {days} day(s) ago and is "
               "only {progress}% complete."),
        "fr": ("Le plan de traitement ({option}) du risque « {risk} » était dû il y a {ndays} "
               "et n'est réalisé qu'à {progress} %."),
        "ar": ("كانت خطة المعالجة ({option}) للخطر «{risk}» مستحقة منذ {ndays} ولم تتجاوز "
               "نسبة إنجازها {progress}%."),
    },
    "notifications.treatment_budget_overrun.title": {
        "en": "Treatment plan over budget: {risk:.50}",
        "fr": "Dépassement budgétaire du plan de traitement : {risk:.50}",
        "ar": "تجاوز ميزانية خطة المعالجة: {risk:.50}",
    },
    "notifications.treatment_budget_overrun.message": {
        "en": ("The {option} treatment plan for risk '{risk}' has an actual cost of {actual} "
               "against an estimated cost of {estimated} (overrun of {overrun})."),
        "fr": ("Le plan de traitement ({option}) du risque « {risk} » affiche un coût réel de "
               "{actual} pour un coût estimé de {estimated} (dépassement de {overrun})."),
        "ar": ("بلغت التكلفة الفعلية لخطة المعالجة ({option}) للخطر «{risk}» {actual} مقابل "
               "تكلفة تقديرية قدرها {estimated} (تجاوز بمقدار {overrun})."),
    },
    # ── Risk scenarios ──
    "notifications.scenario_over_appetite.title": {
        "en": "Scenario over appetite: {scenario:.50}",
        "fr": "Scénario au-delà de l'appétence : {scenario:.50}",
        "ar": "سيناريو يتجاوز مستوى الرغبة في المخاطر: {scenario:.50}",
    },
    "notifications.scenario_over_appetite.message": {
        "en": ("Risk scenario '{scenario}' has a current score of {score} which exceeds its own "
               "appetite threshold of {threshold}. Treatment is required."),
        "fr": ("Le scénario de risque « {scenario} » présente un score actuel de {score}, "
               "supérieur à son seuil d'appétence de {threshold}. Un traitement est requis."),
        "ar": ("سيناريو المخاطر «{scenario}» درجته الحالية {score} وهي تتجاوز حد الرغبة الخاص "
               "به البالغ {threshold}. تلزم معالجته."),
    },
    "notifications.scenario_priority_threshold.title": {
        "en": "Priority threshold reached: {ref}",
        "fr": "Seuil de priorité atteint : {ref}",
        "ar": "تم بلوغ حد الأولوية: {ref}",
    },
    "notifications.scenario_priority_threshold.message": {
        "en": ("Scenario {ref} — '{scenario}' — scores {score} against a threshold of "
               "{threshold}. Review its treatment plan."),
        "fr": ("Le scénario {ref} — « {scenario} » — atteint un score de {score} pour un seuil "
               "de {threshold}. Revoyez son plan de traitement."),
        "ar": ("السيناريو {ref} — «{scenario}» — بلغت درجته {score} مقابل حد قدره {threshold}. "
               "يرجى مراجعة خطة معالجته."),
    },
    "notifications.scenario_review_overdue.title": {
        "en": "Scenario review OVERDUE: {scenario:.50}",
        "fr": "Revue du scénario EN RETARD : {scenario:.50}",
        "ar": "مراجعة السيناريو متأخرة: {scenario:.50}",
    },
    "notifications.scenario_review_overdue.message": {
        "en": "Risk scenario '{scenario}' review is overdue by {days} days.",
        "fr": "La revue du scénario de risque « {scenario} » accuse un retard de {ndays}.",
        "ar": "مراجعة سيناريو المخاطر «{scenario}» متأخرة بـ{ndays}.",
    },
    "notifications.scenario_review_today.title": {
        "en": "Scenario review due TODAY: {scenario:.50}",
        "fr": "Revue du scénario prévue AUJOURD'HUI : {scenario:.50}",
        "ar": "مراجعة السيناريو مستحقة اليوم: {scenario:.50}",
    },
    "notifications.scenario_review_today.message": {
        "en": "Risk scenario '{scenario}' needs to be reviewed today.",
        "fr": "Le scénario de risque « {scenario} » doit être revu aujourd'hui.",
        "ar": "يجب مراجعة سيناريو المخاطر «{scenario}» اليوم.",
    },
    "notifications.scenario_review_due.title": {
        "en": "Scenario review due in {days} days",
        "fr": "Revue de scénario prévue dans {ndays}",
        "ar": "مراجعة سيناريو مستحقة خلال {ndays}",
    },
    "notifications.scenario_review_due.message": {
        "en": "Risk scenario '{scenario}' needs review within {days} days.",
        "fr": "Le scénario de risque « {scenario} » doit être revu sous {ndays}.",
        "ar": "يجب مراجعة سيناريو المخاطر «{scenario}» خلال {ndays}.",
    },
    "notifications.scenario_review_upcoming.title": {
        "en": "Upcoming scenario review in {days} days",
        "fr": "Revue de scénario à venir dans {ndays}",
        "ar": "مراجعة سيناريو قادمة خلال {ndays}",
    },
    "notifications.scenario_review_upcoming.message": {
        "en": "Risk scenario '{scenario}' scheduled for review in {days} days.",
        "fr": "La revue du scénario de risque « {scenario} » est planifiée dans {ndays}.",
        "ar": "مراجعة سيناريو المخاطر «{scenario}» مجدولة خلال {ndays}.",
    },
    # ── Compliance ──
    "notifications.compliance_gap.title": {
        "en": "Critical compliance gap: {control}",
        "fr": "Écart de conformité critique : {control}",
        "ar": "فجوة امتثال حرجة: {control}",
    },
    "notifications.compliance_gap.message": {
        # The gap description is assessment content (often model output) — data.
        "en": "{description}", "fr": "{description}", "ar": "{description}",
    },
    "notifications.compliance_score_drop.title": {
        "en": "Compliance score dropped {drop}% — {framework}",
        "fr": "Baisse du score de conformité de {drop} % — {framework}",
        "ar": "انخفاض درجة الامتثال بنسبة {drop}% — {framework}",
    },
    "notifications.compliance_score_drop.message": {
        "en": "Your compliance score for {framework} dropped from {old}% to {new}%.",
        "fr": "Votre score de conformité pour {framework} est passé de {old} % à {new} %.",
        "ar": "انخفضت درجة امتثالكم لـ{framework} من {old}% إلى {new}%.",
    },
    "notifications.action_item_due_today.title": {
        "en": "Action item due TODAY: {title:.50}",
        "fr": "Action à échéance AUJOURD'HUI : {title:.50}",
        "ar": "إجراء مستحق اليوم: {title:.50}",
    },
    "notifications.action_item_due_today.message": {
        "en": "Action item '{title}' is due today.",
        "fr": "L'action « {title} » arrive à échéance aujourd'hui.",
        "ar": "الإجراء «{title}» مستحق اليوم.",
    },
    "notifications.action_item_due.title": {
        "en": "Action item due in {days} days: {title:.50}",
        "fr": "Action à échéance dans {ndays} : {title:.50}",
        "ar": "إجراء مستحق خلال {ndays}: {title:.50}",
    },
    "notifications.action_item_due.message": {
        "en": "Action item '{title}' needs to be completed within {days} day(s).",
        "fr": "L'action « {title} » doit être réalisée sous {ndays}.",
        "ar": "يجب إنجاز الإجراء «{title}» خلال {ndays}.",
    },
    "notifications.action_item_relance.title": {
        "en": "Reminder {stage}: action '{title:.50}' is {days} day(s) overdue",
        "fr": "Relance {stage} : l'action « {title:.50} » accuse {ndays} de retard",
        "ar": "تذكير {stage}: الإجراء «{title:.50}» متأخر بـ{ndays}",
    },
    "notifications.action_item_relance.message": {
        "en": ("The corrective/preventive action '{title}' was due on {due} and is not closed. "
               "Update its progress or record why it cannot be closed."),
        "fr": ("L'action corrective/préventive « {title} » était due le {due} et n'est pas "
               "clôturée. Mettez à jour son avancement ou justifiez son maintien."),
        "ar": ("كان من المقرر إنجاز الإجراء التصحيحي/الوقائي «{title}» بتاريخ {due} ولم يُغلق "
               "بعد. يرجى تحديث التقدم أو تبرير عدم الإغلاق."),
    },
    "notifications.action_item_relance_escalation.title": {
        "en": "Escalation: action '{title:.50}' is {days} day(s) overdue",
        "fr": "Escalade : l'action « {title:.50} » accuse {ndays} de retard",
        "ar": "تصعيد: الإجراء «{title:.50}» متأخر بـ{ndays}",
    },
    "notifications.action_item_relance_escalation.message": {
        "en": ("Action '{title}' (owner: {owner}) was due on {due} and has not moved after "
               "{reminders} reminder(s). It is escalated to you as the responsible authority."),
        "fr": ("L'action « {title} » (responsable : {owner}) était due le {due} et n'a pas "
               "progressé après {reminders} relance(s). Elle vous est remontée en tant "
               "qu'autorité responsable."),
        "ar": ("الإجراء «{title}» (المسؤول: {owner}) كان مستحقاً في {due} ولم يتقدم بعد "
               "{reminders} تذكير/تذكيرات. تمت إحالته إليكم بصفتكم الجهة المسؤولة."),
    },
    # ── Assets ──
    "notifications.asset_eol_passed.title": {
        "en": "Asset past end-of-life: {asset:.50}",
        "fr": "Actif en fin de vie dépassée : {asset:.50}",
        "ar": "أصل تجاوز نهاية عمره: {asset:.50}",
    },
    "notifications.asset_eol_passed.message": {
        "en": ("Asset '{asset}' reached end-of-life {days} days ago and should be retired or "
               "replaced."),
        "fr": ("L'actif « {asset} » a atteint sa fin de vie il y a {ndays} et doit être retiré "
               "ou remplacé."),
        "ar": "بلغ الأصل «{asset}» نهاية عمره منذ {ndays} ويجب سحبه من الخدمة أو استبداله.",
    },
    "notifications.asset_eol_soon.title": {
        "en": "Asset end-of-life in {days} days: {asset:.50}",
        "fr": "Fin de vie de l'actif dans {ndays} : {asset:.50}",
        "ar": "نهاية عمر الأصل خلال {ndays}: {asset:.50}",
    },
    "notifications.asset_eol_soon.message": {
        "en": "Asset '{asset}' reaches end-of-life in {days} days. Plan replacement/retirement.",
        "fr": ("L'actif « {asset} » atteint sa fin de vie dans {ndays}. Planifiez son "
               "remplacement ou son retrait."),
        "ar": "يبلغ الأصل «{asset}» نهاية عمره خلال {ndays}. يرجى التخطيط لاستبداله أو سحبه.",
    },
    "notifications.asset_eol_approaching.title": {
        "en": "Asset end-of-life approaching: {asset:.50}",
        "fr": "Fin de vie de l'actif imminente : {asset:.50}",
        "ar": "اقتراب نهاية عمر الأصل: {asset:.50}",
    },
    "notifications.asset_eol_approaching.message": {
        "en": "Asset '{asset}' reaches end-of-life in {days} days ({eol}).",
        "fr": "L'actif « {asset} » atteint sa fin de vie dans {ndays} ({eol}).",
        "ar": "يبلغ الأصل «{asset}» نهاية عمره خلال {ndays} ({eol}).",
    },
    "notifications.asset_review_overdue.title": {
        "en": "Asset review OVERDUE: {asset:.50}",
        "fr": "Revue de l'actif EN RETARD : {asset:.50}",
        "ar": "مراجعة الأصل متأخرة: {asset:.50}",
    },
    "notifications.asset_review_overdue.message": {
        "en": "Asset '{asset}' review is overdue by {days} days.",
        "fr": "La revue de l'actif « {asset} » accuse un retard de {ndays}.",
        "ar": "مراجعة الأصل «{asset}» متأخرة بـ{ndays}.",
    },
    "notifications.asset_review_today.title": {
        "en": "Asset review due TODAY: {asset:.50}",
        "fr": "Revue de l'actif prévue AUJOURD'HUI : {asset:.50}",
        "ar": "مراجعة الأصل مستحقة اليوم: {asset:.50}",
    },
    "notifications.asset_review_today.message": {
        "en": "Asset '{asset}' needs to be reviewed today.",
        "fr": "L'actif « {asset} » doit être revu aujourd'hui.",
        "ar": "يجب مراجعة الأصل «{asset}» اليوم.",
    },
    "notifications.asset_review_due.title": {
        "en": "Asset review due in {days} days",
        "fr": "Revue d'actif prévue dans {ndays}",
        "ar": "مراجعة أصل مستحقة خلال {ndays}",
    },
    "notifications.asset_review_due.message": {
        "en": "Asset '{asset}' needs review within {days} days.",
        "fr": "L'actif « {asset} » doit être revu sous {ndays}.",
        "ar": "يجب مراجعة الأصل «{asset}» خلال {ndays}.",
    },
    "notifications.asset_review_upcoming.title": {
        "en": "Upcoming asset review in {days} days",
        "fr": "Revue d'actif à venir dans {ndays}",
        "ar": "مراجعة أصل قادمة خلال {ndays}",
    },
    "notifications.asset_review_upcoming.message": {
        "en": "Asset '{asset}' scheduled for review in {days} days.",
        "fr": "La revue de l'actif « {asset} » est planifiée dans {ndays}.",
        "ar": "مراجعة الأصل «{asset}» مجدولة خلال {ndays}.",
    },
    # ── Threats ──
    "notifications.threat_review_overdue.title": {
        "en": "Threat profile review was due {days} day(s) ago: {threat:.50}",
        "fr": "Revue du profil de menace due il y a {ndays} : {threat:.50}",
        "ar": "كانت مراجعة ملف التهديد مستحقة منذ {ndays}: {threat:.50}",
    },
    "notifications.threat_review_overdue.message": {
        "en": ("The profile for '{threat}' was due {days} day(s) ago ({due}). Confirm it still "
               "holds against the current threat watch, or update it."),
        "fr": ("La revue du profil « {threat} » était due il y a {ndays} ({due}). Confirmez "
               "qu'il reste valable au regard de la veille actuelle sur les menaces, ou mettez-le à jour."),
        "ar": ("كانت مراجعة ملف «{threat}» مستحقة منذ {ndays} ({due}). يرجى التأكد من أنه لا "
               "يزال صالحاً في ضوء رصد التهديدات الحالي، أو تحديثه."),
    },
    "notifications.threat_review_today.title": {
        "en": "Threat profile review is due today: {threat:.50}",
        "fr": "Revue du profil de menace prévue aujourd'hui : {threat:.50}",
        "ar": "مراجعة ملف التهديد مستحقة اليوم: {threat:.50}",
    },
    "notifications.threat_review_today.message": {
        "en": ("The profile for '{threat}' is due today ({due}). Confirm it still holds against "
               "the current threat watch, or update it."),
        "fr": ("La revue du profil « {threat} » est prévue aujourd'hui ({due}). Confirmez qu'il "
               "reste valable au regard de la veille actuelle sur les menaces, ou mettez-le à jour."),
        "ar": ("مراجعة ملف «{threat}» مستحقة اليوم ({due}). يرجى التأكد من أنه لا يزال صالحاً "
               "في ضوء رصد التهديدات الحالي، أو تحديثه."),
    },
    "notifications.threat_review_due.title": {
        "en": "Threat profile review is due in {days} day(s): {threat:.50}",
        "fr": "Revue du profil de menace prévue dans {ndays} : {threat:.50}",
        "ar": "مراجعة ملف التهديد مستحقة خلال {ndays}: {threat:.50}",
    },
    "notifications.threat_review_due.message": {
        "en": ("The profile for '{threat}' is due in {days} day(s) ({due}). Confirm it still "
               "holds against the current threat watch, or update it."),
        "fr": ("La revue du profil « {threat} » est prévue dans {ndays} ({due}). Confirmez "
               "qu'il reste valable au regard de la veille actuelle sur les menaces, ou mettez-le à jour."),
        "ar": ("مراجعة ملف «{threat}» مستحقة خلال {ndays} ({due}). يرجى التأكد من أنه لا يزال "
               "صالحاً في ضوء رصد التهديدات الحالي، أو تحديثه."),
    },
    "notifications.threat_critical.title": {
        "en": "Critical threat intelligence: {name:.60}",
        "fr": "Renseignement sur une menace critique : {name:.60}",
        "ar": "معلومات استخباراتية عن تهديد حرج: {name:.60}",
    },
    "notifications.threat_critical.message": {
        "en": "'{name}' was reported by {source} and is waiting in the threat watch.",
        "fr": "« {name} » a été signalé par {source} et attend dans la veille des menaces.",
        "ar": "تم الإبلاغ عن «{name}» من قِبل {source} وهو بانتظار المعالجة في رصد التهديدات.",
    },
    "notifications.scan_import_failed.title": {
        "en": "Vulnerability scan import failed: {name}",
        "fr": "Échec de l'import du scan de vulnérabilités : {name}",
        "ar": "فشل استيراد فحص الثغرات: {name}",
    },
    "notifications.scan_import_failed.message": {
        "en": ("The scheduled import from {tool} connector '{name}' did not complete: {detail}. "
               "The vulnerability register has not been refreshed from this tool — check the "
               "connector and re-run the sync."),
        "fr": ("L'import planifié depuis le connecteur {tool} « {name} » n'a pas abouti : "
               "{detail}. Le registre des vulnérabilités n'a pas été actualisé depuis cet outil — "
               "vérifiez le connecteur et relancez la synchronisation."),
        "ar": ("لم يكتمل الاستيراد المجدول من موصل {tool} «{name}»: {detail}. لم يتم تحديث سجل "
               "الثغرات من هذه الأداة — يرجى التحقق من الموصل وإعادة المزامنة."),
    },
    # ── Applied controls ──
    "notifications.control_expired.title": {
        "en": "Control EXPIRED: {control:.50}",
        "fr": "Contrôle EXPIRÉ : {control:.50}",
        "ar": "ضابط منتهي الصلاحية: {control:.50}",
    },
    "notifications.control_expired.message": {
        "en": "Applied control '{control}' expired {days} days ago and needs renewal.",
        "fr": "Le contrôle appliqué « {control} » a expiré il y a {ndays} et doit être renouvelé.",
        "ar": "انتهت صلاحية الضابط المطبق «{control}» منذ {ndays} ويحتاج إلى تجديد.",
    },
    "notifications.control_expires_today.title": {
        "en": "Control expires TODAY: {control:.50}",
        "fr": "Le contrôle expire AUJOURD'HUI : {control:.50}",
        "ar": "تنتهي صلاحية الضابط اليوم: {control:.50}",
    },
    "notifications.control_expires_today.message": {
        "en": "Applied control '{control}' expires today.",
        "fr": "Le contrôle appliqué « {control} » expire aujourd'hui.",
        "ar": "تنتهي صلاحية الضابط المطبق «{control}» اليوم.",
    },
    "notifications.control_expiring.title": {
        "en": "Control expiring in {days} days: {control:.50}",
        "fr": "Contrôle arrivant à expiration dans {ndays} : {control:.50}",
        "ar": "تنتهي صلاحية الضابط خلال {ndays}: {control:.50}",
    },
    "notifications.control_expiring.message": {
        "en": "Applied control '{control}' expires in {days} days. Plan renewal.",
        "fr": "Le contrôle appliqué « {control} » expire dans {ndays}. Planifiez son renouvellement.",
        "ar": "تنتهي صلاحية الضابط المطبق «{control}» خلال {ndays}. يرجى التخطيط لتجديده.",
    },
    "notifications.control_unverified.title": {
        "en": "Control in service without sign-off: {ref}",
        "fr": "Contrôle en service sans validation : {ref}",
        "ar": "ضابط قيد التشغيل دون اعتماد: {ref}",
    },
    "notifications.control_unverified.message": {
        "en": ("'{control}' is {state} and has been operating for over 30 days without "
               "validation by a security referent. Everything that reads the register counts it "
               "as a mitigation."),
        "fr": ("« {control} » est au statut « {state} » et fonctionne depuis plus de 30 jours "
               "sans validation par un référent sécurité. Tout ce qui s'appuie sur le registre le "
               "compte pourtant comme une mesure d'atténuation."),
        "ar": ("الضابط «{control}» في حالة «{state}» ويعمل منذ أكثر من 30 يوماً دون اعتماد من "
               "مرجع أمني، ومع ذلك يُحتسب إجراءً للتخفيف في كل ما يعتمد على السجل."),
    },
    "notifications.control_rejected_in_service.title": {
        "en": "Control rejected but still in service: {ref}",
        "fr": "Contrôle rejeté mais toujours en service : {ref}",
        "ar": "ضابط مرفوض ولا يزال قيد التشغيل: {ref}",
    },
    "notifications.control_rejected_in_service.message": {
        "en": ("'{control}' is {state} and has been operating for over 30 days without "
               "validation by a security referent. Everything that reads the register counts it "
               "as a mitigation."),
        "fr": ("« {control} » est au statut « {state} » et fonctionne depuis plus de 30 jours "
               "sans validation par un référent sécurité. Tout ce qui s'appuie sur le registre le "
               "compte pourtant comme une mesure d'atténuation."),
        "ar": ("الضابط «{control}» في حالة «{state}» ويعمل منذ أكثر من 30 يوماً دون اعتماد من "
               "مرجع أمني، ومع ذلك يُحتسب إجراءً للتخفيف في كل ما يعتمد على السجل."),
    },
    "notifications.control_evaluation_overdue.title": {
        "en": "Control evaluation was due {days} day(s) ago: {ref}",
        "fr": "Évaluation du contrôle due il y a {ndays} : {ref}",
        "ar": "كان تقييم الضابط مستحقاً منذ {ndays}: {ref}",
    },
    "notifications.control_evaluation_overdue.message": {
        "en": ("The effectiveness evaluation for '{control}' was due {days} day(s) ago ({due}). "
               "Last result: {last_result}."),
        "fr": ("L'évaluation d'efficacité de « {control} » était due il y a {ndays} ({due}). "
               "Dernier résultat : {last_result}."),
        "ar": "كان تقييم فعالية «{control}» مستحقاً منذ {ndays} ({due}). آخر نتيجة: {last_result}.",
    },
    "notifications.control_evaluation_today.title": {
        "en": "Control evaluation is due today: {ref}",
        "fr": "Évaluation du contrôle prévue aujourd'hui : {ref}",
        "ar": "تقييم الضابط مستحق اليوم: {ref}",
    },
    "notifications.control_evaluation_today.message": {
        "en": ("The effectiveness evaluation for '{control}' is due today ({due}). "
               "Last result: {last_result}."),
        "fr": ("L'évaluation d'efficacité de « {control} » est prévue aujourd'hui ({due}). "
               "Dernier résultat : {last_result}."),
        "ar": "تقييم فعالية «{control}» مستحق اليوم ({due}). آخر نتيجة: {last_result}.",
    },
    "notifications.control_evaluation_due.title": {
        "en": "Control evaluation is due in {days} day(s): {ref}",
        "fr": "Évaluation du contrôle prévue dans {ndays} : {ref}",
        "ar": "تقييم الضابط مستحق خلال {ndays}: {ref}",
    },
    "notifications.control_evaluation_due.message": {
        "en": ("The effectiveness evaluation for '{control}' is due in {days} day(s) ({due}). "
               "Last result: {last_result}."),
        "fr": ("L'évaluation d'efficacité de « {control} » est prévue dans {ndays} ({due}). "
               "Dernier résultat : {last_result}."),
        "ar": "تقييم فعالية «{control}» مستحق خلال {ndays} ({due}). آخر نتيجة: {last_result}.",
    },
    # ── Security ──
    "notifications.new_device_login.title": {
        "en": "New device sign-in detected",
        "fr": "Connexion depuis un nouvel appareil détectée",
        "ar": "تم رصد تسجيل دخول من جهاز جديد",
    },
    "notifications.new_device_login.message": {
        "en": ("Your GRCEye account was just signed in to from a device we haven't seen before "
               "({device}) from IP {ip}. If this wasn't you, change your password immediately and "
               "review your active sessions in Settings."),
        "en_alt": ("Your GRCEye account was just signed in to from a device we haven't seen "
                   "before ({device}). If this wasn't you, change your password immediately and "
                   "review your active sessions in Settings.",),
        "fr": ("Une connexion à votre compte GRCEye vient d'être effectuée depuis un appareil "
               "inconnu ({device}){ip_where}. Si ce n'était pas vous, changez immédiatement votre "
               "mot de passe et vérifiez vos sessions actives dans les Paramètres."),
        "ar": ("تم للتو تسجيل الدخول إلى حسابكم في GRCEye من جهاز لم يُستخدم من قبل "
               "({device}){ip_where}. إذا لم تكونوا أنتم، فيرجى تغيير كلمة المرور فوراً ومراجعة "
               "جلساتكم النشطة في الإعدادات."),
    },
    "notifications.new_device_login_admin.title": {
        "en": "New device sign-in: {user}",
        "fr": "Connexion depuis un nouvel appareil : {user}",
        "ar": "تسجيل دخول من جهاز جديد: {user}",
    },
    "notifications.new_device_login_admin.message": {
        "en": ("{user} ({email}) signed in from a device not previously seen for this account "
               "({device}) from IP {ip}."),
        "en_alt": ("{user} ({email}) signed in from a device not previously seen for this "
                   "account ({device}).",),
        "fr": ("{user} ({email}) s'est connecté depuis un appareil jamais vu pour ce compte "
               "({device}){ip_where}."),
        "ar": "سجّل {user} ({email}) الدخول من جهاز لم يُرصد سابقاً لهذا الحساب ({device}){ip_where}.",
    },
    # ── Audits ──
    "notifications.finding_overdue.title": {
        "en": "Recommendation OVERDUE: {finding:.50}",
        "fr": "Recommandation EN RETARD : {finding:.50}",
        "ar": "توصية متأخرة: {finding:.50}",
    },
    "notifications.finding_overdue.message": {
        "en": "The recommendation '{finding}' from audit '{audit}' is overdue by {days} days.",
        "fr": "La recommandation « {finding} » de l'audit « {audit} » accuse un retard de {ndays}.",
        "ar": "التوصية «{finding}» الصادرة عن مهمة التدقيق «{audit}» متأخرة بـ{ndays}.",
    },
    "notifications.finding_due_today.title": {
        "en": "Recommendation due TODAY: {finding:.50}",
        "fr": "Recommandation à échéance AUJOURD'HUI : {finding:.50}",
        "ar": "توصية مستحقة اليوم: {finding:.50}",
    },
    "notifications.finding_due_today.message": {
        "en": "The recommendation '{finding}' from audit '{audit}' is due today.",
        "fr": "La recommandation « {finding} » de l'audit « {audit} » arrive à échéance aujourd'hui.",
        "ar": "التوصية «{finding}» الصادرة عن مهمة التدقيق «{audit}» مستحقة اليوم.",
    },
    "notifications.finding_due.title": {
        "en": "Recommendation due in {days} days: {finding:.50}",
        "fr": "Recommandation à échéance dans {ndays} : {finding:.50}",
        "ar": "توصية مستحقة خلال {ndays}: {finding:.50}",
    },
    "notifications.finding_due.message": {
        "en": ("The recommendation '{finding}' from audit '{audit}' needs to be addressed within "
               "{days} day(s)."),
        "fr": "La recommandation « {finding} » de l'audit « {audit} » doit être traitée sous {ndays}.",
        "ar": "يجب معالجة التوصية «{finding}» الصادرة عن مهمة التدقيق «{audit}» خلال {ndays}.",
    },
    "notifications.audit_schedule.title": {
        "en": "Audit '{audit:.50}' starts in {days} day(s)",
        "fr": "L'audit « {audit:.50} » démarre dans {ndays}",
        "ar": "تبدأ مهمة التدقيق «{audit:.50}» خلال {ndays}",
    },
    "notifications.audit_schedule.message": {
        "en": ("Audit '{audit}' is planned to start on {start}. Confirm the scope, the auditors "
               "and the availability of the audited teams."),
        "fr": ("L'audit « {audit} » est planifié pour le {start}. Confirmez le périmètre, les "
               "auditeurs et la disponibilité des équipes auditées."),
        "ar": ("من المقرر أن تبدأ مهمة التدقيق «{audit}» في {start}. يرجى تأكيد النطاق "
               "والمدققين وجاهزية الفرق المعنية."),
    },
    "notifications.audit_starting_today.title": {
        "en": "Audit '{audit:.50}' starts today",
        "fr": "L'audit « {audit:.50} » démarre aujourd'hui",
        "ar": "تبدأ مهمة التدقيق «{audit:.50}» اليوم",
    },
    "notifications.audit_starting_today.message": {
        "en": "Audit '{audit}' is planned to start today ({start}).",
        "fr": "L'audit « {audit} » est planifié pour aujourd'hui ({start}).",
        "ar": "من المقرر أن تبدأ مهمة التدقيق «{audit}» اليوم ({start}).",
    },
    "notifications.audit_start_overdue.title": {
        "en": "Audit '{audit:.50}' has not started ({days} day(s) late)",
        "fr": "L'audit « {audit:.50} » n'a pas démarré ({ndays} de retard)",
        "ar": "لم تبدأ مهمة التدقيق «{audit:.50}» (تأخير {ndays})",
    },
    "notifications.audit_start_overdue.message": {
        "en": ("Audit '{audit}' was planned to start on {start} and is still in planning. "
               "Re-plan it or start the fieldwork."),
        "fr": ("L'audit « {audit} » devait démarrer le {start} et reste en planification. "
               "Replanifiez-le ou lancez les travaux."),
        "ar": ("كان من المقرر بدء مهمة التدقيق «{audit}» في {start} ولا تزال في مرحلة "
               "التخطيط. يرجى إعادة التخطيط أو بدء الأعمال الميدانية."),
    },
    "notifications.audit_assigned.title": {
        "en": "Audit assigned: {audit}",
        "fr": "Audit attribué : {audit}",
        "ar": "تم إسناد مهمة تدقيق: {audit}",
    },
    "notifications.audit_assigned.message": {
        "en": "You have been assigned as lead auditor for '{audit}'.",
        "fr": "Vous avez été désigné auditeur principal pour « {audit} ».",
        "ar": "تم تعيينكم مدققاً رئيسياً لمهمة «{audit}».",
    },
    "notifications.audit_finding_assigned.title": {
        "en": "A finding was assigned to you",
        "fr": "Un constat vous a été affecté",
        "ar": "تم إسناد ملاحظة إليكم",
    },
    "notifications.audit_finding_assigned.message": {
        "en": "'{finding}' was raised in the audit '{audit}'.",
        "fr": "« {finding} » a été relevé lors de l'audit « {audit} ».",
        "ar": "تم تسجيل «{finding}» ضمن مهمة التدقيق «{audit}».",
    },
    "notifications.audit_finding_closed.title": {
        "en": "Finding closed",
        "fr": "Constat clôturé",
        "ar": "تم إغلاق الملاحظة",
    },
    "notifications.audit_finding_closed.message": {
        "en": "'{finding}' was closed after verification.",
        "fr": "« {finding} » a été clôturé après vérification.",
        "ar": "تم إغلاق «{finding}» بعد التحقق.",
    },
    "notifications.audit_recommendation_assigned.title": {
        "en": "A recommendation was assigned to you",
        "fr": "Une recommandation vous a été affectée",
        "ar": "تم إسناد توصية إليكم",
    },
    "notifications.audit_recommendation_assigned.message": {
        "en": "'{recommendation}' (audit '{audit}').",
        "fr": "« {recommendation} » (audit « {audit} »).",
        "ar": "«{recommendation}» (مهمة التدقيق «{audit}»).",
    },
    "notifications.audit_report_submitted.title": {
        "en": "Audit report awaiting validation",
        "fr": "Rapport d'audit en attente de validation",
        "ar": "تقرير تدقيق بانتظار الاعتماد",
    },
    "notifications.audit_report_submitted.message": {
        "en": "The report for '{audit}' is awaiting validation before distribution.",
        "fr": "Le rapport de « {audit} » est en attente de validation avant diffusion.",
        "ar": "تقرير «{audit}» بانتظار الاعتماد قبل توزيعه.",
    },
    "notifications.audit_report_approved.title": {
        "en": "Audit report approved",
        "fr": "Rapport d'audit validé",
        "ar": "تم اعتماد تقرير التدقيق",
    },
    "notifications.audit_report_approved.message": {
        "en": "The report for '{audit}' was approved and may now be distributed.",
        "fr": "Le rapport de « {audit} » a été validé et peut désormais être diffusé.",
        "ar": "تم اعتماد تقرير «{audit}» ويمكن توزيعه الآن.",
    },
    "notifications.audit_report_rejected.title": {
        "en": "Audit report returned",
        "fr": "Rapport d'audit renvoyé",
        "ar": "تمت إعادة تقرير التدقيق",
    },
    "notifications.audit_report_rejected.message": {
        "en": "The report for '{audit}' was returned for correction.",
        "fr": "Le rapport de « {audit} » a été renvoyé pour correction.",
        "ar": "تمت إعادة تقرير «{audit}» لتصحيحه.",
    },
    "notifications.audit_comment_new.title": {
        "en": "New audit comment",
        "fr": "Nouveau commentaire d'audit",
        "ar": "تعليق تدقيق جديد",
    },
    "notifications.audit_comment_new.message": {
        "en": "A new message was posted on the audit '{audit}'.",
        "fr": "Un nouveau message a été publié sur l'audit « {audit} ».",
        "ar": "تم نشر رسالة جديدة في مهمة التدقيق «{audit}».",
    },
    "notifications.audit_comment.title": {
        "en": "New audit comment",
        "fr": "Nouveau commentaire d'audit",
        "ar": "تعليق تدقيق جديد",
    },
    "notifications.audit_comment.message": {
        "en": "{author} commented on '{subject}': {excerpt}",
        "fr": "{author} a commenté « {subject} » : {excerpt}",
        "ar": "علّق {author} على «{subject}»: {excerpt}",
    },
    "notifications.audit_campaign.published.title": {
        "en": "Audit plan published",
        "fr": "Plan d'audit publié",
        "ar": "تم نشر خطة التدقيق",
    },
    "notifications.audit_campaign.published.message": {
        "en": "The audit campaign '{campaign}' has been published.",
        "fr": "La campagne d'audit « {campaign} » a été publiée.",
        "ar": "تم نشر حملة التدقيق «{campaign}».",
    },
    "notifications.recommendation_due.title": {
        "en": "Recommendation {ref} is due in {days} day(s)",
        "fr": "La recommandation {ref} arrive à échéance dans {ndays}",
        "ar": "التوصية {ref} مستحقة خلال {ndays}",
    },
    "notifications.recommendation_due.message": {
        "en": ("Recommendation '{title}' from audit '{audit}' is due on {due} and is "
               "{progress}% complete. Track it through to effective closure."),
        "fr": ("La recommandation « {title} » de l'audit « {audit} » est due le {due} et avance "
               "à {progress} %. Suivez-la jusqu'à sa clôture effective."),
        "ar": ("التوصية «{title}» الصادرة عن مهمة التدقيق «{audit}» مستحقة في {due} وبلغت نسبة "
               "إنجازها {progress}%. يرجى متابعتها حتى الإغلاق الفعلي."),
    },
    "notifications.recommendation_due_today.title": {
        "en": "Recommendation {ref} is due today",
        "fr": "La recommandation {ref} arrive à échéance aujourd'hui",
        "ar": "التوصية {ref} مستحقة اليوم",
    },
    "notifications.recommendation_due_today.message": {
        "en": ("Recommendation '{title}' from audit '{audit}' is due today ({due}) and is "
               "{progress}% complete."),
        "fr": ("La recommandation « {title} » de l'audit « {audit} » est due aujourd'hui ({due}) "
               "et avance à {progress} %."),
        "ar": ("التوصية «{title}» الصادرة عن مهمة التدقيق «{audit}» مستحقة اليوم ({due}) وبلغت "
               "نسبة إنجازها {progress}%."),
    },
    "notifications.recommendation_overdue.title": {
        "en": "Recommendation {ref} is {days} day(s) overdue",
        "fr": "La recommandation {ref} accuse {ndays} de retard",
        "ar": "التوصية {ref} متأخرة بـ{ndays}",
    },
    "notifications.recommendation_overdue.message": {
        "en": ("Recommendation '{title}' from audit '{audit}' was due on {due} and is still only "
               "{progress}% complete. It remains open until effective closure."),
        "fr": ("La recommandation « {title} » de l'audit « {audit} » était due le {due} et "
               "n'avance qu'à {progress} %. Elle reste ouverte jusqu'à sa clôture effective."),
        "ar": ("التوصية «{title}» الصادرة عن مهمة التدقيق «{audit}» كانت مستحقة في {due} ولم "
               "تتجاوز نسبة إنجازها {progress}%. تبقى مفتوحة حتى الإغلاق الفعلي."),
    },
    # ── Governance / policies / frameworks ──
    "notifications.raci_responsible_assigned.title": {
        "en": "You are now responsible for: {activity:.60}",
        "fr": "Vous êtes désormais responsable de : {activity:.60}",
        "ar": "أصبحتم مسؤولين عن: {activity:.60}",
    },
    "notifications.raci_responsible_assigned.message": {
        "en": "You have been assigned as the responsible (R) party for '{activity}'.",
        "fr": "Vous avez été désigné comme responsable (R) de « {activity} ».",
        "ar": "تم تعيينكم الطرفَ المسؤول (R) عن «{activity}».",
    },
    "notifications.raci_responsible_removed.title": {
        "en": "Responsibility reassigned: {activity:.60}",
        "fr": "Responsabilité réattribuée : {activity:.60}",
        "ar": "تمت إعادة إسناد المسؤولية: {activity:.60}",
    },
    "notifications.raci_responsible_removed.message": {
        "en": "You are no longer the responsible (R) party for '{activity}'.",
        "fr": "Vous n'êtes plus le responsable (R) de « {activity} ».",
        "ar": "لم تعودوا الطرفَ المسؤول (R) عن «{activity}».",
    },
    "notifications.policy_review_due.title": {
        "en": "Policy review due: {policy}",
        "fr": "Revue de politique à échéance : {policy}",
        "ar": "مراجعة سياسة مستحقة: {policy}",
    },
    "notifications.policy_review_due.message": {
        "en": "The policy '{policy}' is due for review on {due}.",
        "fr": "La revue de la politique « {policy} » est prévue le {due}.",
        "ar": "مراجعة السياسة «{policy}» مستحقة في {due}.",
    },
    "notifications.weekly_digest.title": {
        "en": "Weekly GRC Digest",
        "fr": "Synthèse GRC hebdomadaire",
        "ar": "الملخص الأسبوعي للحوكمة والمخاطر والامتثال",
    },
    "notifications.weekly_digest.message": {
        "en": ("This week: {open_risks} open risks, {open_findings} audit findings, "
               "{policies_due} policies due for review."),
        "fr": ("Cette semaine : {open_risks} risques ouverts, {open_findings} constats d'audit, "
               "{policies_due} politiques à revoir."),
        "ar": ("هذا الأسبوع: {open_risks} مخاطر مفتوحة، {open_findings} ملاحظات تدقيق، "
               "{policies_due} سياسات مستحقة المراجعة."),
    },
    "notifications.framework_new.title": {
        "en": "New framework available: {framework}",
        "fr": "Nouveau référentiel disponible : {framework}",
        "ar": "إطار مرجعي جديد متاح: {framework}",
    },
    "notifications.framework_new.message": {
        "en": "A new compliance framework '{framework}' has been added to the platform.",
        "fr": "Un nouveau référentiel de conformité « {framework} » a été ajouté à la plateforme.",
        "ar": "تمت إضافة إطار امتثال جديد «{framework}» إلى المنصة.",
    },
    "notifications.framework_updated.title": {
        "en": "Framework updated: {framework}",
        "fr": "Référentiel mis à jour : {framework}",
        "ar": "تم تحديث الإطار المرجعي: {framework}",
    },
    "notifications.framework_updated.message": {
        "en": "The compliance framework '{framework}' has been updated with new controls.",
        "fr": "Le référentiel de conformité « {framework} » a été mis à jour avec de nouveaux contrôles.",
        "ar": "تم تحديث إطار الامتثال «{framework}» بضوابط جديدة.",
    },
    "notifications.ai_access_approved.title": {
        "en": "AI Access Approved",
        "fr": "Accès IA approuvé",
        "ar": "تمت الموافقة على الوصول إلى الذكاء الاصطناعي",
    },
    "notifications.ai_access_approved.message": {
        "en": ("Your AI access request has been approved! You can now use all AI features with "
               "your monthly token limit."),
        "fr": ("Votre demande d'accès IA a été approuvée ! Vous pouvez désormais utiliser toutes "
               "les fonctionnalités IA dans la limite de votre quota mensuel de jetons."),
        "ar": ("تمت الموافقة على طلب الوصول إلى الذكاء الاصطناعي! يمكنكم الآن استخدام جميع ميزات "
               "الذكاء الاصطناعي ضمن حصتكم الشهرية من الرموز."),
    },
    "notifications.ai_access_request.title": {
        "en": "AI Access Request from {user}",
        "fr": "Demande d'accès IA de {user}",
        "ar": "طلب وصول إلى الذكاء الاصطناعي من {user}",
    },
    "notifications.ai_access_request.message": {
        "en": "{user} ({email}) has requested access to {feature} AI features.",
        "fr": "{user} ({email}) a demandé l'accès aux fonctionnalités IA « {feature} ».",
        "ar": "طلب {user} ({email}) الوصول إلى ميزات الذكاء الاصطناعي «{feature}».",
    },
    # ── External share links ──
    "notifications.share_link_viewed.title": {
        "en": "Stakeholder opened upload link",
        "fr": "Un intervenant a ouvert le lien de dépôt",
        "ar": "فتح أحد أصحاب المصلحة رابط الرفع",
    },
    "notifications.share_link_viewed.message": {
        "en": ('The share link "{link}" ({control_id} — {control_title}) was opened by an '
               'external stakeholder.'),
        "en_alt": ('The share link "{link}" was opened by an external stakeholder.',),
        "fr": "Le lien de partage « {link} »{ctrl_paren} a été ouvert par un intervenant externe.",
        "ar": "تم فتح رابط المشاركة «{link}»{ctrl_paren} من قِبل أحد أصحاب المصلحة الخارجيين.",
    },
    "notifications.share_link_upload.title": {
        "en": "New evidence file received",
        "fr": "Nouveau fichier de preuve reçu",
        "ar": "تم استلام ملف دليل جديد",
    },
    "notifications.share_link_upload.message": {
        "en": ('A stakeholder uploaded "{file}" ({size_kb} KB) for {control_id} — {control_title} '
               'via share link "{link}".'),
        "en_alt": ('A stakeholder uploaded "{file}" ({size_kb} KB) via share link "{link}".',),
        "fr": ("Un intervenant a déposé « {file} » ({size_kb} Ko){ctrl_for} via le lien de "
               "partage « {link} »."),
        "ar": "رفع أحد أصحاب المصلحة الملف «{file}» ({size_kb} كيلوبايت){ctrl_for} عبر رابط المشاركة «{link}».",
    },
    # ── Evidence validity (R2) ──
    "notifications.evidence_expired.title": {
        "en": "Evidence EXPIRED: {control}",
        "fr": "Preuve EXPIRÉE : {control}",
        "ar": "دليل منتهي الصلاحية: {control}",
    },
    "notifications.evidence_expired.message": {
        "en": "The evidence '{file}' for {control} expired on {until}.",
        "fr": "La preuve « {file} » pour {control} a expiré le {until}.",
        "ar": "انتهت صلاحية الدليل «{file}» الخاص بـ{control} في {until}.",
    },
    "notifications.evidence_expiring.title": {
        "en": "Evidence expires in {days} days: {control}",
        "fr": "Preuve expirant dans {ndays} : {control}",
        "ar": "ينتهي الدليل خلال {ndays}: {control}",
    },
    "notifications.evidence_expiring.message": {
        "en": "The evidence '{file}' for {control} is valid until {until}.",
        "fr": "La preuve « {file} » pour {control} est valable jusqu'au {until}.",
        "ar": "الدليل «{file}» الخاص بـ{control} صالح حتى {until}.",
    },
    # ── Policies (R2) ──
    "notifications.policy_review_overdue.title": {
        "en": "Policy review OVERDUE: {policy:.50}",
        "fr": "Revue de politique EN RETARD : {policy:.50}",
        "ar": "مراجعة السياسة متأخرة: {policy:.50}",
    },
    "notifications.policy_review_overdue.message": {
        "en": "Policy '{policy}' was due for review on {due}.",
        "fr": "La politique « {policy} » devait être revue le {due}.",
        "ar": "كان من المفترض مراجعة السياسة «{policy}» في {due}.",
    },
    "notifications.policy_review_due.title": {
        "en": "Policy review due in {days} days: {policy:.50}",
        "fr": "Revue de politique dans {ndays} : {policy:.50}",
        "ar": "مراجعة السياسة مستحقة خلال {ndays}: {policy:.50}",
    },
    "notifications.policy_review_due.message": {
        "en": "Policy '{policy}' is due for review on {due}.",
        "fr": "La politique « {policy} » doit être revue le {due}.",
        "ar": "يجب مراجعة السياسة «{policy}» في {due}.",
    },
    "notifications.attestation_overdue.title": {
        "en": "Policy acknowledgement OVERDUE: {policy:.50}",
        "fr": "Prise de connaissance EN RETARD : {policy:.50}",
        "ar": "الإقرار بالسياسة متأخر: {policy:.50}",
    },
    "notifications.attestation_overdue.message": {
        "en": "Please read and accept '{policy}' (due {due}).",
        "fr": "Veuillez lire et accepter « {policy} » (échéance {due}).",
        "ar": "يرجى قراءة السياسة «{policy}» وقبولها (الموعد {due}).",
    },
}

# ── Platform vocabulary inside params ────────────────────────────────────────
PARAM_VOCAB: dict[str, dict[str, dict[str, str]]] = {
    "severity": {
        "critical": {"fr": "critique", "ar": "حرج"},
        "high": {"fr": "élevé", "ar": "مرتفع"},
        "medium": {"fr": "moyen", "ar": "متوسط"},
        "low": {"fr": "faible", "ar": "منخفض"},
        "info": {"fr": "information", "ar": "معلومة"},
    },
    "option": {
        "mitigate": {"fr": "atténuation", "ar": "تخفيف"},
        "accept": {"fr": "acceptation", "ar": "قبول"},
        "transfer": {"fr": "transfert", "ar": "نقل"},
        "avoid": {"fr": "évitement", "ar": "تجنّب"},
    },
    "state": {
        "pending": {"fr": "en attente", "ar": "قيد الانتظار"},
        "rejected": {"fr": "rejeté", "ar": "مرفوض"},
        "validated": {"fr": "validé", "ar": "معتمد"},
    },
    "last_result": {
        "not_recorded": {"fr": "non renseigné", "ar": "غير مسجل"},
        "performant": {"fr": "performant", "ar": "فعّال"},
        "moyennement_performant": {"fr": "moyennement performant", "ar": "فعّال جزئياً"},
        "non_performant": {"fr": "non performant", "ar": "غير فعّال"},
    },
    "source": {
        "a feed": {"fr": "un flux", "ar": "أحد المصادر"},
    },
    "link": {
        "share link": {"fr": "lien de partage", "ar": "رابط المشاركة"},
    },
}


def _vocab(name: str, value, lang: str):
    table = PARAM_VOCAB.get(name)
    if not table or not isinstance(value, str):
        return value
    norm = value.strip().lower()
    entry = table.get(norm) or table.get(norm.replace(" ", "_"))
    return (entry or {}).get(lang, value)


def days_phrase(days, lang: str) -> str:
    """"3 jours" / "3 أيام" — Arabic counts need the dual and the 3–10 plural."""
    try:
        n = int(float(str(days)))
    except (TypeError, ValueError):
        return str(days)
    if lang == "fr":
        return f"{n} jour" if abs(n) <= 1 else f"{n} jours"
    if lang == "ar":
        m = abs(n)
        if m == 1:
            return "يوم واحد"
        if m == 2:
            return "يومين"
        if 3 <= m <= 10:
            return f"{n} أيام"
        return f"{n} يوماً"
    return f"{n} day(s)"


def _derived_params(params: dict, lang: str) -> dict:
    """Params the fr/ar templates need beyond what the writer stored."""
    out = dict(params)
    for name, value in list(out.items()):
        out[name] = _vocab(name, value, lang)
        if value is None:
            out[name] = "—"
    if "days" in params:
        out["ndays"] = days_phrase(params["days"], lang)
    ip = params.get("ip")
    if lang == "fr":
        out["ip_where"] = f" depuis l'adresse IP {ip}" if ip else ""
    elif lang == "ar":
        out["ip_where"] = f" من عنوان IP {ip}" if ip else ""
    else:
        out["ip_where"] = f" from IP {ip}" if ip else ""
    cid, ctitle = params.get("control_id"), params.get("control_title")
    if cid:
        tail = f"{cid} — {ctitle}" if ctitle else str(cid)
        out["ctrl_paren"] = f" ({tail})"
        out["ctrl_for"] = {"fr": f" pour {tail}", "ar": f" لـ {tail}"}.get(lang, f" for {tail}")
    else:
        out["ctrl_paren"] = ""
        out["ctrl_for"] = ""
    return out


def _format(template: str, params: dict, lang: str) -> str:
    return template.format(**_derived_params(params, lang))


# ── Legacy matching: English template → regex ────────────────────────────────
_FORMATTER = string.Formatter()


def _template_regex(template: str) -> tuple[re.Pattern, int] | None:
    parts: list[str] = []
    seen: set[str] = set()
    literal_len = 0
    for literal, field, _spec, _conv in _FORMATTER.parse(template):
        if literal:
            parts.append(re.escape(literal))
            literal_len += len(literal.strip())
        if field is None:
            continue
        if not field.isidentifier():
            return None
        if field in seen:
            parts.append(f"(?P={field})")
        else:
            seen.add(field)
            parts.append(f"(?P<{field}>.+?)")
    if literal_len < 6:
        # "{description}" matches anything; it can only be rendered from a key.
        return None
    return re.compile("^" + "".join(parts) + "$", re.DOTALL), literal_len


@lru_cache(maxsize=1)
def _legacy_patterns() -> dict[str, list[tuple[re.Pattern, str]]]:
    """{"title": [(regex, key), ...], "message": [...]}, most specific first."""
    buckets: dict[str, list[tuple[int, re.Pattern, str]]] = {"title": [], "message": []}
    for key, entry in CATALOG.items():
        slot = "title" if key.endswith(".title") else "message" if key.endswith(".message") else None
        if slot is None:
            continue
        for tpl in (entry.get("en"), *entry.get("en_alt", ())):
            if not tpl:
                continue
            built = _template_regex(tpl)
            if built:
                buckets[slot].append((built[1], built[0], key))
    return {
        slot: [(rx, key) for _n, rx, key in sorted(items, key=lambda t: -t[0])]
        for slot, items in buckets.items()
    }


def match_legacy(text: str | None, slot: str) -> tuple[str, dict] | None:
    """(key, params) recovered from a stored English title/message, or None."""
    if not text:
        return None
    for rx, key in _legacy_patterns().get(slot, []):
        m = rx.match(text)
        if m:
            return key, m.groupdict()
    return None


# ── Public API ───────────────────────────────────────────────────────────────

def render_key(key: str | None, lang: str, params: dict | None, fallback: str) -> str:
    """Render one catalog key in `lang`; `fallback` on any gap. Never raises."""
    entry = CATALOG.get(key or "")
    if not entry:
        return fallback
    template = entry.get(lang) or entry.get("en")
    if not template:
        return fallback
    try:
        return _format(template, params or {}, lang)
    except (KeyError, IndexError, ValueError, TypeError, AttributeError):
        return fallback


def localize_text(stored: str | None, slot: str, lang: str,
                  key: str | None = None, params: dict | None = None) -> str:
    """One notification field in `lang`.

    English returns the stored text untouched. Otherwise: the key (when known
    and its params suffice), else the stored English matched back to its
    template, else the stored text.
    """
    stored = stored or ""
    if lang not in LANGS or lang == "en":
        return stored
    if key and key in CATALOG:
        rendered = render_key(key, lang, params, "")
        if rendered:
            return rendered
    hit = match_legacy(stored, slot)
    if hit:
        legacy_key, legacy_params = hit
        # Stored params (typed, untruncated) win over the regex's strings.
        merged = {**legacy_params, **(params or {})} if legacy_key == key else legacy_params
        rendered = render_key(legacy_key, lang, merged, "")
        if rendered:
            return rendered
    return stored


def localize_notification(notif, lang: str) -> tuple[str, str]:
    """(title, message) of a Notification row (or any object with the same fields) in `lang`."""
    params = getattr(notif, "params", None) or {}
    title = localize_text(getattr(notif, "title", ""), "title", lang,
                          getattr(notif, "title_key", None), params)
    message = localize_text(getattr(notif, "message", ""), "message", lang,
                            getattr(notif, "message_key", None), params)
    return title, message


def render_pair(key_base: str, lang: str, params: dict, title_fallback: str,
                message_fallback: str) -> tuple[str, str]:
    """(title, message) for `<key_base>.title` / `.message` — for e-mail writers."""
    if lang == "en":
        return title_fallback, message_fallback
    return (render_key(f"{key_base}.title", lang, params, title_fallback),
            render_key(f"{key_base}.message", lang, params, message_fallback))
