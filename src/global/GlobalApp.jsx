import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Users, Package, Receipt, FileText, Boxes, Warehouse, ShoppingCart, UserPlus, BarChart3, FilePlus2, ArrowRight } from "lucide-react";
import { supabase } from "@/api/backendClient";
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import FeatureLibraryModal from "@/components/dashboard/FeatureLibraryModal";
import GlobalInvoicesPanel from "@/components/global/GlobalInvoicesPanel";
import GlobalQuotationsPanel from "@/components/global/GlobalQuotationsPanel";
import GlobalAccountingPanel from "@/components/global/GlobalAccountingPanel";
import GlobalEnterprisePanel from "@/components/global/GlobalEnterprisePanel";
import GlobalPart4Panel from "@/components/global/GlobalPart4Panel";


const NAV = [
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
  { id: "products", label: "Products" },
  { id: "expenses", label: "Expenses" },
  { id: "crm", label: "CRM" },
  { id: "inventory", label: "Inventory & Warehouse" },
  { id: "invoices", label: "Invoices" },
  { id: "quotations", label: "Quotations" },
  { id: "accounting", label: "Accounting" },
  { id: "enterprise", label: "Enterprise" },
];
const TABLES = { clients: "clients", products: "products", expenses: "expenses", inventory: "stock_levels", invoices: "invoices" };
const TAB_PATHS = {
  overview: "/dashboard",
  clients: "/client-database",
  products: "/products",
  expenses: "/expenses",
  crm: "/crm",
  inventory: "/inventory-procurement",
  invoices: "/invoice-history",
  quotations: "/quotations",
  accounting: "/accounting",
  enterprise: "/enterprise",
};
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

