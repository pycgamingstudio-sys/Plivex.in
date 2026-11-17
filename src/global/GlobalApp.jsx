import { useCallback, useEffect, useState } from "react";
import { Users, Package, Receipt, FileText, Boxes, Handshake, Warehouse, ArrowLeftRight, ClipboardList, History, Calculator, ShieldCheck, ShoppingBasket } from "lucide-react";
import { supabase } from "@/api/backendClient";
import GlobalCountryOnboarding from "@/components/global/GlobalCountryOnboarding";
import GlobalInvoicesPanel from "@/components/global/GlobalInvoicesPanel";
import GlobalAccountingPanel from "@/components/global/GlobalAccountingPanel";
import GlobalEnterprisePanel from "@/components/global/GlobalEnterprisePanel";
import GlobalPart4Panel from "@/components/global/GlobalPart4Panel";

const COUNTRY_OPTIONS = [
  { code: "US", label: "United States", locale: "en-US", currency: "USD" },
  { code: "GB", label: "United Kingdom", locale: "en-GB", currency: "GBP" },
  { code: "CA", label: "Canada", locale: "en-CA", currency: "CAD" },
  { code: "AU", label: "Australia", locale: "en-AU", currency: "AUD" },
  { code: "AE", label: "United Arab Emirates", locale: "en-AE", currency: "AED" },
  { code: "SG", label: "Singapore", locale: "en-SG", currency: "SGD" },
  { code: "IN", label: "India", locale: "en-IN", currency: "INR" },
];
const NAV = [
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
  { id: "products", label: "Products" },
  { id: "expenses", label: "Expenses" },
  { id: "inventory", label: "Inventory" },
  { id: "crm", label: "CRM" },
  { id: "warehouses", label: "Warehouses" },
  { id: "transfers", label: "Stock transfers" },
  { id: "purchasing", label: "Purchasing" },
  { id: "movements", label: "Movement history" },
  { id: "invoices", label: "Invoices" },
  { id: "accounting", label: "Accounting" },
  { id: "enterprise", label: "Enterprise" },
];
const TABLES = { clients: "clients", products: "products", expenses: "expenses", inventory: "stock_levels", invoices: "invoices" };
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const currencyDigits = (currency) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const money = (minor, currency) => {
  const digits = currencyDigits(currency || "USD");
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(minor || 0) / (10 ** digits));
};
const errorMessage = async (error, fallback) => {
  try {
    const body = await error?.context?.clone?.().json();
    if (typeof body?.error === "string") return body.error;
  } catch { /* use SDK message */ }
  return error?.message || fallback;
};

