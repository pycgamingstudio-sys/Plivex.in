import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";

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

export default function GlobalPart4Panel({ account }) {
  const [section, setSection] = useState("crm");
  const [data, setData] = useState({ leads: [], activities: [], warehouses: [], stock: [], batches: [], movements: [], transfers: [], orders: [], orderItems: [], products: [] });
  const [lead, setLead] = useState(blankLead);
  const [warehouse, setWarehouse] = useState(blankWarehouse);
  const [activity, setActivity] = useState({ lead_id: "", activity_type: "note", body: "" });
  const [transfer, setTransfer] = useState({ from: "", to: "", product_id: "", quantity: "" });
  const [order, setOrder] = useState({ supplier_name: "", supplier_reference: "", expected_date: "", product_id: "", quantity: "1", unit_cost: "" });
  const [receipt, setReceipt] = useState({ order_id: "", warehouse_id: "", item_id: "", quantity: "", batch_number: "", expires_on: "" });
  const [transferKey, setTransferKey] = useState(uid());
  const [receiptKey, setReceiptKey] = useState(uid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    const resources = ["crm_leads", "crm_activities", "warehouses", "warehouse_stock_levels", "inventory_batches", "warehouse_stock_movements", "stock_transfers", "purchase_orders", "purchase_order_items"];
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
    } catch (e) { setError(e.message || "Could not complete the operation."); }
    finally { setBusy(false); }
  };

  const productMap = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const selectedOrder = data.orders.find((o) => o.id === receipt.order_id);
  const selectedOrderItems = data.orderItems.filter((i) => i.purchase_order_id === selectedOrder?.id && Number(i.quantity_received) < Number(i.quantity_ordered));

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
    run(async () => {
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
    run(async () => {
      await call({ action: "transfer", from_warehouse_id: transfer.from, to_warehouse_id: transfer.to,
        idempotency_key: transferKey, items: [{ product_id: transfer.product_id, quantity: Number(transfer.quantity) }] });
      setTransferKey(uid());
      setTransfer({ from: "", to: "", product_id: "", quantity: "" });
    }, "Stock transfer completed and ledger updated.");
  };

  const saveOrder = (event) => {
    event.preventDefault();
    const minor = Math.round(Number(order.unit_cost || 0) * (10 ** digits(account.currency_code)));
    run(async () => {
      await call({ action: "mutate", operation: "create_purchase_order", values: {
        supplier_name: order.supplier_name.trim(), supplier_reference: order.supplier_reference.trim() || null,
        currency_code: account.currency_code, order_date: dateOnly(), expected_date: order.expected_date || null,
        items: [{ product_id: order.product_id, quantity_ordered: Number(order.quantity), unit_cost_minor: minor }],
      }});
      setOrder({ supplier_name: "", supplier_reference: "", expected_date: "", product_id: "", quantity: "1", unit_cost: "" });
    }, "Purchase order created.");
  };

  const receiveOrder = (event) => {
    event.preventDefault();
    const item = selectedOrderItems.find((i) => i.id === receipt.item_id);
    if (!item) { setError("Select an outstanding purchase-order item."); return; }
    run(async () => {
      await call({ action: "mutate", operation: "receive_purchase_order", values: {
        purchase_order_id: receipt.order_id, warehouse_id: receipt.warehouse_id, idempotency_key: receiptKey,
        items: [{ purchase_order_item_id: item.id, quantity: Number(receipt.quantity),
          batch_number: receipt.batch_number.trim() || null, expires_on: receipt.expires_on || null }],
      }});
      setReceiptKey(uid());
      setReceipt({ order_id: receipt.order_id, warehouse_id: receipt.warehouse_id, item_id: "", quantity: "", batch_number: "", expires_on: "" });
    }, "Goods received. Warehouse stock and movement history updated.");
  };

  const tabs = [{ id: "crm", label: "CRM" }, { id: "warehouses", label: "Warehouses" }, { id: "transfers", label: "Stock transfers" }, { id: "purchasing", label: "Purchasing" }, { id: "movements", label: "Movement history" }];

  return <section className="mt-6 space-y-5">
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.id} onClick={() => setSection(item.id)} className={section === item.id ? button : secondary}>{item.label}</button>)}<button className={secondary} onClick={() => refresh().catch((e) => setError(e.message))}>Refresh</button></div>
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
      <form onSubmit={saveWarehouse} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">Add warehouse</h2>
        <input required className={input} placeholder="Code (e.g. MAIN)" value={warehouse.code} onChange={(e) => setWarehouse({ ...warehouse, code: e.target.value })}/>
        <input required className={input} placeholder="Warehouse name" value={warehouse.name} onChange={(e) => setWarehouse({ ...warehouse, name: e.target.value })}/>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={warehouse.is_default} onChange={(e) => setWarehouse({ ...warehouse, is_default: e.target.checked })}/> Default warehouse</label>
        <button disabled={busy} className={button}>Create warehouse</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Inventory valuation</p><p className="mt-1 text-2xl font-bold">{money(data.stock.reduce((sum,s)=>sum+Number(s.quantity||0)*Number(productMap.get(s.product_id)?.purchase_cost_minor||0),0),account.currency_code)}</p></div>{data.warehouses.map((w)=><div key={w.id} className="rounded-xl border bg-white p-4"><div className="font-semibold">{w.name} {w.is_default && <span className="text-xs text-violet-700">· Default</span>}</div><p className="mt-1 text-sm text-slate-500">{w.code} · {w.is_active ? "Active" : "Inactive"}</p><p className="mt-2 text-sm">Stock lines: {data.stock.filter((s)=>s.warehouse_id===w.id).length}</p></div>)}</div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Product</th><th className="p-3 text-left">Warehouse</th><th className="p-3 text-left">Quantity</th><th className="p-3 text-left">Reorder level</th></tr></thead><tbody className="divide-y">{data.stock.map((s)=><tr key={s.warehouse_id+s.product_id}><td className="p-3">{productMap.get(s.product_id)?.name || s.product_id}</td><td className="p-3">{data.warehouses.find((w)=>w.id===s.warehouse_id)?.name || "—"}</td><td className="p-3">{s.quantity}</td><td className="p-3">{s.reorder_level}</td></tr>)}</tbody></table></div>
    </>}

    {section === "transfers" && <>
      <form onSubmit={saveTransfer} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-5">Transfer stock between warehouses</h2>
        <select required className={input} value={transfer.from} onChange={(e)=>setTransfer({...transfer,from:e.target.value})}><option value="">From warehouse</option>{data.warehouses.filter((w)=>w.is_active).map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={transfer.to} onChange={(e)=>setTransfer({...transfer,to:e.target.value})}><option value="">To warehouse</option>{data.warehouses.filter((w)=>w.is_active && w.id!==transfer.from).map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={transfer.product_id} onChange={(e)=>setTransfer({...transfer,product_id:e.target.value})}><option value="">Product</option>{data.products.map((p)=><option key={p.id} value={p.id}>{p.name} {p.sku ? "· "+p.sku : ""}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Quantity" value={transfer.quantity} onChange={(e)=>setTransfer({...transfer,quantity:e.target.value})}/>
        <button disabled={busy || !data.warehouses.length || !data.products.length} className={button}>Transfer stock</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">From</th><th className="p-3 text-left">To</th><th className="p-3 text-left">Status</th></tr></thead><tbody className="divide-y">{data.transfers.map((t)=><tr key={t.id}><td className="p-3">{new Date(t.created_at).toLocaleString()}</td><td className="p-3">{data.warehouses.find((w)=>w.id===t.from_warehouse_id)?.name || "—"}</td><td className="p-3">{data.warehouses.find((w)=>w.id===t.to_warehouse_id)?.name || "—"}</td><td className="p-3 capitalize">{t.status}</td></tr>)}</tbody></table></div>
    </>}

    {section === "purchasing" && <>
      <form onSubmit={saveOrder} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-3">Create purchase order</h2>
        <input required className={input} placeholder="Supplier name" value={order.supplier_name} onChange={(e)=>setOrder({...order,supplier_name:e.target.value})}/>
        <input className={input} placeholder="Supplier reference" value={order.supplier_reference} onChange={(e)=>setOrder({...order,supplier_reference:e.target.value})}/>
        <input type="date" className={input} value={order.expected_date} onChange={(e)=>setOrder({...order,expected_date:e.target.value})}/>
        <select required className={input} value={order.product_id} onChange={(e)=>setOrder({...order,product_id:e.target.value})}><option value="">Choose product</option>{data.products.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Quantity" value={order.quantity} onChange={(e)=>setOrder({...order,quantity:e.target.value})}/>
        <input required type="number" min="0" step="0.01" className={input} placeholder={`Unit cost (${account.currency_code})`} value={order.unit_cost} onChange={(e)=>setOrder({...order,unit_cost:e.target.value})}/>
        <button disabled={busy || !data.products.length} className={button+" sm:col-span-2 lg:col-span-3"}>Create purchase order</button>
      </form>
      <form onSubmit={receiveOrder} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-3">Receive goods into warehouse</h2>
        <select required className={input} value={receipt.order_id} onChange={(e)=>setReceipt({...receipt,order_id:e.target.value,item_id:""})}><option value="">Purchase order</option>{data.orders.filter((o)=>["ordered","partially_received"].includes(o.status)).map((o)=><option key={o.id} value={o.id}>{o.supplier_name} · {o.status}</option>)}</select>
        <select required className={input} value={receipt.warehouse_id} onChange={(e)=>setReceipt({...receipt,warehouse_id:e.target.value})}><option value="">Warehouse</option>{data.warehouses.filter((w)=>w.is_active).map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={input} value={receipt.item_id} onChange={(e)=>setReceipt({...receipt,item_id:e.target.value})}><option value="">Order line</option>{selectedOrderItems.map((i)=><option key={i.id} value={i.id}>{productMap.get(i.product_id)?.name || "Product"} · remaining {(Number(i.quantity_ordered)-Number(i.quantity_received)).toFixed(4)}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={input} placeholder="Received quantity" value={receipt.quantity} onChange={(e)=>setReceipt({...receipt,quantity:e.target.value})}/>
        <input className={input} placeholder="Batch number (optional)" value={receipt.batch_number} onChange={(e)=>setReceipt({...receipt,batch_number:e.target.value})}/>
        <input type="date" className={input} value={receipt.expires_on} onChange={(e)=>setReceipt({...receipt,expires_on:e.target.value})}/>
        <button disabled={busy || !selectedOrderItems.length || !receipt.warehouse_id} className={button+" sm:col-span-2 lg:col-span-3"}>Receive goods</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Supplier</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Order value</th><th className="p-3 text-left">Status</th></tr></thead><tbody className="divide-y">{data.orders.map((o)=><tr key={o.id}><td className="p-3 font-medium">{o.supplier_name}</td><td className="p-3">{o.order_date}</td><td className="p-3">{money(o.subtotal_minor, o.currency_code)}</td><td className="p-3 capitalize">{o.status.replaceAll("_"," ")}</td></tr>)}</tbody></table></div>
    </>}

    {section === "movements" && <>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Date","Product","Warehouse","Movement","Quantity change","Reference"].map((x)=><th key={x} className="whitespace-nowrap p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{data.movements.map((m)=><tr key={m.id}><td className="whitespace-nowrap p-3">{new Date(m.created_at).toLocaleString()}</td><td className="p-3">{productMap.get(m.product_id)?.name || m.product_id}</td><td className="p-3">{data.warehouses.find((w)=>w.id===m.warehouse_id)?.name || "—"}</td><td className="p-3">{m.movement_type.replaceAll("_"," ")}</td><td className="p-3">{Number(m.quantity_delta)>0?"+":""}{m.quantity_delta}</td><td className="p-3">{m.reference_type}</td></tr>)}</tbody></table>{!data.movements.length && <p className="p-6 text-center text-sm text-slate-500">No stock movements recorded.</p>}</div>
      <div className="overflow-x-auto rounded-xl border bg-white"><h3 className="border-b p-3 font-semibold">Batch and expiry tracking</h3><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Product</th><th className="p-3 text-left">Batch</th><th className="p-3 text-left">Quantity</th><th className="p-3 text-left">Expiry</th></tr></thead><tbody className="divide-y">{data.batches.map((b)=><tr key={b.id}><td className="p-3">{productMap.get(b.product_id)?.name || b.product_id}</td><td className="p-3">{b.batch_number}</td><td className="p-3">{b.quantity}</td><td className="p-3">{b.expires_on || "—"}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
