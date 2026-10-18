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
        "review_published_only": "Periodic review starts once the policy is published."
      }
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
        "review_published_only": "La revue périodique commence une fois la politique publiée."
      }
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
        "review_published_only": "تبدأ المراجعة الدورية بمجرد نشر السياسة."
      }
    }
  },
};

export default bundle;