export default function GlobalApp({ section = "overview" }) {
  const { user: account } = useAuth();
  const { features: workspaceFeatures, updateFeatures, saving: savingFeatures, error: featureError } = useWorkspaceFeatures(account?.id);
  const [featureOpen, setFeatureOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const tab = NAV.some((item) => item.id === section) ? section : "overview";
  const setTab = useCallback((nextTab) => navigate(TAB_PATHS[nextTab] || TAB_PATHS.overview), [navigate]);
  const [records, setRecords] = useState({});
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const invoke = useCallback(async (table, action = "list", values = undefined) => {
    if (!account?.workspace_id) throw new Error("Your Global workspace is not ready.");
    const body = { workspace_id: account.workspace_id, table, action, limit: 100 };
    if (values !== undefined) body.values = values;
    const { data, error: invokeError } = await supabase.functions.invoke("global-business-records", { body });
    if (invokeError) throw new Error(await errorMessage(invokeError, "Global request failed."));
    return data;
  }, [account?.workspace_id]);

  const loadRecords = useCallback(async (activeTab = tab) => {
    if (!account?.workspace_id || ["crm", "inventory", "quotations"].includes(activeTab)) return;
    const tables = activeTab === "overview" ? ["clients", "products", "expenses", "invoices", "stock_levels"] : [TABLES[activeTab]];
    const results = await Promise.all(tables.map(async (table) => [table, await invoke(table)]));
    setRecords((current) => ({ ...current, ...Object.fromEntries(results.map(([table, result]) => [table, result.records || []])) }));
  }, [account?.workspace_id, invoke, tab]);

  useEffect(() => {
    if (!account?.workspace_id || ["accounting", "quotations"].includes(tab)) return;
    loadRecords(tab).catch((loadError) => setError(loadError.message));
  }, [account?.workspace_id, tab, loadRecords]);

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
          barcode: form.barcode?.trim() || null,
          variant_of: form.variantOf || null,
          variant_label: form.variantLabel?.trim() || null,
          purchase_cost_minor: Math.round(Number(form.purchaseCost || 0) * (10 ** digits)),
          sale_price_minor: Math.round(Number(form.salePrice || 0) * (10 ** digits)),
          currency_code: account?.currency_code || "USD",
        };
      } else if (tab === "expenses") {
        const currency = account?.currency_code || "USD";
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

  if (!account?.workspace_id) return <div className="py-10 text-center text-sm text-slate-500">Your workspace is still being prepared. Please refresh in a moment.</div>;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.workspace_id)) return <div role="alert" className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Your Global workspace could not be verified. Please sign out and sign in again to reload its country, currency and workspace ID. Your saved data has not been changed.</div>;

  const currency = account.currency_code || "USD";
  const currentTable = TABLES[tab];
  const currentRecords = records[currentTable] || [];
  const counts = { clients: records.clients?.length || 0, products: records.products?.length || 0, expenses: records.expenses?.length || 0, invoices: records.invoices?.length || 0, stock: records.stock_levels?.length || 0 };

  const metricCards = [
    { label: "Clients", value: counts.clients, tab: "clients", icon: Users, tone: "bg-blue-50 text-blue-700" },
    { label: "Products", value: counts.products, tab: "products", icon: Package, tone: "bg-violet-50 text-violet-700" },
    { label: "Expenses", value: counts.expenses, tab: "expenses", icon: Receipt, tone: "bg-emerald-50 text-emerald-700" },
    { label: "Invoices", value: counts.invoices, tab: "invoices", icon: FileText, tone: "bg-amber-50 text-amber-700" },
    { label: "Stock items", value: counts.stock, tab: "products", icon: Boxes, tone: "bg-rose-50 text-rose-700" },
  ];
  const actionCards = [
    { id: "invoices", title: "Invoices", desc: "Create and manage professional invoices for your customers.", icon: FileText, gradient: "bg-gradient-to-br from-[#EDE9FE] to-[#DDD6FE]", cta: "+ Create New Invoice", tab: "invoices", stat: counts.invoices },
    { id: "quotations", title: "Quotations", desc: "Send estimates clients can approve, then convert accepted quotes into invoice drafts.", icon: FilePlus2, gradient: "bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE]", cta: "+ Create New Quotation", tab: "quotations" },
    { id: "expenses", title: "Expenses", desc: "Track vendor bills and purchases in your workspace currency.", icon: ShoppingCart, gradient: "bg-gradient-to-br from-[#DCFCE7] to-[#BBF7D0]", cta: "+ Record New Purchase", tab: "expenses", stat: counts.expenses },
    { id: "crm", title: "Client CRM", desc: "Keep customer details and conversations organised in one place.", icon: Users, gradient: "bg-gradient-to-br from-[#FAE8FF] to-[#F5D0FE]", cta: "Open Client CRM", tab: "crm", stat: counts.clients },
    { id: "leads", title: "Lead Tracker", desc: "Manage prospects, follow-ups and customer relationships.", icon: UserPlus, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "+ Add New Lead", tab: "crm" },
    { id: "reports", title: "Reports", desc: "Understand business performance with country-aware financial reports.", icon: BarChart3, gradient: "bg-gradient-to-br from-[#E0F2FE] to-[#BAE6FD]", cta: "View business reports", tab: "accounting" },
    { id: "stock", title: "Stock Inventory", desc: "Manage products, prices and stock visibility for your business.", icon: Package, gradient: "bg-gradient-to-br from-[#FEE2E2] to-[#FECACA]", cta: "+ Manage Stock", tab: "products", stat: counts.stock },
    { id: "team", title: "Team Members", desc: "Manage workspace access, roles and team activity.", icon: Users, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "Manage Team", tab: "enterprise" },
    { id: "inventoryWorkspace", title: "Inventory & Warehouse", desc: "Manage stock locations, transfers, purchase orders, goods receipts and movement history.", icon: Warehouse, gradient: "bg-gradient-to-br from-[#E0E7FF] to-[#C7D2FE]", cta: "Open inventory workspace", tab: "inventory" },
  ].filter((item) => {
    if (item.id === "expenses") return workspaceFeatures.includes("expenses");
    if (item.id === "crm" || item.id === "leads") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (item.id === "reports") return workspaceFeatures.includes("reports");
    if (item.id === "inventoryWorkspace") return workspaceFeatures.includes("inventoryWorkspace");
    return true;
  });

  const visibleMetricCards = metricCards.filter((item) => {
    if (item.tab === "clients") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (item.tab === "expenses") return workspaceFeatures.includes("expenses");
    return true;
  });

  return (
    <div className="w-full text-slate-900">
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {tab === "overview" ? (
          <div className="plivex-dashboard-tab space-y-5 sm:space-y-6">
            <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" aria-label="Workspace totals">
              {visibleMetricCards.map((item) => (
                <button key={item.label} type="button" onClick={() => setTab(item.tab)} className="rounded-xl border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-violet-200 hover:bg-violet-50/30">
                  <span className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.tone}`}><item.icon className="h-4 w-4" /></span><span className="text-[11px] font-semibold text-slate-500">{item.label}</span></span>
                  <span className="mt-2 block text-2xl font-bold tracking-tight text-slate-900">{item.value}</span>
                </button>
              ))}
            </section>
            <div className="plivex-quick-actions-heading flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-[15px] font-bold text-slate-900">Quick actions</h2><p className="mt-1 text-[11px] text-slate-500">Your business tools, in one workspace.</p></div>
            </div>
            <div className="plivex-action-cards grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {actionCards.map((item) => (
                <div key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-transform hover:-translate-y-0.5">
                  <div className={`relative flex h-28 items-center justify-center ${item.gradient}`}>
                    <item.icon className="h-12 w-12 text-[#6D28D9]" strokeWidth={1.5} aria-hidden="true" />
                    {item.stat !== undefined && <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{item.stat} saved</span>}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-[15px] font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-500">{item.desc}</p>
                    <button type="button" onClick={() => setTab(item.tab)} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white transition-colors hover:bg-[#7C3AED]">{item.cta}<ArrowRight className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setFeatureOpen(true)} className="group flex min-h-[270px] flex-col items-center justify-center rounded-2xl border border-dashed border-violet-300 bg-gradient-to-br from-white to-violet-50/80 p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500 hover:shadow-lg">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 shadow-sm"><Boxes className="h-7 w-7" /></span>
                <span className="mt-4 text-base font-bold text-slate-900">More Features</span>
                <span className="mt-1 max-w-[230px] text-xs leading-5 text-slate-500">Explore Plivex tools and add the ones that fit the way you work.</span>
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-4 py-2 text-xs font-bold text-white">Customize workspace <ArrowRight className="h-3.5 w-3.5" /></span>
              </button>
            </div>
          </div>
        ) : tab === "invoices" ? (
          <GlobalInvoicesPanel account={account} invoke={invoke} onRefresh={loadRecords} />
        ) : tab === "quotations" ? (
          <GlobalQuotationsPanel account={account} />
        ) : tab === "accounting" ? (
          <GlobalAccountingPanel account={account} />
        ) : tab === "enterprise" ? (
          <GlobalEnterprisePanel workspaceId={account.workspace_id} />
        ) : ["crm", "inventory"].includes(tab) ? (
          <GlobalPart4Panel account={account} initialSection={tab === "crm" ? "crm" : "warehouses"} />
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
      {featureOpen && <FeatureLibraryModal features={workspaceFeatures} updateFeatures={updateFeatures} saving={savingFeatures} error={featureError} onClose={() => setFeatureOpen(false)} />}
    </div>
  );
}
