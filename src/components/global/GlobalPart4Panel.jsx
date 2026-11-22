import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";
import { findSavedGstinRecords, parseIndianGstin } from "@/global/tax/gstin.js";
import { ArrowLeftRight, ClipboardList, History, Plus, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500";
const button = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const blankLead = { name: "", company: "", email: "", phone: "", source: "", requirement: "", value: "", stage: "new", followUp: "" };
const blankWarehouse = { code: "", name: "", is_default: false };
const uid = () => crypto.randomUUID();
const digits = (currency) => { try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
const money = (minor, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(minor || 0) / (10 ** digits(currency || "USD")));
const dateOnly = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const scoreLead = (lead) => Math.min(100,
  (lead.email.trim() ? 15 : 0) + (lead.phone.trim() ? 10 : 0) + (lead.company.trim() ? 10 : 0)
  + (lead.requirement.trim() ? 20 : 0) + (Number(lead.value) > 0 ? 20 : 0) + (lead.followUp ? 15 : 0)
  + (lead.source.trim() ? 10 : 0));

export default function GlobalPart4Panel({ account, initialSection = "crm" }) {
  const [section, setSection] = useState(initialSection);
  useEffect(() => {
    if (["crm", "warehouses", "transfers", "purchasing", "movements"].includes(initialSection)) setSection(initialSection);
  }, [initialSection]);
  const [data, setData] = useState({ leads: [], activities: [], warehouses: [], stock: [], batches: [], movements: [], transfers: [], orders: [], orderItems: [], products: [], suppliers: [] });
  const [lead, setLead] = useState(blankLead);
  const [warehouse, setWarehouse] = useState(blankWarehouse);
  const [activity, setActivity] = useState({ lead_id: "", activity_type: "note", body: "" });
  const [transfer, setTransfer] = useState({ from: "", to: "", product_id: "", quantity: "" });
  const [order, setOrder] = useState({ supplier_name: "", supplier_reference: "", expected_date: "", product_id: "", quantity: "1", unit_cost: "" });\n  const [supplierGstinLookup, setSupplierGstinLookup] = useState("");
  const [receipt, setReceipt] = useState({ order_id: "", warehouse_id: "", item_id: "", quantity: "", batch_number: "", expires_on: "" });
  const [transferKey, setTransferKey] = useState(uid());
  const [receiptKey, setReceiptKey] = useState(uid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [movementQuery, setMovementQuery] = useState("");
  const [movementType, setMovementType] = useState("all");
  const [movementFrom, setMovementFrom] = useState("");
  const [movementTo, setMovementTo] = useState("");

  const call = useCallback(async (body) => {
    const { data: result, error: invokeError } = await supabase.functions.invoke("global-part4", { body: { workspace_id: account.workspace_id, ...body } });
    if (invokeError) {
      let message = invokeError.message || "Part 4 request failed.";
      try { const json = await invokeError.context?.clone?.().json(); if (json?.error) message = json.error; } catch {}
      throw new Error(message);
    }
    if (result?.error) throw new Error(result.error);
    return result;
  }, [account.workspace_id]);

  const refresh = useCallback(async () => {
    const resources = ["crm_leads", "crm_activities", "warehouses", "warehouse_stock_levels", "inventory_batches", "warehouse_stock_movements", "stock_transfers", "purchase_orders", "purchase_order_items", "suppliers"];
    const pairs = await Promise.all(resources.map(async (resource) => {
      const result = await call({ action: "list", resource, limit: 250 });
      return [resource, result.records || []];
    }));
    const { data: products, error: productsError } = await supabase.functions.invoke("global-business-records", {
      body: { workspace_id: account.workspace_id, table: "products", action: "list", limit: 250 },
    });
    if (productsError) throw new Error(productsError.message || "Could not load products.");
    const mapped = Object.fromEntries(pairs);
    setData({
      leads: mapped.crm_leads, activities: mapped.crm_activities, warehouses: mapped.warehouses,
      stock: mapped.warehouse_stock_levels, batches: mapped.inventory_batches, movements: mapped.warehouse_stock_movements,
      transfers: mapped.stock_transfers, orders: mapped.purchase_orders, orderItems: mapped.purchase_order_items,
      products: products?.records || [],
    });
  }, [account.workspace_id, call]);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);

  const run = async (fn, success) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      setNotice(success);
      try { await refresh(); } catch { setError("Saved successfully, but the refreshed list could not load. Use Refresh to try again."); }
      return true;
    } catch (e) { setError(e.message || "Could not complete the operation."); return false; }
    finally { setBusy(false); }
  };

  const productMap = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const selectedOrder = data.orders.find((o) => o.id === receipt.order_id);\n  const supplierGstinParsed = useMemo(() => parseIndianGstin(supplierGstinLookup), [supplierGstinLookup]);\n  const supplierGstinMatches = useMemo(() => findSavedGstinRecords(data.suppliers, supplierGstinLookup), [data.suppliers, supplierGstinLookup]);
  const selectedOrderItems = data.orderItems.filter((i) => i.purchase_order_id === selectedOrder?.id && Number(i.quantity_received) < Number(i.quantity_ordered));
  const activeWarehouses = data.warehouses.filter((w) => w.is_active);
  const lowStockLines = data.stock.filter((line) => Number(line.quantity || 0) <= Number(line.reorder_level || 0));
  const totalUnits = data.stock.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const inventoryValue = data.stock.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(productMap.get(line.product_id)?.purchase_cost_minor || 0), 0);
  const movementTypes = useMemo(() => [...new Set(data.movements.map((item) => item.movement_type).filter(Boolean))].sort(), [data.movements]);
  const filteredMovements = useMemo(() => data.movements.filter((item) => {
    const product = productMap.get(item.product_id);
    const haystack = [product?.name, product?.sku, item.reference_type, item.movement_type].filter(Boolean).join(" ").toLowerCase();
    const day = String(item.created_at || "").slice(0, 10);
    return haystack.includes(movementQuery.trim().toLowerCase())
      && (movementType === "all" || item.movement_type === movementType)
      && (!movementFrom || day >= movementFrom)
      && (!movementTo || day <= movementTo);
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [data.movements, movementQuery, movementType, movementFrom, movementTo, productMap]);

  const saveLead = (event) => {
    event.preventDefault();
    const valueMinor = Math.round(Number(lead.value || 0) * (10 ** digits(account.currency_code)));
    run(async () => {
      await call({ action: "mutate", operation: "create_lead", values: {
        name: lead.name.trim(), company: lead.company.trim() || null, email: lead.email.trim() || null,
        phone: lead.phone.trim() || null, source: lead.source.trim() || null, requirement: lead.requirement.trim() || null,
        estimated_value_minor: valueMinor, stage: lead.stage, score: scoreLead(lead),
        next_follow_up_at: lead.followUp ? new Date(lead.followUp + "T12:00:00").toISOString() : null,
      }});
      setLead(blankLead);
    }, "Lead saved with an automatic qualification score.");
  };

  const updateLead = (leadId, values) => run(async () => {
    await call({ action: "mutate", operation: "update_lead", values: { lead_id: leadId, ...values } });
  }, "Lead pipeline updated.");

  const saveWarehouse = (event) => {
    event.preventDefault();
    return run(async () => {
      await call({ action: "mutate", operation: "create_warehouse", values: { ...warehouse, code: warehouse.code.trim().toUpperCase(), name: warehouse.name.trim() } });
      setWarehouse(blankWarehouse);
    }, "Warehouse created.");
  };

  const saveActivity = (event) => {
    event.preventDefault();
    run(async () => {
      await call({ action: "mutate", operation: "add_lead_activity", values: activity });
      setActivity({ lead_id: activity.lead_id, activity_type: "note", body: "" });
    }, "CRM activity added.");
  };

  const saveTransfer = (event) => {
    event.preventDefault();
    return run(async () => {
      await call({ action: "transfer", from_warehouse_id: transfer.from, to_warehouse_id: transfer.to,
        idempotency_key: transferKey, items: [{ product_id: transfer.product_id, quantity: Number(transfer.quantity) }] });
      setTransferKey(uid());
      setTransfer({ from: "", to: "", product_id: "", quantity: "" });
    }, "Stock transfer completed and ledger updated.");
  };

  const saveOrder = (event) => {
    event.preventDefault();
    const minor = Math.round(Number(order.unit_cost || 0) * (10 ** digits(account.currency_code)));
    return run(async () => {
      await call({ action: "mutate", operation: "create_purchase_order", values: {
        supplier_name: order.supplier_name.trim(), supplier_reference: order.supplier_reference.trim() || null,
        currency_code: account.currency_code, order_date: dateOnly(), expected_date: order.expected_date || null,
        items: [{ product_id: order.product_id, quantity_ordered: Number(order.quantity), unit_cost_minor: minor }],
      }});
      setOrder({ supplier_name: "", supplier_reference: "", expected_date: "", product_id: "", quantity: "1", unit_cost: "" });\n      setSupplierGstinLookup("");
    }, "Purchase order created.");
  };

  const receiveOrder = (event) => {
    event.preventDefault();
    const item = selectedOrderItems.find((i) => i.id === receipt.item_id);
    if (!item) { setError("Select an outstanding purchase-order item."); return; }
    return run(async () => {
      await call({ action: "mutate", operation: "receive_purchase_order", values: {
        purchase_order_id: receipt.order_id, warehouse_id: receipt.warehouse_id, idempotency_key: receiptKey,
        items: [{ purchase_order_item_id: item.id, quantity: Number(receipt.quantity),
          batch_number: receipt.batch_number.trim() || null, expires_on: receipt.expires_on || null }],
      }});
      setReceiptKey(uid());
      setReceipt({ order_id: receipt.order_id, warehouse_id: receipt.warehouse_id, item_id: "", quantity: "", batch_number: "", expires_on: "" });
    }, "Goods received. Warehouse stock and movement history updated.");
  };

  const tabs = section === "crm" ? [] : [
      { id: "warehouses", label: "Stock & warehouses", icon: WarehouseIcon },
      { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
      { id: "purchasing", label: "Purchase orders", icon: ClipboardList },
      { id: "movements", label: "Movement history", icon: History },
    ];

  const sectionTitle = section === "crm" ? "Customer relationship management"
    : section === "warehouses" ? "Inventory & warehouse"
      : section === "transfers" ? "Stock transfers"
        : section === "purchasing" ? "Purchase orders"
          : "Movement history";
  const sectionDescription = section === "crm" ? "Manage leads, follow-ups and customer activity."
    : section === "warehouses" ? "One workspace for stock visibility, warehouse locations and reorder signals."
      : section === "transfers" ? "Move stock between locations with a traceable transfer record."
        : section === "purchasing" ? "Create supplier orders and receive goods into the right warehouse."
          : "A searchable audit trail of receipts, transfers and stock adjustments.";

  return <section className="mt-6 space-y-5">
    <div className="overflow-hidden rounded-2xl border border-[#E7E2F2] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8B7AAE]">Plivex workspace / {section === "crm" ? "CRM" : "Inventory"}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{sectionTitle}</h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">{sectionDescription}</p>
        </div>
        <button type="button" className={secondary + " inline-flex items-center gap-2"} onClick={() => refresh().catch((e) => setError(e.message))}>
          <RefreshCw className="h-4 w-4" /> Refresh data
        </button>
      </div>
      {section !== "crm" && <nav aria-label="Inventory workspace sections" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 pt-2 sm:px-4">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={section === item.id} onClick={() => { setSection(item.id); setError(""); setNotice(""); }} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${section === item.id ? "border-[#6D28D9] text-[#6D28D9]" : "border-transparent text-slate-500 hover:border-violet-200 hover:text-slate-800"}`}>
          <item.icon className="h-4 w-4" />{item.label}
        </button>)}
      </nav>}
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    {section === "crm" && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Open leads</p><p className="mt-1 text-2xl font-bold">{data.leads.filter((x) => !["won","lost"].includes(x.stage)).length}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Follow-ups due</p><p className="mt-1 text-2xl font-bold">{data.leads.filter((x) => x.next_follow_up_at && new Date(x.next_follow_up_at) <= new Date()).length}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Activities</p><p className="mt-1 text-2xl font-bold">{data.activities.length}</p></div>
      </div>
      <form onSubmit={saveLead} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-4">Add lead · automatic score {scoreLead(lead)}/100</h2>
        <input required className={input} placeholder="Lead name" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })}/>
        <input className={input} placeholder="Company" value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })}/>
        <input className={input} type="email" placeholder="Email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })}/>
        <input className={input} placeholder="Phone" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })}/>
        <input className={input} placeholder="Lead source" value={lead.source} onChange={(e) => setLead({ ...lead, source: e.target.value })}/>
        <input className={input} placeholder="Requirement" value={lead.requirement} onChange={(e) => setLead({ ...lead, requirement: e.target.value })}/>
        <input className={input} type="number" min="0" step="0.01" placeholder={`Estimated value (${account.currency_code})`} value={lead.value} onChange={(e) => setLead({ ...lead, value: e.target.value })}/>
        <select className={input} value={lead.stage} onChange={(e) => setLead({ ...lead, stage: e.target.value })}>{["new","qualified","proposal","negotiation","won","lost"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <label className="text-xs text-slate-500">Next follow-up<input className={input+" mt-1"} type="date" value={lead.followUp} onChange={(e) => setLead({ ...lead, followUp: e.target.value })}/></label>
        <button disabled={busy} className={button}>Save lead</button>
      </form>
      <form onSubmit={saveActivity} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">Log customer interaction</h2>
        <select required className={input} value={activity.lead_id} onChange={(e) => setActivity({ ...activity, lead_id: e.target.value })}><option value="">Choose lead</option>{data.leads.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className={input} value={activity.activity_type} onChange={(e) => setActivity({ ...activity, activity_type: e.target.value })}>{["note","call","email","meeting","follow_up"].map((x) => <option key={x}>{x}</option>)}</select>
        <input required className={input} placeholder="Interaction notes" value={activity.body} onChange={(e) => setActivity({ ...activity, body: e.target.value })}/>
        <button disabled={busy || !data.leads.length} className={button+" sm:col-span-3"}>Add activity</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["Lead","Company","Stage","Score","Value","Next follow-up"].map((x)=><th key={x} className="whitespace-nowrap px-3 py-3">{x}</th>)}</tr></thead><tbody className="divide-y">{data.leads.map((x)=><tr key={x.id}><td className="px-3 py-3 font-medium">{x.name}</td><td className="px-3 py-3">{x.company || "—"}</td><td className="px-3 py-3"><select className="rounded border border-slate-200 bg-white p-1 capitalize" value={x.stage} disabled={busy} onChange={(e)=>updateLead(x.id,{stage:e.target.value})}>{["new","qualified","proposal","negotiation","won","lost"].map((stage)=><option key={stage} value={stage}>{stage}</option>)}</select></td><td className="px-3 py-3">{x.score}/100</td><td className="px-3 py-3">{money(x.estimated_value_minor, x.currency_code)}</td><td className="px-3 py-3">{x.next_follow_up_at ? new Date(x.next_follow_up_at).toLocaleDateString() : "—"}</td></tr>)}</tbody></table>{!data.leads.length && <p className="p-6 text-center text-sm text-slate-500">No leads yet.</p>}</div>
    </>}

    {section === "warehouses" && <>
      <div className="rounded-xl border border-[#E7E2F2] bg-white px-4 py-3 shadow-sm">
        <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-4 sm:divide-x sm:divide-slate-100">
          <div className="pr-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Active warehouses</p><p className="mt-1 text-xl font-bold text-slate-900">{activeWarehouses.length}</p></div>
          <div className="sm:px-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Stock lines</p><p className="mt-1 text-xl font-bold text-slate-900">{data.stock.length}</p></div>
          <div className="sm:px-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Units on hand</p><p className="mt-1 text-xl font-bold text-slate-900">{totalUnits.toLocaleString()}</p></div>
          <div className="sm:pl-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Inventory value</p><p className="mt-1 text-xl font-bold text-[#6D28D9]">{money(inventoryValue, account.currency_code)}</p></div>
        </div>
        {lowStockLines.length > 0 && <p className="mt-3 border-t border-rose-100 pt-2 text-xs font-medium text-rose-700">{lowStockLines.length} stock lines are at or below their reorder level.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-bold text-slate-900">Warehouse locations</h2><p className="text-xs text-slate-500">Locations and their current stock footprint</p></div>
        <button type="button" className={button + " inline-flex items-center gap-2"} onClick={() => setShowWarehouseForm((value) => !value)}><Plus className="h-4 w-4"/>{showWarehouseForm ? "Close form" : "Add warehouse"}</button>
      </div>
      {showWarehouseForm && <form onSubmit={async (event) => { if (await saveWarehouse(event)) setShowWarehouseForm(false); }} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-4">
        <input required className={input} placeholder="Warehouse code (e.g. MAIN)" value={warehouse.code} onChange={(e) => setWarehouse({ ...warehouse, code: e.target.value })}/>
        <input required className={input} placeholder="Warehouse name" value={warehouse.name} onChange={(e) => setWarehouse({ ...warehouse, name: e.target.value })}/>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={warehouse.is_default} onChange={(e) => setWarehouse({ ...warehouse, is_default: e.target.checked })}/> Default location</label>
        <button disabled={busy} className={button}>Save warehouse</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Stock lines</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Default</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.warehouses.map((w) => <tr key={w.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold text-slate-900">{w.name}</td><td className="px-4 py-3 text-slate-500">{w.code}</td><td className="px-4 py-3 tabular-nums">{data.stock.filter((line) => line.warehouse_id === w.id).length}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${w.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{w.is_active ? "Active" : "Inactive"}</span></td><td className="px-4 py-3 text-slate-500">{w.is_default ? "Default" : "—"}</td></tr>)}</tbody>
        </table>
        {!data.warehouses.length && <p className="p-8 text-center text-sm text-slate-500">No warehouse locations yet. Add your first warehouse to begin tracking stock by location.</p>}
      </div>
      <div><div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">Stock by location</h2><p className="text-xs text-slate-500">Live quantities and reorder thresholds</p></div><span className="text-xs text-slate-400">{data.stock.length} lines</span></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Reorder at</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{data.stock.map((line) => { const product = productMap.get(line.product_id); const low = Number(line.quantity || 0) <= Number(line.reorder_level || 0); return <tr key={line.warehouse_id + line.product_id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold">{product?.name || line.product_id}</td><td className="px-4 py-3 text-slate-500">{data.warehouses.find((w) => w.id === line.warehouse_id)?.name || "—"}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{line.quantity}</td><td className="px-4 py-3 text-right text-slate-500 tabular-nums">{line.reorder_level}</td><td className="px-4 py-3">{low ? <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Reorder</span> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Healthy</span>}</td></tr>; })}</tbody></table>
          {!data.stock.length && <p className="p-8 text-center text-sm text-slate-500">Stock levels will appear here after goods are received or transferred.</p>}
        </div>
      </div>
    </>}

    {section === "transfers" && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold">Transfer register</h2><p className="text-xs text-slate-500">Every transfer is recorded against its source and destination.</p></div><button type="button" className={button + " inline-flex items-center gap-2"} onClick={() => setShowTransferForm((value) => !value)}><Plus className="h-4 w-4"/>{showTransferForm ? "Close form" : "New transfer"}</button></div>
      {showTransferForm && <form onSubmit={async (event) => { if (await saveTransfer(event)) setShowTransferForm(false); }} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <select required className={input} value={transfer.from} onChange={(e)=>setTransfer({...transfer,from:e.target.value})}><option value="">From warehouse</option>{activeWarehouses.map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={transfer.to} onChange={(e)=>setTransfer({...transfer,to:e.target.value})}><option value="">To warehouse</option>{activeWarehouses.filter((w)=>w.id!==transfer.from).map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={transfer.product_id} onChange={(e)=>setTransfer({...transfer,product_id:e.target.value})}><option value="">Product</option>{data.products.map((p)=><option key={p.id} value={p.id}>{p.name} {p.sku ? "· "+p.sku : ""}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Quantity" value={transfer.quantity} onChange={(e)=>setTransfer({...transfer,quantity:e.target.value})}/>
        <button disabled={busy || activeWarehouses.length < 2 || !data.products.length} className={button}>Confirm transfer</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[600px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 text-left">Created</th><th className="px-4 py-3 text-left">Source</th><th className="px-4 py-3 text-left">Destination</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Reference</th></tr></thead><tbody className="divide-y divide-slate-100">{data.transfers.map((t)=><tr key={t.id} className="hover:bg-violet-50/30"><td className="whitespace-nowrap px-4 py-3">{new Date(t.created_at).toLocaleString()}</td><td className="px-4 py-3 font-medium">{data.warehouses.find((w)=>w.id===t.from_warehouse_id)?.name || "—"}</td><td className="px-4 py-3 font-medium">{data.warehouses.find((w)=>w.id===t.to_warehouse_id)?.name || "—"}</td><td className="px-4 py-3 capitalize">{t.status}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{String(t.id).slice(0, 8)}</td></tr>)}</tbody></table>{!data.transfers.length && <p className="p-8 text-center text-sm text-slate-500">No transfers recorded yet.</p>}</div>
    </>}

    {section === "purchasing" && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold">Purchase order register</h2><p className="text-xs text-slate-500">Track supplier commitments, partial receipts and outstanding quantities.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => setShowReceiptForm((value) => !value)}>Receive goods</button><button type="button" className={button + " inline-flex items-center gap-2"} onClick={() => setShowOrderForm((value) => !value)}><Plus className="h-4 w-4"/>{showOrderForm ? "Close form" : "New purchase order"}</button></div></div>
      {showOrderForm && <form onSubmit={async (event) => { if (await saveOrder(event)) setShowOrderForm(false); }} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2"><label className="block text-xs font-semibold text-slate-700">Find saved supplier by GSTIN<input className={input + " mt-1"} value={supplierGstinLookup} maxLength={15} autoCapitalize="characters" placeholder="Enter 15-character GSTIN" onChange={(e)=>{ const value=e.target.value.toUpperCase().replace(/\s/g,""); setSupplierGstinLookup(value); const matches=findSavedGstinRecords(data.suppliers,value); if(matches.length===1) setOrder((current)=>({...current,supplier_name:matches[0].name})); }}/></label>{supplierGstinLookup.trim() && (supplierGstinParsed.ok ? <p className="mt-1 text-xs text-slate-600">Format detected · {supplierGstinParsed.stateName} · {supplierGstinParsed.panEntityType}. {supplierGstinMatches.length===1 ? "Saved supplier matched and selected." : supplierGstinMatches.length>1 ? "Multiple suppliers match; verify the supplier name before saving." : "No saved supplier matched. This is a local workspace lookup only."}</p> : <p className="mt-1 text-xs text-amber-700">{supplierGstinParsed.message}</p>)}</div><input required className={input} placeholder="Supplier name" value={order.supplier_name} onChange={(e)=>setOrder({...order,supplier_name:e.target.value})}/>
        <input className={input} placeholder="Supplier reference (optional)" value={order.supplier_reference} onChange={(e)=>setOrder({...order,supplier_reference:e.target.value})}/>
        <input type="date" className={input} value={order.expected_date} onChange={(e)=>setOrder({...order,expected_date:e.target.value})}/>
        <select required className={input} value={order.product_id} onChange={(e)=>setOrder({...order,product_id:e.target.value})}><option value="">Choose product</option>{data.products.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Quantity" value={order.quantity} onChange={(e)=>setOrder({...order,quantity:e.target.value})}/>
        <input required type="number" min="0" step="0.01" className={input} placeholder={`Unit cost (${account.currency_code})`} value={order.unit_cost} onChange={(e)=>setOrder({...order,unit_cost:e.target.value})}/>
        <button disabled={busy || !data.products.length} className={button+" sm:col-span-2 lg:col-span-3"}>Save purchase order</button>
      </form>}
      {showReceiptForm && <form onSubmit={async (event) => { if (await receiveOrder(event)) setShowReceiptForm(false); }} className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <select required className={input} value={receipt.order_id} onChange={(e)=>setReceipt({...receipt,order_id:e.target.value,item_id:""})}><option value="">Purchase order</option>{data.orders.filter((o)=>["ordered","partially_received"].includes(o.status)).map((o)=><option key={o.id} value={o.id}>{o.supplier_name} · {o.status}</option>)}</select>
        <select required className={input} value={receipt.warehouse_id} onChange={(e)=>setReceipt({...receipt,warehouse_id:e.target.value})}><option value="">Destination warehouse</option>{activeWarehouses.map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={receipt.item_id} onChange={(e)=>setReceipt({...receipt,item_id:e.target.value})}><option value="">Order line</option>{selectedOrderItems.map((i)=><option key={i.id} value={i.id}>{productMap.get(i.product_id)?.name || "Product"} · remaining {(Number(i.quantity_ordered)-Number(i.quantity_received)).toFixed(4)}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Received quantity" value={receipt.quantity} onChange={(e)=>setReceipt({...receipt,quantity:e.target.value})}/>
        <input className={input} placeholder="Batch number (optional)" value={receipt.batch_number} onChange={(e)=>setReceipt({...receipt,batch_number:e.target.value})}/>
        <input type="date" className={input} value={receipt.expires_on} onChange={(e)=>setReceipt({...receipt,expires_on:e.target.value})}/>
        <button disabled={busy || !selectedOrderItems.length || !receipt.warehouse_id} className={button+" sm:col-span-2 lg:col-span-3"}>Confirm goods receipt</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[650px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 text-left">Supplier</th><th className="px-4 py-3 text-left">Order date</th><th className="px-4 py-3 text-right">Order value</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Expected</th></tr></thead><tbody className="divide-y divide-slate-100">{data.orders.map((o)=><tr key={o.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold">{o.supplier_name}</td><td className="px-4 py-3 text-slate-500">{o.order_date}</td><td className="px-4 py-3 text-right tabular-nums">{money(o.subtotal_minor, o.currency_code)}</td><td className="px-4 py-3 capitalize">{o.status.replaceAll("_"," ")}</td><td className="px-4 py-3 text-slate-500">{o.expected_date || "—"}</td></tr>)}</tbody></table>{!data.orders.length && <p className="p-8 text-center text-sm text-slate-500">No purchase orders yet. Create an order to start tracking incoming stock.</p>}</div>
    </>}

    {section === "movements" && <>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="min-w-[190px] flex-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search movement<input className={input + " mt-1"} value={movementQuery} onChange={(e) => setMovementQuery(e.target.value)} placeholder="Product, SKU or reference"/></label>
        <label className="min-w-[150px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Movement type<select className={input + " mt-1"} value={movementType} onChange={(e) => setMovementType(e.target.value)}><option value="all">All types</option>{movementTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_"," ")}</option>)}</select></label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">From<input type="date" className={input + " mt-1"} value={movementFrom} onChange={(e) => setMovementFrom(e.target.value)}/></label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">To<input type="date" className={input + " mt-1"} value={movementTo} onChange={(e) => setMovementTo(e.target.value)}/></label>
        <button type="button" className={secondary} onClick={() => { setMovementQuery(""); setMovementType("all"); setMovementFrom(""); setMovementTo(""); }}>Clear filters</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-bold">Stock movement ledger</h2><p className="text-xs text-slate-500">Chronological, read-only record of inventory changes</p></div><span className="text-xs font-semibold text-slate-500">{filteredMovements.length} records</span></div><table className="w-full min-w-[720px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Date & time","Product","Warehouse","Movement","Quantity change","Reference"].map((x)=><th key={x} className="whitespace-nowrap px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filteredMovements.map((m)=><tr key={m.id} className="hover:bg-violet-50/30"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(m.created_at).toLocaleString()}</td><td className="px-4 py-3 font-semibold">{productMap.get(m.product_id)?.name || m.product_id}</td><td className="px-4 py-3">{data.warehouses.find((w)=>w.id===m.warehouse_id)?.name || "—"}</td><td className="px-4 py-3 capitalize">{m.movement_type.replaceAll("_"," ")}</td><td className={`px-4 py-3 font-semibold tabular-nums ${Number(m.quantity_delta)>0 ? "text-emerald-700" : "text-rose-700"}`}>{Number(m.quantity_delta)>0?"+":""}{m.quantity_delta}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{m.reference_type || "—"}</td></tr>)}</tbody></table>{!filteredMovements.length && <p className="p-8 text-center text-sm text-slate-500">No movements match these filters.</p>}</div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold">Batch & expiry register</h3><p className="text-xs text-slate-500">Received batches and their remaining quantities</p></div><table className="w-full min-w-[520px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 text-left">Product</th><th className="px-4 py-3 text-left">Batch</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3 text-left">Expiry</th></tr></thead><tbody className="divide-y divide-slate-100">{data.batches.map((b)=><tr key={b.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-medium">{productMap.get(b.product_id)?.name || b.product_id}</td><td className="px-4 py-3">{b.batch_number}</td><td className="px-4 py-3 text-right tabular-nums">{b.quantity}</td><td className="px-4 py-3">{b.expires_on || "—"}</td></tr>)}</tbody></table>{!data.batches.length && <p className="p-6 text-center text-sm text-slate-500">No batch records yet.</p>}</div>
    </>}
  </section>;
}
