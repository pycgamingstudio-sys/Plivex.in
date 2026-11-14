import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";

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
  { id: "invoices", label: "Invoices" },
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
  const [countryCode, setCountryCode] = useState("US");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState("overview");
  const [records, setRecords] = useState({});
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const country = COUNTRY_OPTIONS.find((item) => item.code === countryCode) || COUNTRY_OPTIONS[0];

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
    if (!data?.user?.workspace_id) {
      const provision = await supabase.functions.invoke("global-ensure-owner", { body: {} });
      if (provision.error) throw new Error(await errorMessage(provision.error, "Could not initialize your Global workspace."));
      ({ data, error: contextError } = await supabase.functions.invoke("global-auth-context", { body: {} }));
      if (contextError) throw new Error(await errorMessage(contextError, "Could not reload your Global account."));
    }
    if (!data?.user?.workspace_id) throw new Error("Your Global workspace membership could not be verified.");
    setAccount(data.user);
  }, []);

  const loadRecords = useCallback(async (activeTab = tab) => {
    if (!account?.workspace_id) return;
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
    if (!account?.workspace_id) return;
    loadRecords(tab).catch((loadError) => setError(loadError.message));
  }, [account?.workspace_id, tab, loadRecords]);

  const submitAuth = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "register") {
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
                <select className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
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

  return (
    <main className="min-h-screen bg-[#F8F7FC] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div><div className="text-xl font-black text-violet-700">Plivex <span className="text-slate-500">Global</span></div><div className="text-xs text-slate-500">{account.workspace_name} · {account.country_code} · {currency}</div></div>
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
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[["Clients", counts.clients], ["Products", counts.products], ["Expenses", counts.expenses], ["Invoices", counts.invoices], ["Stock items", counts.stock]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-bold">{value}</div></div>)}
            </div>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Global early-access workspace: client, product and expense records can be managed. Invoice creation, payment collection and stock movements are not enabled yet; existing invoice and stock records are view-only.</div>
          </>
        ) : (
          <section className="mt-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">{NAV.find((item) => item.id === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">{tab === "inventory" || tab === "invoices" ? "Read-only until audited transaction workflows are enabled." : "Records are scoped to your active Global workspace."}</p></div><button onClick={() => loadRecords(tab).catch((loadError) => setError(loadError.message))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Refresh</button></div>
            {["clients", "products", "expenses"].includes(tab) && (
              <form onSubmit={submitRecord} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                {tab === "clients" && <><input required placeholder="Client name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input type="email" placeholder="Email (optional)" className="rounded-lg border border-slate-300 p-3" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /><input placeholder="Phone (optional)" className="rounded-lg border border-slate-300 p-3" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></>}
                {tab === "products" && <><input required placeholder="Product name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="SKU (optional)" className="rounded-lg border border-slate-300 p-3" value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /><input required min="0" step="any" type="number" placeholder={`Sale price (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></>}
                {tab === "expenses" && <><input required placeholder="Expense category" className="rounded-lg border border-slate-300 p-3" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} /><input placeholder="Vendor (optional)" className="rounded-lg border border-slate-300 p-3" value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /><input required min="0.01" step="any" type="number" placeholder={`Amount (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /><input type="date" className="rounded-lg border border-slate-300 p-3" value={form.expenseDate || localDate()} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></>}
                <button disabled={busy} className="rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Add record"}</button>
              </form>
            )}
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {currentRecords.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No records yet.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{(tab === "clients" ? ["Name", "Email", "Phone"] : tab === "products" ? ["Product", "SKU", "Sale price"] : tab === "expenses" ? ["Category", "Vendor", "Amount", "Date"] : tab === "invoices" ? ["Invoice", "Status", "Total", "Date"] : ["Product ID", "Quantity", "Reorder level"]).map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
                  {currentRecords.map((record) => <tr key={record.id || record.product_id}>
                    {tab === "clients" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.email || "—"}</td><td className="px-4 py-3">{record.phone || "—"}</td></>}
                    {tab === "products" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.sku || "—"}</td><td className="px-4 py-3">{money(record.sale_price_minor, record.currency_code)}</td></>}
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
