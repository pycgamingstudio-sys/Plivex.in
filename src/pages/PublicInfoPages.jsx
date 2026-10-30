import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Receipt, Users, Wallet, BarChart3, Package, ShieldCheck } from "lucide-react";
import Logo from "@/components/Logo";
import AboutSection from "@/components/landing/AboutSection";
import PricingSection from "@/components/landing/PricingSection";

function PublicShell({ title, subtitle, children }) {
  const location = useLocation();

  useEffect(() => {
    const canonicalUrl = `https://www.plivex.in${location.pathname.replace(/\/$/, "") || "/"}`;
    document.title = `${title} | Plivex`;

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", canonicalUrl);

    const setMeta = (selector, attribute, value) => {
      let element = document.querySelector(selector);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, selector.includes("property=") ? selector.match(/property="([^"]+)"/)[1] : selector.match(/name="([^"]+)"/)[1]);
        document.head.appendChild(element);
      }
      element.setAttribute("content", value);
    };
    setMeta('meta[property="og:url"]', "property", canonicalUrl);
    setMeta('meta[property="og:title"]', "property", `${title} | Plivex`);
    setMeta('meta[property="og:description"]', "property", subtitle);
    setMeta('meta[name="description"]', "name", subtitle);
  }, [location.pathname, title, subtitle]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5"><Logo className="h-9 w-9" rounded="rounded-xl" /><span><span className="block text-sm font-bold">Plivex</span><span className="block text-xs text-slate-500">Smart Invoicing &amp; Business OS</span></span></Link>
          <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-4" aria-label="Website navigation">
            <Link to="/" className="text-sm font-semibold text-slate-600 hover:text-violet-700">Home</Link>
            <Link to="/features" className="text-sm font-semibold text-slate-600 hover:text-violet-700">Features</Link>
            <Link to="/about" className="text-sm font-semibold text-slate-600 hover:text-violet-700">About</Link>
            <Link to="/pricing" className="text-sm font-semibold text-slate-600 hover:text-violet-700">Pricing</Link>
            <Link to="/contact-us" className="hidden text-sm font-semibold text-slate-600 hover:text-violet-700 sm:inline">Contact</Link>
            <Link to="/register" className="rounded-xl bg-[#6D28D9] px-3 py-2 text-xs font-bold text-white sm:text-sm">Get started</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <Link to="/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-violet-700"><ArrowLeft className="h-4 w-4" />Back to home</Link>
        <div className="mb-6 rounded-3xl bg-gradient-to-br from-violet-800 to-violet-600 p-6 text-white sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">PLIVEX · {title}</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85 sm:text-base">{subtitle}</p>
        </div>
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm">
          <p className="text-slate-600">© {new Date().getFullYear()} Plivex · <a href="mailto:support@plivex.in" className="font-semibold text-violet-700">support@plivex.in</a></p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Policies">
            <Link to="/privacy-policy" className="text-slate-600 underline underline-offset-4">Privacy</Link>
            <Link to="/terms-and-conditions" className="text-slate-600 underline underline-offset-4">Terms</Link>
            <Link to="/refund-and-cancellation" className="text-slate-600 underline underline-offset-4">Refunds</Link>
            <Link to="/contact-us" className="text-slate-600 underline underline-offset-4">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { icon: Receipt, title: "Invoices & quotations", desc: "Create GST and non-GST invoices, prepare quotations, and download clean PDFs." },
  { icon: Users, title: "Clients & leads", desc: "Keep client records and follow leads from one workspace." },
  { icon: Wallet, title: "Expenses & payments", desc: "Record expenses and track payment status alongside billing." },
  { icon: Package, title: "Stock management", desc: "Maintain stock records and monitor low-stock items." },
  { icon: BarChart3, title: "Reports", desc: "Review sales, expenses and business summaries from a central place." },
  { icon: ShieldCheck, title: "Workspace & team roles", desc: "Use role-based access to organise team work and business data." },
];

export function AboutPage() {
  return <PublicShell title="About Plivex" subtitle="Meet the people and purpose behind Plivex, a billing and business management platform for Indian small businesses.">
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-col items-start gap-4 rounded-2xl bg-violet-50 p-5 sm:flex-row sm:items-center">
        <img src="/images/yashvant-sharma.webp" alt="Yashvant Sharma, Founder and Developer of Plivex" width="88" height="88" loading="eager" className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-sm sm:h-22 sm:w-22" />
        <div><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Founder</p><h2 className="mt-1 text-xl font-bold">Yashvant Sharma</h2><p className="mt-1 text-sm text-slate-600">Founder &amp; Developer of Plivex</p><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">Building practical business software to make everyday billing and business management simpler for small businesses.</p></div>
      </div>
      <AboutSection />
    </div>
  </PublicShell>;
}

export function FeaturesPage() {
  return <PublicShell title="Plivex features" subtitle="A clearer look at the business workflows available in one workspace. Feature availability can depend on your plan and current release.">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(({icon: Icon,title,desc}) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Icon className="h-5 w-5"/></span><h2 className="mt-4 text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{desc}</p></article>)}
    </div>
    <div className="mt-6 rounded-2xl bg-violet-50 p-5 sm:flex sm:items-center sm:justify-between"><div><h2 className="font-bold">Explore Plivex for your business</h2><p className="mt-1 text-sm text-slate-600">Free plan, no card needed. Explore the workspace at your own pace.</p></div><Link to="/register" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white sm:mt-0">Get started <ArrowRight className="h-4 w-4"/></Link></div>
  </PublicShell>;
}

export function PricingPage() {
  return <PublicShell title="Plans & pricing" subtitle="Compare the available plans before choosing the right fit. Review the checkout details before paying."><PricingSection /></PublicShell>;
}
