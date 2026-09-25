export type KbSection = { heading: string; body?: string; steps?: string[]; tips?: string[] };

export type KbArticle = {
  id: string;         // route segment, e.g. "assets" — also the page slug: /docs/<id>
  route: string;      // the page the article documents
  group: string;      // navgroup id from Layout.tsx, or "start" / "account"
  title: string;
  summary: string;
  keywords: string[];
  sections: KbSection[];
};
