/**
 * UI strings for the R2 lifecycle work (2026-10-18): edit / close / reopen / retire
 * flows across risks, scenarios, acceptances, vendors, policies, controls and
 * evidence. Generated from one en/fr/ar table so the three languages cannot drift;
 * everything lives under `r2` so it never collides with an existing key.
 * Merged non-destructively in i18n/index.ts.
 */
const bundle: { en: Record<string, any>; fr: Record<string, any>; ar: Record<string, any> } = {
  en: {
    "r2": {
      "common": {
        "none": "— None —",
        "edit": "Edit",
        "delete": "Delete",
        "save_changes": "Save changes",
        "tab_details": "Details",
        "tab_history": "History",
        "reason": "Reason",
        "system": "System",
        "actions": "Actions"
      },
      "scenarios": {
        "edit_title": "Edit risk scenario",
        "error_update_failed": "The scenario could not be saved. Nothing was changed.",
        "error_delete_failed": "The scenario could not be deleted. Nothing was changed.",
        "delete_confirm_title": "Delete this risk scenario?",
        "delete_confirm_body": "“{{name}}” and its version history will be deleted; its final state is kept in the activity log. The linked risk-register entry is kept and can then be closed or deleted on its own."
      },
      "acceptances": {
        "covers": "Covers",
        "risks_label": "Risks accepted",
        "scenarios_label": "Risk scenarios accepted",
        "picker_hint": "On approval each covered risk (and each scenario’s register entry) moves to “Accepted”; it returns to its previous status if the acceptance is revoked or expires.",
        "revoke": "Revoke",
        "awaiting_other_approver": "Awaiting another approver",
        "reject_title": "Reject this risk acceptance?",
        "reject_body": "“{{name}}” will be refused. The covered risks are not changed.",
        "revoke_title": "Revoke this risk acceptance?",
        "revoke_body": "“{{name}}” stops covering its risks now. Each risk returns to the status it had before the acceptance, unless another active acceptance still covers it.",
        "error_reason_required": "A reason is required."
      },
      "treatment": {
        "justification": "Justification",
        "error_justification": "A justification is required for every treatment decision"
      },
      "risks": {
        "edit_title": "Edit risk",
        "owner_unavailable": "Only an administrator can list users; the current owner is kept.",
        "residual_likelihood": "Residual likelihood",
        "residual_impact": "Residual impact",
        "linked_controls_label": "Linked controls (comma-separated IDs)",
        "reopen_reason": "Reason for reopening",
        "reopen_hint": "This risk is closed. Explain why it is being reopened — the reason is kept in its history.",
        "error_reopen_required": "A reason is required to reopen a closed risk.",
        "reopened_because": "Reopened because",
        "delete_confirm_title": "Delete this risk?",
        "delete_confirm_body": "“{{title}}” will be removed from the register. This cannot be undone; the deletion is recorded in the activity log.",
        "delete_blocked": "A closed or accepted risk records a decision and cannot be deleted. Reopen it first if it was created in error.",
        "error_delete_failed": "The risk could not be deleted. Nothing was changed.",
        "history_empty": "No change recorded yet.",
        "history_failed": "The history could not be loaded.",
        "show_changes": "Show changes",
        "hide_changes": "Hide changes",
        "no_field_changes": "No tracked field changed in this edit."
      }
    }
  },
  fr: {
    "r2": {
      "common": {
        "none": "— Aucun —",
        "edit": "Modifier",
        "delete": "Supprimer",
        "save_changes": "Enregistrer les modifications",
        "tab_details": "Détails",
        "tab_history": "Historique",
        "reason": "Motif",
        "system": "Système",
        "actions": "Actions"
      },
      "scenarios": {
        "edit_title": "Modifier le scénario de risque",
        "error_update_failed": "Le scénario n’a pas pu être enregistré. Rien n’a été modifié.",
        "error_delete_failed": "Le scénario n’a pas pu être supprimé. Rien n’a été modifié.",
        "delete_confirm_title": "Supprimer ce scénario de risque ?",
        "delete_confirm_body": "« {{name}} » et son historique de versions seront supprimés ; son état final est conservé dans le journal d’activité. L’entrée liée du registre des risques est conservée et pourra ensuite être fermée ou supprimée séparément."
      },
      "acceptances": {
        "covers": "Couvre",
        "risks_label": "Risques acceptés",
        "scenarios_label": "Scénarios de risque acceptés",
        "picker_hint": "À l’approbation, chaque risque couvert (et l’entrée de registre de chaque scénario) passe à « Accepté » ; il retrouve son statut précédent si l’acceptation est révoquée ou expire.",
        "revoke": "Révoquer",
        "awaiting_other_approver": "En attente d’un autre approbateur",
        "reject_title": "Rejeter cette acceptation de risque ?",
        "reject_body": "« {{name}} » sera refusée. Les risques couverts ne sont pas modifiés.",
        "revoke_title": "Révoquer cette acceptation de risque ?",
        "revoke_body": "« {{name}} » cesse dès maintenant de couvrir ses risques. Chaque risque retrouve le statut qu’il avait avant l’acceptation, sauf si une autre acceptation active le couvre encore.",
        "error_reason_required": "Un motif est requis."
      },
      "treatment": {
        "justification": "Justification",
        "error_justification": "Une justification est requise pour chaque décision de traitement"
      },
      "risks": {
        "edit_title": "Modifier le risque",
        "owner_unavailable": "Seul un administrateur peut lister les utilisateurs ; le propriétaire actuel est conservé.",
        "residual_likelihood": "Probabilité résiduelle",
        "residual_impact": "Impact résiduel",
        "linked_controls_label": "Contrôles liés (identifiants séparés par des virgules)",
        "reopen_reason": "Motif de réouverture",
        "reopen_hint": "Ce risque est fermé. Expliquez pourquoi il est rouvert — le motif est conservé dans son historique.",
        "error_reopen_required": "Un motif est requis pour rouvrir un risque fermé.",
        "reopened_because": "Rouvert pour le motif",
        "delete_confirm_title": "Supprimer ce risque ?",
        "delete_confirm_body": "« {{title}} » sera retiré du registre. Cette action est irréversible ; la suppression est consignée dans le journal d’activité.",
        "delete_blocked": "Un risque fermé ou accepté consigne une décision et ne peut pas être supprimé. Rouvrez-le d’abord s’il a été créé par erreur.",
        "error_delete_failed": "Le risque n’a pas pu être supprimé. Rien n’a été modifié.",
        "history_empty": "Aucune modification enregistrée pour l’instant.",
        "history_failed": "L’historique n’a pas pu être chargé.",
        "show_changes": "Voir les modifications",
        "hide_changes": "Masquer les modifications",
        "no_field_changes": "Aucun champ suivi n’a changé lors de cette modification."
      }
    }
  },
  ar: {
    "r2": {
      "common": {
        "none": "— لا شيء —",
        "edit": "تعديل",
        "delete": "حذف",
        "save_changes": "حفظ التغييرات",
        "tab_details": "التفاصيل",
        "tab_history": "السجل",
        "reason": "السبب",
        "system": "النظام",
        "actions": "الإجراءات"
      },
      "scenarios": {
        "edit_title": "تعديل سيناريو الخطر",
        "error_update_failed": "تعذّر حفظ السيناريو. لم يتم تغيير أي شيء.",
        "error_delete_failed": "تعذّر حذف السيناريو. لم يتم تغيير أي شيء.",
        "delete_confirm_title": "حذف سيناريو الخطر هذا؟",
        "delete_confirm_body": "سيتم حذف «{{name}}» وسجل إصداراته؛ وتُحفظ حالته النهائية في سجل النشاط. ويُحتفظ بالمدخل المرتبط في سجل المخاطر ويمكن بعد ذلك إغلاقه أو حذفه بشكل مستقل."
      },
      "acceptances": {
        "covers": "يشمل",
        "risks_label": "المخاطر المقبولة",
        "scenarios_label": "سيناريوهات المخاطر المقبولة",
        "picker_hint": "عند الموافقة، ينتقل كل خطر مشمول (ومدخل السجل لكل سيناريو) إلى «مقبول»؛ ويعود إلى حالته السابقة إذا أُلغي القبول أو انتهت صلاحيته.",
        "revoke": "إلغاء",
        "awaiting_other_approver": "بانتظار موافق آخر",
        "reject_title": "رفض قبول الخطر هذا؟",
        "reject_body": "سيتم رفض «{{name}}». لن تتغير المخاطر المشمولة.",
        "revoke_title": "إلغاء قبول الخطر هذا؟",
        "revoke_body": "يتوقف «{{name}}» عن شمول مخاطره الآن. يعود كل خطر إلى الحالة التي كان عليها قبل القبول، ما لم يشمله قبول نشط آخر.",
        "error_reason_required": "يلزم تقديم سبب."
      },
      "treatment": {
        "justification": "المبرر",
        "error_justification": "يلزم تقديم مبرر لكل قرار معالجة"
      },
      "risks": {
        "edit_title": "تعديل الخطر",
        "owner_unavailable": "يمكن للمسؤول فقط عرض قائمة المستخدمين؛ يتم الاحتفاظ بالمالك الحالي.",
        "residual_likelihood": "الاحتمالية المتبقية",
        "residual_impact": "الأثر المتبقي",
        "linked_controls_label": "الضوابط المرتبطة (معرّفات مفصولة بفواصل)",
        "reopen_reason": "سبب إعادة الفتح",
        "reopen_hint": "هذا الخطر مغلق. اشرح سبب إعادة فتحه — يُحفظ السبب في سجله.",
        "error_reopen_required": "يلزم تقديم سبب لإعادة فتح خطر مغلق.",
        "reopened_because": "أعيد فتحه بسبب",
        "delete_confirm_title": "حذف هذا الخطر؟",
        "delete_confirm_body": "ستتم إزالة «{{title}}» من السجل. لا يمكن التراجع عن ذلك؛ ويُسجَّل الحذف في سجل النشاط.",
        "delete_blocked": "الخطر المغلق أو المقبول يوثّق قراراً ولا يمكن حذفه. أعد فتحه أولاً إذا أُنشئ عن طريق الخطأ.",
        "error_delete_failed": "تعذّر حذف الخطر. لم يتم تغيير أي شيء.",
        "history_empty": "لم يُسجَّل أي تغيير بعد.",
        "history_failed": "تعذّر تحميل السجل.",
        "show_changes": "عرض التغييرات",
        "hide_changes": "إخفاء التغييرات",
        "no_field_changes": "لم يتغير أي حقل متتبَّع في هذا التعديل."
      }
    }
  },
};

export default bundle;
