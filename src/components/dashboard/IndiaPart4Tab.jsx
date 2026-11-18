import { formatMoney } from "@/lib/currency";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";
import { ArrowLeftRight, ClipboardList, History, Plus, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const primary = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700";
const newKey = () => crypto.randomUUID();
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function IndiaPart4Tab({ user }) {
  const [workspaceId,setWorkspaceId]=useState("");
  const [tab,setTab]=useState("warehouses");
  const [warehouses,setWarehouses]=useState([]);
  const [stock,setStock]=useState([]);
  const [orders,setOrders]=useState([]);
  const [orderItems,setOrderItems]=useState([]);
  const [movements,setMovements]=useState([]);
  const [batches,setBatches]=useState([]);
  const [transfers,setTransfers]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [warehouseForm,setWarehouseForm]=useState({code:"",name:""});
  const [po,setPo]=useState({supplier:"",reference:"",stockId:"",quantity:"1",unitCost:"",expected:""});
  const [receipt,setReceipt]=useState({orderId:"",warehouseId:"",itemId:"",quantity:"",batch:"",expiry:""});
  const [transfer,setTransfer]=useState({stockId:"",warehouseId:"",quantity:""});
  const [receiptKey,setReceiptKey]=useState(newKey());
  const [transferKey,setTransferKey]=useState(newKey());
  const [showWarehouseForm,setShowWarehouseForm]=useState(false);
  const [showOrderForm,setShowOrderForm]=useState(false);
  const [showReceiptForm,setShowReceiptForm]=useState(false);
  const [showTransferForm,setShowTransferForm]=useState(false);
  const [movementQuery,setMovementQuery]=useState("");
  const [movementType,setMovementType]=useState("all");
  const [movementFrom,setMovementFrom]=useState("");
  const [movementTo,setMovementTo]=useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const tables=["warehouses","stock","purchase_orders","purchase_order_items","stock_movements","stock_transfers","inventory_batches"];
    const results=await Promise.all(tables.map(async (table)=>{
      const {data,error}=await supabase.from(table).select("*").eq("workspace_id",workspaceId).order(table==="purchase_order_items"?"id":"created_at",{ascending:false}).limit(500);
      if(error) throw error;
      return [table,data||[]];
    }));
    const m=Object.fromEntries(results);
    setWarehouses(m.warehouses);setStock(m.stock);setOrders(m.purchase_orders);
    setOrderItems(m.purchase_order_items);setMovements(m.stock_movements);setTransfers(m.stock_transfers);setBatches(m.inventory_batches);
  },[workspaceId]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      if(!user?.id) return;
      const {data,error}=await supabase.from("profiles").select("workspace_id").eq("id",user.id).single();
      if(error) throw error;
      if(active) setWorkspaceId(data.workspace_id);
    })().catch(e=>{if(active)setError(e.message||"Could not load workspace.");});
    return ()=>{active=false;};
  },[user?.id]);
  useEffect(()=>{refresh().catch(e=>setError(e.message||"Could not load warehouse records."));},[refresh]);

  const productName=useCallback((id)=>{const item=stock.find(x=>x.id===id);return item ? `${item.name}${item.variant_label ? " · "+item.variant_label : ""}` : "Stock item";},[stock]);
  const openItems=orderItems.filter(x=>x.purchase_order_id===receipt.orderId && Number(x.quantity_received)<Number(x.quantity_ordered));
  const selectedStock=stock.find(x=>x.id===transfer.stockId);

  const run=async(fn,success)=>{
    setBusy(true);setError("");setNotice("");
    try{await fn();setNotice(success);try{await refresh();}catch{setError("Saved, but the latest records could not be refreshed. Tap Refresh.");}return true;}
    catch(e){setError(e.message||"The operation could not be completed.");return false;}
    finally{setBusy(false);}
  };

  const addWarehouse=(e)=>{
    e.preventDefault();
    return run(async()=>{
      const {error}=await supabase.from("warehouses").insert({workspace_id:workspaceId,code:warehouseForm.code.trim().toUpperCase(),name:warehouseForm.name.trim(),is_default:false});
      if(error) throw error;
      setWarehouseForm({code:"",name:""});
    },"Warehouse created.");
  };

  const createOrder=(e)=>{
    e.preventDefault();
    return run(async()=>{
      const {data,error}=await supabase.rpc("india_part4_create_purchase_order",{
        p_supplier_name:po.supplier.trim(),
        p_items:[{stock_id:po.stockId,quantity_ordered:Number(po.quantity),unit_cost:Number(po.unitCost)}],
        p_supplier_reference:po.reference.trim()||null,
        p_expected_date:po.expected||null,
        p_notes:null,
      });
      if(error) throw error;
      if(!data?.ok) throw new Error(data?.reason||"Purchase order could not be created.");
      setPo({supplier:"",reference:"",stockId:"",quantity:"1",unitCost:"",expected:""});
    },"Purchase order created.");
  };

  const receiveGoods=(e)=>{
    e.preventDefault();
    return run(async()=>{
      const {data,error}=await supabase.rpc("india_part4_receive_purchase_order",{
        p_purchase_order_id:receipt.orderId,p_warehouse_id:receipt.warehouseId,p_idempotency_key:receiptKey,
        p_items:[{purchase_order_item_id:receipt.itemId,quantity:Number(receipt.quantity),batch_number:receipt.batch.trim()||null,expires_on:receipt.expiry||null}],
      });
      if(error) throw error;
      if(!data?.ok) throw new Error(data?.reason||"Goods receipt failed.");
      setReceiptKey(newKey());
      setReceipt({...receipt,itemId:"",quantity:"",batch:"",expiry:""});
    },"Goods received and stock movement recorded.");
  };

  const moveStock=(e)=>{
    e.preventDefault();
    return run(async()=>{
      const {data,error}=await supabase.rpc("india_part4_transfer_stock",{
        p_stock_id:transfer.stockId,p_to_warehouse_id:transfer.warehouseId,
        p_quantity:Number(transfer.quantity),p_idempotency_key:transferKey,
      });
      if(error) throw error;
      if(!data?.ok) throw new Error(data?.reason||"Stock transfer failed.");
      setTransferKey(newKey());
      setTransfer({stockId:"",warehouseId:"",quantity:""});
    },"Stock transferred. Both warehouse movements were recorded.");
  };

  const valuation=useMemo(()=>stock.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(row.purchase_cost||0),0),[stock]);
  const movementTypes=useMemo(()=>[...new Set(movements.map(item=>item.movement_type).filter(Boolean))].sort(),[movements]);
  const filteredMovements=useMemo(()=>movements.filter(item=>{
    const name=productName(item.stock_id).toLowerCase();
    const day=String(item.created_at||"").slice(0,10);
    return name.includes(movementQuery.trim().toLowerCase())
      && (movementType==="all"||item.movement_type===movementType)
      && (!movementFrom||day>=movementFrom)
      && (!movementTo||day<=movementTo);
  }).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),[movements,movementQuery,movementType,movementFrom,movementTo,productName]);
  const tabs=[["warehouses","Stock & warehouses",WarehouseIcon],["transfers","Transfers",ArrowLeftRight],["purchasing","Purchase orders",ClipboardList],["history","Movement history",History]];

  return <div className="space-y-5">
    <div className="overflow-hidden rounded-2xl border border-[#E7E2F2] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8B7AAE]">Plivex workspace / Inventory</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Inventory & procurement</h2><p className="mt-1 text-xs text-slate-500 sm:text-sm">Stock, warehouses, transfers and purchasing in one connected workspace.</p></div>
        <button type="button" className={secondary+" inline-flex items-center gap-2"} onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw className="h-4 w-4"/>Refresh data</button>
      </div>
      <nav aria-label="Inventory workspace sections" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 pt-2 sm:px-4">
        {tabs.map(([id,label,Icon])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${tab===id?"border-[#6D28D9] text-[#6D28D9]":"border-transparent text-slate-500 hover:border-violet-200 hover:text-slate-800"}`}><Icon className="h-4 w-4"/>{label}</button>)}
      </nav>
    </div>
    <div className="rounded-xl border border-[#E7E2F2] bg-white px-4 py-3">
      <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-3 sm:divide-x sm:divide-slate-100">
        <div className="pr-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Stock items</p><p className="mt-1 text-xl font-bold text-slate-900">{stock.length}</p></div>
        <div className="sm:px-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Warehouses</p><p className="mt-1 text-xl font-bold text-slate-900">{warehouses.length}</p></div>
        <div className="sm:pl-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Stock valuation*</p><p className="mt-1 text-xl font-bold text-[#6D28D9]">{formatMoney(valuation, user?.currency_code || "INR", user?.locale_code)}</p></div>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">*Indicative value using the current stock purchase-cost field.</p>
    </div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    {tab==="purchasing"&&<>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">Purchase order register</h3><p className="text-xs text-slate-500">Supplier commitments, partial receipts and incoming stock.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={()=>setShowReceiptForm(v=>!v)}>Receive goods</button><button type="button" className={primary+" inline-flex items-center gap-2"} onClick={()=>setShowOrderForm(v=>!v)}><Plus className="h-4 w-4"/>{showOrderForm?"Close form":"New purchase order"}</button></div></div>
      {showOrderForm&&<form onSubmit={async e=>{if(await createOrder(e))setShowOrderForm(false);}} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <input required className={field} placeholder="Supplier name" value={po.supplier} onChange={e=>setPo({...po,supplier:e.target.value})}/>
        <input className={field} placeholder="Supplier reference (optional)" value={po.reference} onChange={e=>setPo({...po,reference:e.target.value})}/>
        <input type="date" className={field} value={po.expected} onChange={e=>setPo({...po,expected:e.target.value})}/>
        <select required className={field} value={po.stockId} onChange={e=>setPo({...po,stockId:e.target.value})}><option value="">Select stock item</option>{stock.map(s=><option key={s.id} value={s.id}>{s.name} · {s.sku||"No SKU"}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={field} placeholder="Quantity" value={po.quantity} onChange={e=>setPo({...po,quantity:e.target.value})}/>
        <input required type="number" min="0" step="0.0001" className={field} placeholder={`Unit cost (${user?.currency_code || "INR"})`} value={po.unitCost} onChange={e=>setPo({...po,unitCost:e.target.value})}/>
        <button disabled={busy||!stock.length} className={primary+" sm:col-span-2 lg:col-span-3"}>Save purchase order</button>
      </form>}
      {showReceiptForm&&<form onSubmit={async e=>{if(await receiveGoods(e))setShowReceiptForm(false);}} className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <select required className={field} value={receipt.orderId} onChange={e=>setReceipt({...receipt,orderId:e.target.value,itemId:""})}><option value="">Select order</option>{orders.filter(o=>["ordered","partially_received"].includes(o.status)).map(o=><option key={o.id} value={o.id}>{o.supplier_name} · {o.status}</option>)}</select>
        <select required className={field} value={receipt.warehouseId} onChange={e=>setReceipt({...receipt,warehouseId:e.target.value})}><option value="">Select warehouse</option>{warehouses.filter(w=>w.is_active).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={field} value={receipt.itemId} onChange={e=>setReceipt({...receipt,itemId:e.target.value})}><option value="">Select order line</option>{openItems.map(i=><option key={i.id} value={i.id}>{productName(i.stock_id)} · remaining {(Number(i.quantity_ordered)-Number(i.quantity_received)).toFixed(4)}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={field} placeholder="Received quantity" value={receipt.quantity} onChange={e=>setReceipt({...receipt,quantity:e.target.value})}/>
        <input className={field} placeholder="Batch number (optional)" value={receipt.batch} onChange={e=>setReceipt({...receipt,batch:e.target.value})}/>
        <input type="date" className={field} value={receipt.expiry} onChange={e=>setReceipt({...receipt,expiry:e.target.value})}/>
        <button disabled={busy||!openItems.length||!warehouses.length} className={primary+" sm:col-span-2 lg:col-span-3"}>Confirm goods receipt</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[620px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Supplier","Order date","Expected","Status"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{orders.map(o=><tr key={o.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold">{o.supplier_name}</td><td className="px-4 py-3 text-slate-500">{o.order_date}</td><td className="px-4 py-3">{o.expected_date||"—"}</td><td className="px-4 py-3 capitalize">{o.status.replaceAll("_"," ")}</td></tr>)}</tbody></table>{!orders.length&&<p className="p-8 text-center text-sm text-slate-500">No purchase orders yet. Create an order to track incoming stock.</p>}</div>
    </>}

    {tab==="warehouses"&&<>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">Warehouse locations</h3><p className="text-xs text-slate-500">Manage locations and review stock held at each one.</p></div><button type="button" className={primary+" inline-flex items-center gap-2"} onClick={()=>setShowWarehouseForm(v=>!v)}><Plus className="h-4 w-4"/>{showWarehouseForm?"Close form":"Add warehouse"}</button></div>
      {showWarehouseForm&&<form onSubmit={async e=>{if(await addWarehouse(e))setShowWarehouseForm(false);}} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-3">
        <input required className={field} placeholder="Warehouse code" value={warehouseForm.code} onChange={e=>setWarehouseForm({...warehouseForm,code:e.target.value})}/>
        <input required className={field} placeholder="Warehouse name" value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm,name:e.target.value})}/>
        <button disabled={busy} className={primary}>Save warehouse</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[620px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Warehouse","Code","Stock lines","Status","Default"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{warehouses.map(w=><tr key={w.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold">{w.name}</td><td className="px-4 py-3 text-slate-500">{w.code}</td><td className="px-4 py-3 tabular-nums">{stock.filter(item=>item.warehouse_id===w.id).length}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${w.is_active?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{w.is_active?"Active":"Inactive"}</span></td><td className="px-4 py-3 text-slate-500">{w.is_default?"Default":"—"}</td></tr>)}</tbody></table>{!warehouses.length&&<p className="p-8 text-center text-sm text-slate-500">No warehouse locations yet. Add your first warehouse to start tracking stock by location.</p>}</div>
      <div><div className="mb-2 flex items-end justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">Stock by location</h3><p className="text-xs text-slate-500">Current quantities, SKU details and reorder thresholds.</p></div><span className="text-xs text-slate-400">{stock.length} lines</span></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[680px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Item","Warehouse","Quantity","Low-stock level","Status"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{stock.map(item=>{const low=Number(item.quantity||0)<=Number(item.low_stock||0);return <tr key={item.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-semibold">{item.name}{item.variant_label?<span className="ml-1 text-xs font-normal text-violet-700">· {item.variant_label}</span>:null}{item.barcode?<span className="block text-xs font-normal text-slate-400">{item.barcode}</span>:null}</td><td className="px-4 py-3 text-slate-500">{warehouses.find(w=>w.id===item.warehouse_id)?.name||"—"}</td><td className="px-4 py-3 font-semibold tabular-nums">{item.quantity} {item.unit||""}</td><td className="px-4 py-3 text-slate-500 tabular-nums">{item.low_stock}</td><td className="px-4 py-3">{low?<span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Reorder</span>:<span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Healthy</span>}</td></tr>;})}</tbody></table>{!stock.length&&<p className="p-8 text-center text-sm text-slate-500">Stock records will appear here as products are added and received.</p>}</div>
      </div>
    </>}

    {tab==="transfers"&&<>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">Stock transfer register</h3><p className="text-xs text-slate-500">Move stock between warehouse locations with a recorded source and destination.</p></div><button type="button" className={primary+" inline-flex items-center gap-2"} onClick={()=>setShowTransferForm(v=>!v)}><Plus className="h-4 w-4"/>{showTransferForm?"Close form":"New transfer"}</button></div>
      {showTransferForm&&<form onSubmit={async e=>{if(await moveStock(e))setShowTransferForm(false);}} className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:grid-cols-3">
        <select required className={field} value={transfer.stockId} onChange={e=>setTransfer({...transfer,stockId:e.target.value})}><option value="">Select source stock</option>{stock.filter(s=>Number(s.quantity)>0).map(s=><option key={s.id} value={s.id}>{s.name} · {warehouses.find(w=>w.id===s.warehouse_id)?.name} · {s.quantity}</option>)}</select>
        <select required className={field} value={transfer.warehouseId} onChange={e=>setTransfer({...transfer,warehouseId:e.target.value})}><option value="">Destination warehouse</option>{warehouses.filter(w=>w.is_active&&w.id!==selectedStock?.warehouse_id).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input required type="number" min="0.0001" max={selectedStock?.quantity||undefined} step="0.0001" className={field} placeholder="Quantity to transfer" value={transfer.quantity} onChange={e=>setTransfer({...transfer,quantity:e.target.value})}/>
        <button disabled={busy||!selectedStock||!transfer.warehouseId} className={primary+" sm:col-span-3"}>Confirm stock transfer</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[620px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Date","From","To","Reference"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{transfers.map(t=><tr key={t.id} className="hover:bg-violet-50/30"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(t.created_at).toLocaleString()}</td><td className="px-4 py-3 font-medium">{warehouses.find(w=>w.id===t.from_warehouse_id)?.name||"—"}</td><td className="px-4 py-3 font-medium">{warehouses.find(w=>w.id===t.to_warehouse_id)?.name||"—"}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{t.id.slice(0,8)}</td></tr>)}</tbody></table>{!transfers.length&&<p className="p-8 text-center text-sm text-slate-500">No transfers recorded yet.</p>}</div>
    </>}

    {tab==="history"&&<>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="min-w-[190px] flex-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search movement<input className={field+" mt-1"} value={movementQuery} onChange={e=>setMovementQuery(e.target.value)} placeholder="Product, SKU or reference"/></label>
        <label className="min-w-[150px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Movement type<select className={field+" mt-1"} value={movementType} onChange={e=>setMovementType(e.target.value)}><option value="all">All types</option>{movementTypes.map(type=><option key={type} value={type}>{type.replaceAll("_"," ")}</option>)}</select></label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">From<input type="date" className={field+" mt-1"} value={movementFrom} onChange={e=>setMovementFrom(e.target.value)}/></label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">To<input type="date" className={field+" mt-1"} value={movementTo} onChange={e=>setMovementTo(e.target.value)}/></label>
        <button type="button" className={secondary} onClick={()=>{setMovementQuery("");setMovementType("all");setMovementFrom("");setMovementTo("");}}>Clear filters</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold">Stock movement ledger</h3><p className="text-xs text-slate-500">Chronological, read-only record of inventory changes.</p></div><span className="text-xs font-semibold text-slate-500">{filteredMovements.length} records</span></div><table className="w-full min-w-[720px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Date & time","Item","Warehouse","Movement","Change","Reference"].map(x=><th key={x} className="whitespace-nowrap px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filteredMovements.map(m=><tr key={m.id} className="hover:bg-violet-50/30"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(m.created_at).toLocaleString()}</td><td className="px-4 py-3 font-semibold">{productName(m.stock_id)}</td><td className="px-4 py-3">{warehouses.find(w=>w.id===m.warehouse_id)?.name||"—"}</td><td className="px-4 py-3 capitalize">{m.movement_type.replaceAll("_"," ")}</td><td className={`px-4 py-3 font-semibold tabular-nums ${Number(m.quantity_delta)>0?"text-emerald-700":"text-rose-700"}`}>{m.quantity_delta>0?"+":""}{m.quantity_delta}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{m.reference_type||"—"}</td></tr>)}</tbody></table>{!filteredMovements.length&&<p className="p-8 text-center text-sm text-slate-500">No movements match these filters.</p>}</div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold">Batch & expiry register</h3><p className="text-xs text-slate-500">Received batches and their remaining quantities.</p></div><table className="w-full min-w-[620px] text-sm"><thead className="bg-[#F8F7FC] text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{["Item","Warehouse","Batch","Quantity","Expiry"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{batches.map(b=><tr key={b.id} className="hover:bg-violet-50/30"><td className="px-4 py-3 font-medium">{productName(b.stock_id)}</td><td className="px-4 py-3">{warehouses.find(w=>w.id===b.warehouse_id)?.name||"—"}</td><td className="px-4 py-3">{b.batch_number}</td><td className="px-4 py-3 text-right tabular-nums">{b.quantity}</td><td className="px-4 py-3">{b.expires_on||"—"}</td></tr>)}</tbody></table>{!batches.length&&<p className="p-6 text-center text-sm text-slate-500">No batch records yet.</p>}</div>
    </>}
  </div>;
}
