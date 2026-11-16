import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";
import GlobalCountryOnboarding from "@/components/global/GlobalCountryOnboarding";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import GlobalEnterprisePanel from "@/components/global/GlobalEnterprisePanel";

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
  { id: "products", label: "Products" },
  { id: "expenses", label: "Expenses" },
  { id: "inventory", label: "Inventory" },
  { id: "invoices", label: "Invoices" },
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tab, setTab] = useState("overview");
  const [records, setRecords] = useState({});
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [movementRequest, setMovementRequest] = useState(null);
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [draftRequest, setDraftRequest] = useState(null);
  const [expenseRequest, setExpenseRequest] = useState(null);
  const [error, setError] = useState("");


  const invoke = useCallback(async (table, action = "list", values = undefined) => {
    if (!account?.workspace_id) throw new Error("Your workspace is not ready.");
    const body = { workspace_id: account.workspace_id, table, action, limit: 100 };
    if (values !== undefined) body.values = values;
    const { data, error: invokeError } = await supabase.functions.invoke("global-business-records", { body });
    if (invokeError) throw new Error(await errorMessage(invokeError, "Global request failed."));
    return data;
  }, [account?.workspace_id]);

  const loadContext = useCallback(async (activeSession) => {
    if (!activeSession) { setAccount(null); setRecords({}); return; }
    let { data, error: contextError } = await supabase.functions.invoke("global-auth-context", { body: {} });
    if (contextError) throw new Error(await errorMessage(contextError, "Could not load your account."));
    if (!data?.user?.id) throw new Error("Your account could not be verified.");
    setAccount(data.user);
  }, []);

  const loadRecords = useCallback(async (activeTab = tab) => {
    if (!account?.workspace_id) return;
    const tables = activeTab === "overview" ? ["clients", "products", "expenses", "invoices", "stock_levels"] : activeTab === "invoices" ? ["invoices", "clients", "products"] : [TABLES[activeTab]];
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset");
        setPassword("");
        setConfirmPassword("");
        setError("");
        setNotice("");
      }
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
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/global/reset-password`,
        });
        if (resetError) throw resetError;
        setMode("login");
        setNotice("If an account exists for this email, a password reset link has been sent.");
      } else if (mode === "reset") {
        if (password.length < 8) throw new Error("Use at least 8 characters for your new password.");
        if (password !== confirmPassword) throw new Error("The passwords do not match.");
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setPassword("");
        setConfirmPassword("");
        setMode("login");
        setNotice("Your password has been updated successfully.");
      } else if (mode === "register") {
        const { error: signUpError, data } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/global/`,
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
        const digits = currencyDigits(account?.currency_code || "USD");
        values = {
          name: form.name?.trim(),
          sku: form.sku?.trim() || null,
          sale_price_minor: Math.round(Number(form.salePrice || 0) * (10 ** digits)),
          currency_code: account?.currency_code || "USD",
        };
      } else if (tab === "expenses") {
        const currency = account?.currency_code || "USD";
        values = {
          category: form.category?.trim(),
          vendor: form.vendor?.trim() || null,
          transaction_amount_minor: Math.round(Number(form.amount || 0) * (10 ** currencyDigits(form.expenseCurrency || currency))),
          transaction_currency_code: form.expenseCurrency || currency,
          expense_date: form.expenseDate || localDate(),
          fx_rate_numerator: form.expenseCurrency && form.expenseCurrency !== currency ? String(form.fxRateNumerator || "") : null,
          fx_rate_denominator: form.expenseCurrency && form.expenseCurrency !== currency ? String(form.fxRateDenominator || "") : null,
          fx_source_url: form.expenseCurrency && form.expenseCurrency !== currency ? form.fxSourceUrl?.trim() : null,
          fx_provider: form.expenseCurrency && form.expenseCurrency !== currency ? form.fxProvider?.trim() : null,
          fx_effective_at: form.expenseCurrency && form.expenseCurrency !== currency
            ? new Date(form.fxEffectiveAt || `${form.expenseDate || localDate()}T00:00`).toISOString()
            : null,
        };
      } else {
        throw new Error("This section is read-only.");
      }
      if (tab === "expenses") {
        const signature = JSON.stringify(values);
        const requestId = expenseRequest?.signature === signature ? expenseRequest.id : crypto.randomUUID();
        setExpenseRequest({ signature, id: requestId });
        const { data, error: expenseError } = await supabase.functions.invoke("global-business-records", {
          body: { workspace_id: account.workspace_id, table: "expenses", action: "create", values, idempotency_key: requestId },
        });
        if (expenseError) throw new Error(await errorMessage(expenseError, "Could not save the expense."));
        if (!data?.ok || !data.record) throw new Error("Expense service returned an invalid response.");
        setExpenseRequest(null);
        setForm({});
        const original = data.record.transaction_currency_code === data.record.currency_code
          ? money(data.record.amount_minor, data.record.currency_code)
          : `${money(data.record.transaction_amount_minor, data.record.transaction_currency_code)} converted to ${money(data.record.amount_minor, data.record.currency_code)}`;
        setNotice(data.duplicate ? "This expense was already recorded. " + original : "Expense saved. " + original);
      } else {
        await invoke(TABLES[tab], "create", values);
        setForm({});
        setNotice("Saved to your workspace.");
      }
      await loadRecords(tab);
    } catch (saveError) { setError(saveError.message || "Could not save this record."); }
    finally { setBusy(false); }
  };

  const submitStockMovement = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const quantity = Number(form.quantity);
      if (!form.productId) throw new Error("Choose a product.");
      if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Enter a non-zero quantity.");
      const movementType = form.movementType || "receipt";
      const quantityDelta = movementType === "sale" ? -Math.abs(quantity)
        : movementType === "adjustment" ? quantity : Math.abs(quantity);
      const movementPayload = {
        workspace_id: account.workspace_id,
        product_id: form.productId,
        movement_type: movementType,
        quantity_delta: quantityDelta,
        notes: form.notes?.trim() || null,
      };
      const signature = JSON.stringify(movementPayload);
      const requestId = movementRequest?.signature === signature ? movementRequest.id : crypto.randomUUID();
      setMovementRequest({ signature, id: requestId });
      const { data, error: movementError } = await supabase.functions.invoke("global-stock-movements", {
        body: { ...movementPayload, idempotency_key: requestId },
      });
      if (movementError) throw new Error(await errorMessage(movementError, "Could not record stock movement."));
      if (!data?.ok || typeof data.quantity !== "number") throw new Error("Inventory service returned an invalid response.");
      setForm({});
      setMovementRequest(null);
      setNotice(`Stock movement recorded. New balance: ${data.quantity}.`);
      await loadRecords("inventory");
    } catch (movementSaveError) {
      setError(movementSaveError.message || "Could not record stock movement.");
    } finally { setBusy(false); }
  };

  const submitInvoiceDraft = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const digits = currencyDigits(account?.currency_code || "USD");
      const quantity = Number(form.invoiceQuantity || 1);
      const unitPriceMinor = Math.round(Number(form.invoiceUnitPrice || 0) * (10 ** digits));
      const discountMinor = Math.round(Number(form.invoiceDiscount || 0) * (10 ** digits));
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error("Enter a valid invoice quantity.");
      if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) throw new Error("Enter a valid unit price.");
      if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > Math.round(quantity * unitPriceMinor)) throw new Error("The line discount cannot exceed the line amount.");
      if (!String(form.invoiceDescription || "").trim()) throw new Error("Enter an item description.");
      const payload = {
        action: "create_draft",
        workspace_id: account.workspace_id,
        client_id: form.invoiceClientId || null,
        currency_code: account.currency_code,
        issue_date: form.invoiceIssueDate || localDate(),
        due_date: form.invoiceDueDate || null,
        notes: form.invoiceNotes?.trim() || null,
        items: [{
          product_id: form.invoiceProductId || null,
          description: form.invoiceDescription.trim(),
          quantity,
          unit_price_minor: unitPriceMinor,
          discount_minor: discountMinor,
        }],
      };
      const signature = JSON.stringify(payload);
      const requestId = draftRequest?.signature === signature ? draftRequest.id : crypto.randomUUID();
      setDraftRequest({ signature, id: requestId });
      const { data, error: invoiceError } = await supabase.functions.invoke("global-invoices", {
        body: { ...payload, idempotency_key: requestId },
      });
      if (invoiceError) throw new Error(await errorMessage(invoiceError, "Could not save the draft invoice."));
      if (!data?.ok || data.invoice?.status !== "draft") throw new Error("Invoice service returned an invalid draft response.");
      setForm({});
      setDraftRequest(null);
      setNotice("Draft saved. Tax has not been calculated; this draft cannot be issued as a tax invoice.");
      await loadRecords("invoices");
    } catch (saveError) { setError(saveError.message || "Could not save the draft invoice."); }
    finally { setBusy(false); }
  };

  const submitInvoicePayment = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const digits = currencyDigits(account?.currency_code || "USD");
      const amountMinor = Math.round(Number(form.paymentAmount || 0) * (10 ** digits));
      if (!form.paymentInvoiceId) throw new Error("Choose an issued invoice.");
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Enter a valid payment amount.");
      const payload = {
        action: "record_payment",
        workspace_id: account.workspace_id,
        invoice_id: form.paymentInvoiceId,
        amount_minor: amountMinor,
        currency_code: account.currency_code,
        payment_date: form.paymentDate || localDate(),
        method: form.paymentMethod?.trim() || null,
        reference: form.paymentReference?.trim() || null,
        notes: form.paymentNotes?.trim() || null,
      };
      const signature = JSON.stringify(payload);
      const requestId = paymentRequest?.signature === signature ? paymentRequest.id : crypto.randomUUID();
      setPaymentRequest({ signature, id: requestId });
      const { data, error: paymentError } = await supabase.functions.invoke("global-invoices", {
        body: { ...payload, idempotency_key: requestId },
      });
      if (paymentError) throw new Error(await errorMessage(paymentError, "Could not record the payment."));
      if (!data?.ok) throw new Error("Payment ledger returned an invalid response.");
      setForm((current) => ({ ...current, paymentAmount: "", paymentReference: "", paymentNotes: "" }));
      setPaymentRequest(null);
      setNotice(data.duplicate ? "This payment was already recorded; no duplicate was added." : "External payment recorded in the invoice ledger.");
      await loadRecords("invoices");
    } catch (saveError) { setError(saveError.message || "Could not record the payment."); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null); setAccount(null); setRecords({});
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#F8F7FC] text-slate-600">Loading Plivex…</div>;

  if (mode === "reset") {
    return (
      <main className="min-h-screen bg-[#F8F7FC] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md">
          <a href="/global/" className="text-2xl font-black tracking-tight text-violet-700">Plivex <span className="text-slate-500">Global</span></a>
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">Set a new password</h1>
            <p className="mt-2 text-sm text-slate-500">Choose a new password for your Plivex account.</p>
            <form className="mt-6 space-y-4" onSubmit={submitAuth}>
              <label className="block text-sm font-medium">New password
                <input required minLength={8} type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label className="block text-sm font-medium">Confirm new password
                <input required minLength={8} type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
              <button disabled={busy} className="w-full rounded-lg bg-violet-700 p-3 font-semibold text-white disabled:opacity-60">{busy ? "Please wait…" : "Update password"}</button>
            </form>
            {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </section>
        </div>
      </main>
    );
  }

  if (session && account && !account.workspace_id) return <GlobalCountryOnboarding />;

  if (!session || !account) {
    return (
      <main className="min-h-screen bg-[#F8F7FC] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md">
          <a href="/global/" className="text-2xl font-black tracking-tight text-violet-700">Plivex <span className="text-slate-500">Global</span></a>
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">{mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Welcome to Plivex"}</h1>
            <p className="mt-2 text-sm text-slate-500">International business workspace for clients, products and expenses.</p>
            <div className="mt-6">
              <GoogleSignInButton onError={setError} disabled={busy} />
              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                <span>or continue with email</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>
            <form className="space-y-4" onSubmit={submitAuth}>
              <label className="block text-sm font-medium">Email
                <input required type="email" autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              {mode !== "forgot" && <label className="block text-sm font-medium">Password
                <input required minLength={8} type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>}
              <button disabled={busy} className="w-full rounded-lg bg-violet-700 p-3 font-semibold text-white disabled:opacity-60">{busy ? "Please wait…" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
            </form>
            {mode === "login" && <button type="button" className="mt-4 block text-sm font-semibold text-violet-700" onClick={() => { setMode("forgot"); setPassword(""); setError(""); setNotice(""); }}>Forgot password?</button>}
            <button type="button" className="mt-4 text-sm font-semibold text-violet-700" onClick={() => { setMode(mode === "register" ? "login" : "register"); setPassword(""); setError(""); setNotice(""); }}>
              {mode === "register" ? "Already registered? Sign in" : mode === "forgot" ? "Back to sign in" : "New to Plivex? Create account"}
            </button>
            {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </section>
          <p className="mt-6 text-center text-xs text-slate-500">Plivex · Your business country and language are selected after sign-in.</p>
        </div>
      </main>
    );
  }

  const currency = account.currency_code || "USD";
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
        {tab === "enterprise" ? <GlobalEnterprisePanel workspaceId={account.workspace_id} /> : tab === "overview" ? (
          <>
            <div className="mt-6"><h1 className="text-2xl font-bold">Business overview</h1><p className="mt-1 text-sm text-slate-500">Your business workspace data.</p></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[["Clients", counts.clients], ["Products", counts.products], ["Expenses", counts.expenses], ["Invoices", counts.invoices], ["Stock items", counts.stock]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-bold">{value}</div></div>)}
            </div>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Client, product, expense and inventory records can be managed. Invoice drafts can be saved, but tax finalization and online payment collection are not enabled. External payments can be recorded only against issued invoices.</div>
          </>
        ) : (
          <section className="mt-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">{NAV.find((item) => item.id === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">{tab === "invoices" ? "Save draft invoices and record external payments for issued invoices." : tab === "inventory" ? "Record stock receipts, sales, returns and adjustments for active products." : "Records are scoped to your active workspace."}</p></div><button onClick={() => loadRecords(tab).catch((loadError) => setError(loadError.message))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Refresh</button></div>
            {tab === "inventory" && (
              <form onSubmit={submitStockMovement} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
                <select required aria-label="Product" className="rounded-lg border border-slate-300 p-3" value={form.productId || ""} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Choose product</option>
                  {(records.products || []).filter((product) => product.is_active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <select aria-label="Movement type" className="rounded-lg border border-slate-300 p-3" value={form.movementType || "receipt"} onChange={(e) => setForm({ ...form, movementType: e.target.value })}>
                  <option value="opening">Opening balance</option><option value="receipt">Stock receipt</option><option value="sale">Sale</option><option value="return">Customer return</option><option value="adjustment">Adjustment (+/-)</option>
                </select>
                <input required type="number" step="0.0001" min={form.movementType === "adjustment" ? undefined : "0.0001"} placeholder={form.movementType === "adjustment" ? "Quantity (+/-)" : "Quantity"} aria-label="Quantity" className="rounded-lg border border-slate-300 p-3" value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                <input maxLength={1000} placeholder="Notes (optional)" aria-label="Notes" className="rounded-lg border border-slate-300 p-3" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                <button disabled={busy || !(records.products || []).length} className="rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Record movement"}</button>
                {form.movementType === "sale" && <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-5">Sales decrease stock automatically. Adjustments accept a positive or negative quantity.</p>}
              </form>
            )}
            {tab === "invoices" && (
              <>
                <form onSubmit={submitInvoiceDraft} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <select aria-label="Invoice client" className="rounded-lg border border-slate-300 p-3" value={form.invoiceClientId || ""} onChange={(e) => setForm({ ...form, invoiceClientId: e.target.value })}>
                    <option value="">No client selected</option>
                    {(records.clients || []).filter((client) => client.status !== "archived").map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  <select aria-label="Invoice product" className="rounded-lg border border-slate-300 p-3" value={form.invoiceProductId || ""} onChange={(e) => { const product = (records.products || []).find((item) => item.id === e.target.value); setForm({ ...form, invoiceProductId: e.target.value, invoiceDescription: product?.name || form.invoiceDescription, invoiceUnitPrice: product ? String(Number(product.sale_price_minor || 0) / (10 ** currencyDigits(account.currency_code))) : form.invoiceUnitPrice }); }}>
                    <option value="">Custom line item</option>
                    {(records.products || []).filter((product) => product.is_active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                  <input required maxLength={500} placeholder="Item description" aria-label="Item description" className="rounded-lg border border-slate-300 p-3" value={form.invoiceDescription || ""} onChange={(e) => setForm({ ...form, invoiceDescription: e.target.value })} />
                  <input required type="number" min="0.0001" step="0.0001" placeholder="Quantity" aria-label="Quantity" className="rounded-lg border border-slate-300 p-3" value={form.invoiceQuantity || "1"} onChange={(e) => setForm({ ...form, invoiceQuantity: e.target.value })} />
                  <input required type="number" min="0" step="0.01" placeholder={`Unit price (${currency})`} aria-label="Unit price" className="rounded-lg border border-slate-300 p-3" value={form.invoiceUnitPrice || ""} onChange={(e) => setForm({ ...form, invoiceUnitPrice: e.target.value })} />
                  <input type="number" min="0" step="0.01" placeholder={`Line discount (${currency})`} aria-label="Line discount" className="rounded-lg border border-slate-300 p-3" value={form.invoiceDiscount || "0"} onChange={(e) => setForm({ ...form, invoiceDiscount: e.target.value })} />
                  <input required type="date" aria-label="Invoice date" className="rounded-lg border border-slate-300 p-3" value={form.invoiceIssueDate || localDate()} onChange={(e) => setForm({ ...form, invoiceIssueDate: e.target.value })} />
                  <input type="date" aria-label="Due date" className="rounded-lg border border-slate-300 p-3" value={form.invoiceDueDate || ""} onChange={(e) => setForm({ ...form, invoiceDueDate: e.target.value })} />
                  <input maxLength={4000} placeholder="Notes (optional)" aria-label="Invoice notes" className="rounded-lg border border-slate-300 p-3 sm:col-span-2" value={form.invoiceNotes || ""} onChange={(e) => setForm({ ...form, invoiceNotes: e.target.value })} />
                  <button disabled={busy} className="rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save draft"}</button>
                  <p className="text-xs text-amber-700 sm:col-span-2 lg:col-span-4">Draft only: tax is not calculated, and this document cannot be issued or represented as a compliant tax invoice.</p>
                </form>
                {(records.invoices || []).some((invoice) => ["issued", "partially_paid", "overdue"].includes(invoice.status)) && (
                  <form onSubmit={submitInvoicePayment} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <select required aria-label="Issued invoice" className="rounded-lg border border-slate-300 p-3" value={form.paymentInvoiceId || ""} onChange={(e) => setForm({ ...form, paymentInvoiceId: e.target.value })}>
                      <option value="">Choose issued invoice</option>
                      {(records.invoices || []).filter((invoice) => ["issued", "partially_paid", "overdue"].includes(invoice.status)).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {money(invoice.total_minor - invoice.amount_paid_minor, invoice.currency_code)} due</option>)}
                    </select>
                    <input required type="number" min="0.01" step="0.01" placeholder={`Amount (${currency})`} aria-label="Payment amount" className="rounded-lg border border-slate-300 p-3" value={form.paymentAmount || ""} onChange={(e) => setForm({ ...form, paymentAmount: e.target.value })} />
                    <input type="date" aria-label="Payment date" className="rounded-lg border border-slate-300 p-3" value={form.paymentDate || localDate()} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
                    <input maxLength={80} placeholder="Method (e.g. bank transfer)" aria-label="Payment method" className="rounded-lg border border-slate-300 p-3" value={form.paymentMethod || ""} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} />
                    <input maxLength={160} placeholder="Reference (optional)" aria-label="Payment reference" className="rounded-lg border border-slate-300 p-3" value={form.paymentReference || ""} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} />
                    <input maxLength={1000} placeholder="Notes (optional)" aria-label="Payment notes" className="rounded-lg border border-slate-300 p-3" value={form.paymentNotes || ""} onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })} />
                    <button disabled={busy} className="rounded-lg bg-slate-800 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Record external payment"}</button>
                    <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">This records a payment received outside Plivex. It does not collect money or start a Cashfree transaction.</p>
                  </form>
                )}
              </>
            )}
            {["clients", "products", "expenses"].includes(tab) && (
              <form onSubmit={submitRecord} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                {tab === "clients" && <><input required placeholder="Client name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input type="email" placeholder="Email (optional)" className="rounded-lg border border-slate-300 p-3" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /><input placeholder="Phone (optional)" className="rounded-lg border border-slate-300 p-3" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></>}
                {tab === "products" && <><input required placeholder="Product name" className="rounded-lg border border-slate-300 p-3" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="SKU (optional)" className="rounded-lg border border-slate-300 p-3" value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /><input required min="0" step="any" type="number" placeholder={`Sale price (${currency})`} className="rounded-lg border border-slate-300 p-3" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></>}
                {tab === "expenses" && <>
                  <input required placeholder="Expense category" className="rounded-lg border border-slate-300 p-3" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                  <input placeholder="Vendor (optional)" className="rounded-lg border border-slate-300 p-3" value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                  <input required min="0.01" step="any" type="number" placeholder={`Amount (${form.expenseCurrency || currency})`} className="rounded-lg border border-slate-300 p-3" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  <select aria-label="Expense transaction currency" className="rounded-lg border border-slate-300 p-3" value={form.expenseCurrency || currency} onChange={(e) => setForm({ ...form, expenseCurrency: e.target.value })}>
                    {["INR","USD","EUR","GBP","AED","CAD","AUD","SGD","JPY","KRW","KWD","BHD","OMR","JOD"].map((code) => <option key={code} value={code}>{code}{code === currency ? " · workspace base" : ""}</option>)}
                  </select>
                  <input type="date" aria-label="Expense date" className="rounded-lg border border-slate-300 p-3" value={form.expenseDate || localDate()} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
                  {form.expenseCurrency && form.expenseCurrency !== currency && <>
                    <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2 lg:col-span-4">Foreign-currency expense. Enter a source-attributed exchange-rate snapshot. Plivex does not fetch or guess FX rates. The saved base amount is used in workspace reports; the original amount and rate remain in the audit history.</div>
                    <input required inputMode="numeric" placeholder="FX rate numerator" aria-label="FX rate numerator" className="rounded-lg border border-slate-300 p-3" value={form.fxRateNumerator || ""} onChange={(e) => setForm({ ...form, fxRateNumerator: e.target.value })} />
                    <input required inputMode="numeric" placeholder="FX rate denominator" aria-label="FX rate denominator" className="rounded-lg border border-slate-300 p-3" value={form.fxRateDenominator || ""} onChange={(e) => setForm({ ...form, fxRateDenominator: e.target.value })} />
                    <input required type="url" placeholder="HTTPS FX source URL" aria-label="FX source URL" className="rounded-lg border border-slate-300 p-3 sm:col-span-2" value={form.fxSourceUrl || ""} onChange={(e) => setForm({ ...form, fxSourceUrl: e.target.value })} />
                    <input required maxLength={100} placeholder="Rate provider / source name" aria-label="FX provider" className="rounded-lg border border-slate-300 p-3" value={form.fxProvider || ""} onChange={(e) => setForm({ ...form, fxProvider: e.target.value })} />
                    <input required type="datetime-local" aria-label="FX effective date and time" className="rounded-lg border border-slate-300 p-3" value={form.fxEffectiveAt || `${form.expenseDate || localDate()}T00:00`} onChange={(e) => setForm({ ...form, fxEffectiveAt: e.target.value })} />
                    <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">Rate meaning: 1 {form.expenseCurrency} = numerator ÷ denominator {currency}. Example: 85 / 100 means 0.85 {currency} per 1 {form.expenseCurrency}.</p>
                  </>}
                </>}
                <button disabled={busy} className="rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Add record"}</button>
              </form>
            )}
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {currentRecords.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No records yet.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{(tab === "clients" ? ["Name", "Email", "Phone"] : tab === "products" ? ["Product", "SKU", "Sale price"] : tab === "expenses" ? ["Category", "Vendor", "Workspace amount", "Original amount", "Date"] : tab === "invoices" ? ["Invoice", "Status", "Total", "Date"] : ["Product ID", "Quantity", "Reorder level"]).map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
                  {currentRecords.map((record) => <tr key={record.id || record.product_id}>
                    {tab === "clients" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.email || "—"}</td><td className="px-4 py-3">{record.phone || "—"}</td></>}
                    {tab === "products" && <><td className="px-4 py-3 font-medium">{record.name}</td><td className="px-4 py-3">{record.sku || "—"}</td><td className="px-4 py-3">{money(record.sale_price_minor, record.currency_code)}</td></>}
                    {tab === "expenses" && <><td className="px-4 py-3 font-medium">{record.category}</td><td className="px-4 py-3">{record.vendor || "—"}</td><td className="px-4 py-3">{money(record.amount_minor, record.currency_code)}</td><td className="px-4 py-3">{money(record.transaction_amount_minor ?? record.amount_minor, record.transaction_currency_code || record.currency_code)}</td><td className="px-4 py-3">{record.expense_date}</td></>}
                    {tab === "invoices" && <><td className="px-4 py-3 font-medium">{record.invoice_number}</td><td className="px-4 py-3">{record.status}</td><td className="px-4 py-3">{money(record.total_minor, record.currency_code)}</td><td className="px-4 py-3">{record.issue_date}</td></>}
                    {tab === "inventory" && <><td className="px-4 py-3 font-medium">{(records.products || []).find((product) => product.id === record.product_id)?.name || record.product_id}</td><td className="px-4 py-3">{record.quantity}</td><td className="px-4 py-3">{record.reorder_level}</td></>}
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
