import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";

/**
 * Shell for the company/legal pages (about, privacy, terms, security).
 *
 * Deliberately a server component with static children: the whole point of
 * these pages is that their text is in the server-rendered HTML, both because
 * crawlers read it directly and because "does this company publish a real
 * privacy policy" is a trust signal that only counts if it is actually there.
 */
export default function LegalPage({
  title,
  subtitle,
  updated,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly updated?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#E8F3FC] text-gray-900">
      <PublicNav />
      <section className="px-4 sm:px-6 pt-14 pb-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 text-lg text-gray-600 leading-relaxed">{subtitle}</p>
          )}
          {updated && (
            <p className="mt-3 text-sm text-gray-400">Last updated: {updated}</p>
          )}
        </div>
      </section>
      <section className="px-4 sm:px-6 pb-20">
        <div
          className="max-w-3xl mx-auto bg-white rounded-2xl border border-sky-100 shadow-sm p-6 sm:p-10
                     [&_h2]:text-xl [&_h2]:sm:text-2xl [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:first:mt-0
                     [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:mt-6 [&_h3]:mb-2
                     [&_p]:text-[15px] [&_p]:text-gray-600 [&_p]:leading-relaxed [&_p]:mb-4
                     [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:mb-4 [&_ul]:space-y-1.5
                     [&_li]:text-[15px] [&_li]:text-gray-600 [&_li]:leading-relaxed
                     [&_a]:text-blue-600 [&_a]:font-medium hover:[&_a]:underline
                     [&_strong]:text-gray-900 [&_strong]:font-semibold"
        >
          {children}
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
