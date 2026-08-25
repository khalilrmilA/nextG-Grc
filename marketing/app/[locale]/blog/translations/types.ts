export interface LocalizedPostFields {
  title: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  excerpt: string;
  /** Same markdown structure as the English body (##, ###, lists, **bold**, [link](url)) — text translated, structure and links preserved. */
  body: string;
  faqs: Array<{ q: string; a: string }>;
}

export interface PostTranslations {
  fr: LocalizedPostFields;
  ar: LocalizedPostFields;
}
