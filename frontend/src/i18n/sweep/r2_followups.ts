/**
 * UI strings for the R2 follow-ups (Prompt 2, 2026-10-18): policy periodic review
 * and the other gaps closed after review and live testing. Generated from one
 * en/fr/ar table so the three languages cannot drift; everything lives under
 * `r2b`. Merged non-destructively in i18n/index.ts.
 */
const bundle: { en: Record<string, any>; fr: Record<string, any>; ar: Record<string, any> } = {
  en: {
    "r2b": {
      "policies": {
        "edit_details": "Edit details",
        "edit_title": "Edit policy details",
        "owner": "Owner",
        "next_review": "Next review",
        "next_review_hint": "Leave empty to have it set when the policy is published (today + review cycle). A date you enter is kept.",
        "error_save": "The policy could not be saved. Nothing was changed.",
        "review_due": "Review due",
        "mark_reviewed": "Mark as reviewed",
        "review_title": "Mark this policy as reviewed",
        "review_body": "Confirm the text is still fit for purpose. The next review moves to {{date}}.",
        "review_comment": "Review comment",
        "review_comment_placeholder": "What was checked and what was decided…",
        "comment_required": "A comment is required.",
        "last_reviewed": "Last reviewed on {{date}} by {{name}}",
        "never_reviewed": "Not reviewed yet",
        "review_history": "Review history",
        "review_moved": "Next review {{from}} → {{to}}",
        "attest_needs_approval": "Acknowledgements can be requested once the policy is approved or published and its current version has been approved by a second person.",
        "review_published_only": "Periodic review starts once the policy is published."
      },
      "acceptances": {
        "withdraw": "Withdraw",
        "withdraw_title": "Withdraw this request?",
        "withdraw_body": "“{{name}}” has not been approved, so no risk changes. The request and your reason stay in the register and the activity log."
      },
      "contracts": {
        "ready_to_send": "Ready to send",
        "awaiting_review": "Awaiting CISO review",
        "sent_on": "Sent to the vendor on {{date}}"
      },
      "vendors": {
        "ai_unavailable": "The AI service is unavailable right now. Retry, or continue without the AI score: your answers are saved and can be scored later from Reassess.",
        "retry": "Retry",
        "continue_without_ai": "Continue without AI score",
        "no_ai_notice": "No AI score: the questionnaire answers are kept unscored. Set the risk score yourself, and run Reassess when the AI is back.",
        "manual_score": "Risk score (1–40)",
        "partial_save": "The vendor was created but a later step failed ({{error}}). Save again to finish — it will not create a second vendor.",
        "contract_saved_expiry_failed": "The contract was uploaded, but the new expiry date was not saved ({{error}}). Click Upload again to save the date only."
      },
      "compliance": {
        "edit_validity": "Change the validity date"
      }
    },
    "vocab": {
      "withdrawn": "Withdrawn"
    }
  },
  fr: {
    "r2b": {
      "policies": {
        "edit_details": "Modifier les détails",
        "edit_title": "Modifier les détails de la politique",
        "owner": "Propriétaire",
        "next_review": "Prochaine revue",
        "next_review_hint": "Laissez vide pour qu’elle soit fixée à la publication (aujourd’hui + cycle de revue). Une date saisie est conservée.",
        "error_save": "La politique n’a pas pu être enregistrée. Rien n’a été modifié.",
        "review_due": "Revue à faire",
        "mark_reviewed": "Marquer comme revue",
        "review_title": "Marquer cette politique comme revue",
        "review_body": "Confirmez que le texte reste adapté. La prochaine revue passe au {{date}}.",
        "review_comment": "Commentaire de revue",
        "review_comment_placeholder": "Ce qui a été vérifié et ce qui a été décidé…",
        "comment_required": "Un commentaire est obligatoire.",
        "last_reviewed": "Dernière revue le {{date}} par {{name}}",
        "never_reviewed": "Pas encore revue",
        "review_history": "Historique des revues",
        "review_moved": "Prochaine revue {{from}} → {{to}}",
        "attest_needs_approval": "Les prises de connaissance peuvent être demandées une fois la politique approuvée ou publiée et sa version courante approuvée par une seconde personne.",
        "review_published_only": "La revue périodique commence une fois la politique publiée."
      },
      "acceptances": {
        "withdraw": "Retirer",
        "withdraw_title": "Retirer cette demande ?",
        "withdraw_body": "« {{name}} » n’a pas été approuvée : aucun risque ne change. La demande et votre motif restent dans le registre et le journal d’activité."
      },
      "contracts": {
        "ready_to_send": "Prêts à envoyer",
        "awaiting_review": "En attente de revue RSSI",
        "sent_on": "Envoyé au fournisseur le {{date}}"
      },
      "vendors": {
        "ai_unavailable": "Le service d’IA est indisponible pour le moment. Réessayez, ou continuez sans score IA : vos réponses sont enregistrées et pourront être évaluées plus tard via Réévaluer.",
        "retry": "Réessayer",
        "continue_without_ai": "Continuer sans score IA",
        "no_ai_notice": "Pas de score IA : les réponses au questionnaire sont conservées sans score. Fixez le score de risque vous-même et lancez Réévaluer quand l’IA sera disponible.",
        "manual_score": "Score de risque (1–40)",
        "partial_save": "Le fournisseur a été créé mais une étape suivante a échoué ({{error}}). Enregistrez à nouveau pour terminer — aucun second fournisseur ne sera créé.",
        "contract_saved_expiry_failed": "Le contrat a été téléversé, mais la nouvelle date d’échéance n’a pas été enregistrée ({{error}}). Cliquez à nouveau sur Téléverser pour enregistrer seulement la date."
      },
      "compliance": {
        "edit_validity": "Modifier la date de validité"
      }
    },
    "vocab": {
      "withdrawn": "Retirée"
    }
  },
  ar: {
    "r2b": {
      "policies": {
        "edit_details": "تعديل التفاصيل",
        "edit_title": "تعديل تفاصيل السياسة",
        "owner": "المالك",
        "next_review": "المراجعة القادمة",
        "next_review_hint": "اتركه فارغًا ليُحدَّد عند نشر السياسة (اليوم + دورة المراجعة). يُحتفظ بالتاريخ الذي تُدخله.",
        "error_save": "تعذّر حفظ السياسة. لم يتم تغيير أي شيء.",
        "review_due": "المراجعة مستحقة",
        "mark_reviewed": "وضع علامة «تمت المراجعة»",
        "review_title": "وضع علامة «تمت المراجعة» على هذه السياسة",
        "review_body": "أكّد أن النص لا يزال ملائمًا. تنتقل المراجعة القادمة إلى {{date}}.",
        "review_comment": "تعليق المراجعة",
        "review_comment_placeholder": "ما الذي تم التحقق منه وما الذي تقرر…",
        "comment_required": "التعليق إلزامي.",
        "last_reviewed": "آخر مراجعة في {{date}} بواسطة {{name}}",
        "never_reviewed": "لم تتم مراجعتها بعد",
        "review_history": "سجل المراجعات",
        "review_moved": "المراجعة القادمة {{from}} ← {{to}}",
        "attest_needs_approval": "يمكن طلب الإقرارات بمجرد اعتماد السياسة أو نشرها واعتماد نسختها الحالية من قِبل شخص ثانٍ.",
        "review_published_only": "تبدأ المراجعة الدورية بمجرد نشر السياسة."
      },
      "acceptances": {
        "withdraw": "سحب",
        "withdraw_title": "سحب هذا الطلب؟",
        "withdraw_body": "لم تتم الموافقة على «{{name}}»، لذلك لا يتغير أي خطر. يبقى الطلب وسببك في السجل وفي سجل النشاط."
      },
      "contracts": {
        "ready_to_send": "جاهزة للإرسال",
        "awaiting_review": "بانتظار مراجعة مسؤول أمن المعلومات",
        "sent_on": "أُرسل إلى المورّد في {{date}}"
      },
      "vendors": {
        "ai_unavailable": "خدمة الذكاء الاصطناعي غير متاحة حاليًا. أعد المحاولة، أو تابع دون درجة الذكاء الاصطناعي: تُحفظ إجاباتك ويمكن تقييمها لاحقًا من «إعادة التقييم».",
        "retry": "إعادة المحاولة",
        "continue_without_ai": "المتابعة دون درجة الذكاء الاصطناعي",
        "no_ai_notice": "لا توجد درجة ذكاء اصطناعي: تُحفظ إجابات الاستبيان دون تقييم. حدّد درجة المخاطر بنفسك، وشغّل «إعادة التقييم» عند عودة الذكاء الاصطناعي.",
        "manual_score": "درجة المخاطر (1–40)",
        "partial_save": "تم إنشاء المورّد لكن خطوة لاحقة فشلت ({{error}}). احفظ مرة أخرى للإكمال — لن يتم إنشاء مورّد ثانٍ.",
        "contract_saved_expiry_failed": "تم رفع العقد، لكن تاريخ الانتهاء الجديد لم يُحفظ ({{error}}). انقر على «رفع» مرة أخرى لحفظ التاريخ فقط."
      },
      "compliance": {
        "edit_validity": "تعديل تاريخ الصلاحية"
      }
    },
    "vocab": {
      "withdrawn": "مسحوب"
    }
  },
};

export default bundle;