export default function GlobalApp() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login");
  const [countryCode, setCountryCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState("overview");
  const [records, setRecords] = useState({});
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const country = COUNTRY_OPTIONS.find((item) => item.code === countryCode) || null;

  const invoke = useCallback(async (table, action = "list", values = undefined) => {
    if (!account?.workspace_id) throw new Error("Your Global workspace is not ready.");
    const body = { workspace_id: account.workspace_id, table, action, limit: 100 };
    if (values !== undefined) body.values = values;
    const { data, error: invokeError } = await supabase.functions.invoke("global-business-records", { body });
    if (invokeError) throw new Error(await errorMessage(invokeError, "Global request failed."));
    return data;
  }, [account?.workspace_id]);

  const loadContext = useCallback(async (activeSession) => {
    if (!activeSession) { setAccount(null); setRecords({}); return; }
    let { data, error: contextError } = await supabase.functions.invoke("global-auth-context", { body: {} });
    if (contextError) throw new Error(await errorMessage(contextError, "Could not load your Global account."));
    if (!data?.user?.id) throw new Error("Your Global account could not be verified.");
    setAccount(data.user);
  }, []);

  const loadRecords = useCallback(async (activeTab = tab) => {
    if (!account?.workspace_id || ["crm", "warehouses", "transfers", "purchasing", "movements"].includes(activeTab)) return;
    const tables = activeTab === "overview" ? ["clients", "products", "expenses", "invoices", "stock_levels"] : [TABLES[activeTab]];
    const results = await Promise.all(tables.map(async (table) => [table, await invoke(table)]));
    setRecords((current) => ({ ...current, ...Object.fromEntries(results.map(([table, result]) => [table, result.records || []])) }));
  }, [account?.workspace_id, invoke, tab]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      try { await loadContext(data.session); }
      catch (loadError) { if (active) setError(loadError.message); }
      finally { if (active) setLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (nextSession) {
        loadContext(nextSession).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false));
      } else {
        setAccount(null);
        setRecords({});
        setLoading(false);
      }
    });
    return () => { active = false; listener?.subscription?.unsubscribe(); };
  }, [loadContext]);

  useEffect(() => {
    if (!account?.workspace_id || tab === "accounting") return;
    loadRecords(tab).catch((loadError) => setError(loadError.message));
  }, [account?.workspace_id, tab, loadRecords]);

  const submitAuth = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "register") {
        if (!country) throw new Error("Choose your business country before creating your Global account.");
        const { error: signUpError, data } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { signup_country_code: country.code, signup_locale_code: country.locale },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) setNotice("Account created. Confirm your email, then sign in to open your Global workspace.");
        else await loadContext(data.session);
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
        await loadContext(data.session);
      }
    } catch (authError) { setError(authError.message || "Could not authenticate."); }
    finally { setBusy(false); }
  };

  const submitRecord = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      let values;
      if (tab === "clients") {
        values = { name: form.name?.trim(), email: form.email?.trim() || null, phone: form.phone?.trim() || null };
      } else if (tab === "products") {
        const digits = currencyDigits(account?.currency_code || country.currency);
        values = {
          name: form.name?.trim(),
          sku: form.sku?.trim() || null,
          barcode: form.barcode?.trim() || null,
          variant_of: form.variantOf || null,
          variant_label: form.variantLabel?.trim() || null,
          purchase_cost_minor: Math.round(Number(form.purchaseCost || 0) * (10 ** digits)),
          sale_price_minor: Math.round(Number(form.salePrice || 0) * (10 ** digits)),
          currency_code: account?.currency_code || country.currency,
        };
      } else if (tab === "expenses") {
        const currency = account?.currency_code || country.currency;
        values = {
          category: form.category?.trim(),
          vendor: form.vendor?.trim() || null,
          amount_minor: Math.round(Number(form.amount || 0) * (10 ** currencyDigits(currency))),
          currency_code: currency,
          expense_date: form.expenseDate || localDate(),
        };
      } else {
        throw new Error("This section is read-only.");
      }
      await invoke(TABLES[tab], "create", values);
      setForm({});
      setNotice("Saved to your Global workspace.");
      await loadRecords(tab);
    } catch (saveError) { setError(saveError.message || "Could not save this record."); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null); setAccount(null); setRecords({});
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#F8F7FC] text-slate-600">Loading Plivex Global…</div>;

  if (session && account && !account.workspace_id) return <GlobalCountryOnboarding />;

  if (!session || !account) {
    return (
      <main className="min-h-screen bg-[#F8F7FC] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md">
          <a href="/" className="text-2xl font-black tracking-tight text-violet-700">Plivex <span className="text-slate-500">Global</span></a>
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">{mode === "register" ? "Create your Global account" : "Welcome to Plivex Global"}</h1>
            <p className="mt-2 text-sm text-slate-500">International business workspace for clients, products and expenses.</p>
            <form className="mt-6 space-y-4" onSubmit={submitAuth}>
              {mode === "register" && <label className="block text-sm font-medium">Business country
                <select required className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                  <option value="">Select your business country</option>
                  {COUNTRY_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} · {item.currency}</option>)}
                </select>
              </label>}
              <label className="block text-sm font-medium">Email
                <input required type="email" autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="block text-sm font-medium">Password
                <input required minLength={8} type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {mode === "register" && <p className="text-xs text-slate-500">Your workspace country and currency are set at registration.</p>}
              <button disabled={busy} className="w-full rounded-lg bg-violet-700 p-3 font-semibold text-white disabled:opacity-60">{busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}</button>
            </form>
            <button className="mt-4 text-sm font-semibold text-violet-700" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); setNotice(""); }}>
              {mode === "register" ? "Already registered? Sign in" : "New to Plivex Global? Create account"}
            </button>
            {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </section>
          <p className="mt-6 text-center text-xs text-slate-500">Plivex Global · Separate from Plivex India</p>
        </div>
      </main>
    );
  }

  const currency = account.currency_code || country.currency;
  const currentTable = TABLES[tab];
  const currentRecords = records[currentTable] || [];
  const counts = { clients: records.clients?.length || 0, products: records.products?.length || 0, expenses: records.expenses?.length || 0, invoices: records.invoices?.length || 0, stock: records.stock_levels?.length || 0 };

  const metricCards = [
    { label: "Clients", value: counts.clients, tab: "clients", icon: Users, tone: "bg-blue-50 text-blue-700" },
    { label: "Products", value: counts.products, tab: "products", icon: Package, tone: "bg-violet-50 text-violet-700" },
    { label: "Expenses", value: counts.expenses, tab: "expenses", icon: Receipt, tone: "bg-emerald-50 text-emerald-700" },
    { label: "Invoices", value: counts.invoices, tab: "invoices", icon: FileText, tone: "bg-amber-50 text-amber-700" },
    { label: "Stock items", value: counts.stock, tab: "inventory", icon: Boxes, tone: "bg-rose-50 text-rose-700" },
  ];
  const actionCards = [
    { title: "CRM & Leads", description: "Manage prospects, follow-ups and customer relationships.", tab: "crm", icon: Handshake, tone: "from-fuchsia-50 to-pink-50" },
    { title: "Inventory & Procurement", description: "Connect products, purchase orders and incoming goods.", tab: "purchasing", icon: ShoppingBasket, tone: "from-indigo-50 to-blue-50" },
    { title: "Warehouses", description: "Manage locations and workspace stock levels.", tab: "warehouses", icon: Warehouse, tone: "from-teal-50 to-cyan-50" },
    { title: "Stock Transfers", description: "Move products between active warehouse locations.", tab: "transfers", icon: ArrowLeftRight, tone: "from-sky-50 to-blue-50" },
    { title: "Purchase Orders & Goods Receipts", description: "Create supplier orders and receive goods into stock.", tab: "purchasing", icon: ClipboardList, tone: "from-emerald-50 to-green-50" },
    { title: "Stock Movement History", description: "Review recorded receipts, transfers and adjustments.", tab: "movements", icon: History, tone: "from-amber-50 to-orange-50" },
    { title: "Accounting & Reports", description: "Open ledgers and financial statements for this workspace.", tab: "accounting", icon: Calculator, tone: "from-violet-50 to-purple-50" },
    { title: "Enterprise & Audit", description: "Review roles, audit history, exports and workspace controls.", tab: "enterprise", icon: ShieldCheck, tone: "from-slate-100 to-slate-50" },
  ];

  return (
    <main className="min-h-screen bg-[#F8F7FC] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div><div className="flex flex-wrap items-center gap-2"><div className="text-xl font-black text-violet-700">Plivex <span className="text-slate-500">Global</span></div><span title="Edition is based on your active workspace country" className="inline-flex items-center gap-1 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700"><span aria-hidden="true">{COUNTRY_OPTIONS.find((item) => item.code === account.country_code)?.code === "IN" ? "🇮🇳" : "🌍"}</span>Global Workspace</span></div><div className="text-xs text-slate-500">{account.workspace_name} · {account.country_code} · {currency}</div></div>
          <div className="flex items-center gap-3"><span className="hidden text-sm text-slate-500 sm:block">{account.email}</span><button onClick={signOut} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Sign out</button></div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <nav className="flex flex-wrap gap-2">
          {NAV.map((item) => <button key={item.id} onClick={() => { setTab(item.id); setError(""); setNotice(""); setForm({}); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === item.id ? "bg-violet-700 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{item.label}</button>)}
        </nav>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {tab === "overview" ? (
          <>
            <div className="mt-6"><h1 className="text-2xl font-bold">Business overview</h1><p className="mt-1 text-sm text-slate-500">Your Global workspace data, kept separate from India edition records.</p></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {metricCards.map((item) => <button key={item.tab} onClick={() => setTab(item.tab)} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></span><span className="mt-3 block text-sm font-semibold text-slate-500">{item.label}</span><span className="mt-1 block text-3xl font-bold tracking-tight text-slate-900">{item.value}</span><span className="mt-2 block text-xs font-semibold text-violet-700">Open section →</span></button>)}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Business workspace</h2><p className="mt-1 text-sm text-slate-500">Quick access to the tools that run your operations.</p></div><span className="hidden rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 sm:inline">8 work areas</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {actionCards.map((item) => <button key={item.title} onClick={() => setTab(item.tab)} className="group flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"><span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${item.tone} text-violet-700`}><item.icon className="h-7 w-7" strokeWidth={1.6} /></span><span className="mt-4 text-sm font-bold text-slate-900">{item.title}</span><span className="mt-1 flex-1 text-xs leading-relaxed text-slate-500">{item.description}</span><span className="mt-3 text-xs font-semibold text-violet-700">Open workspace →</span></button>)}
            </div>
          </>
        ) : tab === "invoices" ? (
          <GlobalInvoicesPanel account={account} invoke={invoke} onRefresh={loadRecords} />
        ) : tab === "accounting" ? (
          <GlobalAccountingPanel account={account} />
        ) : tab === "enterprise" ? (
          <GlobalEnterprisePanel workspaceId={account.workspace_id} />
        ) : ["crm", "warehouses", "transfers", "purchasing", "movements"].includes(tab) ? (
          <GlobalPart4Panel account={account} initialSection={tab} />
        ) : (
          <section className="mt-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">{NAV.find((item) => item.id === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">{tab === "inventory" || tab === "invoices" ? "Read-only until audited transaction workflows are enabled." : "Records are scoped to your active Global workspace."}</p></div><button onClick={() => loadRecords(tab).catch((loadError) => setError(loadError.message))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Refresh</button></div>
            {["clients", "products", "expenses"].includes(tab) && (
              <form onSubmit={submitRecord} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                {tab === "clients" && <><input required placeholder="Client name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input type="email" placeholder="Email (optional)" className="rounded-lg border border-slate-300 p-3" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /><input placeholder="Phone (optional)" className="rounded-lg border border-slate-300 p-3" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></>}
                {tab === "products" && <><input required placeholder="Product name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="SKU (optional)" className="rounded-lg border border-slate-300 p-3" value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /><input placeholder="Barcode (EAN / UPC)" className="rounded-lg border border-slate-300 p-3" value={form.barcode || ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /><select className="rounded-lg border border-slate-300 p-3" value={form.variantOf || ""} onChange={(e) => setForm({ ...form, variantOf: e.target.value })}><option value="">Base product</option>{(records.products || []).filter((p) => !p.variant_of).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input placeholder="Variant label (e.g. Red / Large)" className="rounded-lg border border-slate-300 p-3" value={form.variantLabel || ""} onChange={(e) => setForm({ ...form, variantLabel: e.target.value })} /><input min="0" step="any" type="number" placeholder={`Purchase cost (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.purchaseCost || ""} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} /><input required min="0" step="any" type="number" placeholder={`Sale price (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></>}
                {tab === "expenses" && <><input required placeholder="Expense category" className="rounded-lg border border-slate-300 p-3" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} /><input placeholder="Vendor (optional)" className="rounded-lg border border-slate-300 p-3" value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /><input required min="0.01" step="any" type="number" placeholder={`Amount (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /><input type="date" className="rounded-lg border border-slate-300 p-3" value={form.expenseDate || localDate()} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></>}
                <button disabled={busy} className="rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Add record"}</button>
              </form>
            )}
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {currentRecords.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No records yet.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{(tab === "clients" ? ["Name", "Email", "Phone"] : tab === "products" ? ["Product", "SKU", "Barcode", "Variant", "Purchase cost", "Sale price"] : tab === "expenses" ? ["Category", "Vendor", "Amount", "Date"] : tab === "invoices" ? ["Invoice", "Status", "Total", "Date"] : ["Product ID", "Quantity", "Reorder level"]).map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
                  {currentRecords.map((record) => <tr key={record.id || record.product_id}>
                    {tab === "clients" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.email || "—"}</td><td className="px-4 py-3">{record.phone || "—"}</td></>}
                    {tab === "products" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.sku || "—"}</td><td className="px-4 py-3">{record.barcode || "—"}</td><td className="px-4 py-3">{record.variant_label || (record.variant_of ? "Variant" : "Base product")}</td><td className="px-4 py-3">{money(record.purchase_cost_minor, record.currency_code)}</td><td className="px-4 py-3">{money(record.sale_price_minor, record.currency_code)}</td></>}
                    {tab === "expenses" && <><td className="px-4 py-3 font-medium">{record.category}</td><td className="px-4 py-3">{record.vendor || "—"}</td><td className="px-4 py-3">{money(record.amount_minor, record.currency_code)}</td><td className="px-4 py-3">{record.expense_date}</td></>}
                    {tab === "invoices" && <><td className="px-4 py-3 font-medium">{record.invoice_number}</td><td className="px-4 py-3">{record.status}</td><td className="px-4 py-3">{money(record.total_minor, record.currency_code)}</td><td className="px-4 py-3">{record.issue_date}</td></>}
                    {tab === "inventory" && <><td className="px-4 py-3 font-medium">{record.product_id}</td><td className="px-4 py-3">{record.quantity}</td><td className="px-4 py-3">{record.reorder_level}</td></>}
                  </tr>)}
                </tbody></table></div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
