import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="bg-slate-950 text-slate-400 py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-2">
            <img src="/logo-horizontal.png" alt="GRCEye" className="h-12 w-auto object-contain bg-white/95 rounded-xl px-3 py-1.5 mb-4" />
            <p className="text-sm text-slate-500 leading-relaxed max-w-sm">
              Enterprise GRC platform for security teams. Risk management, compliance tracking, audit workflows, and AI-powered document generation, all in one place.
            </p>
            <div className="flex gap-3 mt-5">
              {[
                { label: "ISO 27001",     color: "bg-blue-500/10 text-blue-400 border-blue-500/20"      },
                { label: "On-premise AI", color: "bg-green-500/10 text-green-400 border-green-500/20"   },
                { label: "Zero egress",   color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
              ].map(b => (
                <span key={b.label} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${b.color}`}>{b.label}</span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-4">Platform</p>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "Features",  to: "/features-landing" },
                { label: "Solutions", to: "/solutions"         },
                { label: "FAQ",       to: "/faq"               },
                { label: "Blog",      to: "/blog"              },
                { label: "News",      to: "/news"              },
              ].map(l => (
                <li key={l.label}>
                  <Link href={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-4">Company</p>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Contact</Link></li>
              <li><a href="mailto:support@grceye.com" className="hover:text-white transition-colors">Support</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <p>© {new Date().getFullYear()} GRCEye, Inc. All rights reserved.</p>
          <p>
            Powered by{" "}
            <a
              href="https://silentwolf.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-500 hover:text-slate-300 transition-colors"
            >
              SilentWolf
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
