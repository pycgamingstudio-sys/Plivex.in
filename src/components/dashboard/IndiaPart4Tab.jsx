import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const primary = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700";
const newKey = () => crypto.randomUUID();
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function IndiaPart4Tab({ user, initialSection = "purchasing" }) {
  const [workspaceId,setWorkspaceId]=useState("");
  const [tab,setTab]=useState(initialSection);
  useEffect(()=>{ if (["purchasing","warehouses","transfers","history"].includes(initialSection)) setTab(initialSection); },[initialSection]);
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

  const productName=(id)=>{const item=stock.find(x=>x.id===id);return item ? `${item.name}${item.variant_label ? " · "+item.variant_label : ""}` : "Stock item";};
  const selectedOrder=orders.find(x=>x.id===receipt.orderId);
  const openItems=orderItems.filter(x=>x.purchase_order_id===receipt.orderId && Number(x.quantity_received)<Number(x.quantity_ordered));
  const selectedStock=stock.find(x=>x.id===transfer.stockId);
  const canManage=["admin","manager"].includes(user?.role);

  const run=async(fn,success)=>{
    setBusy(true);setError("");setNotice("");
    try{await fn();setNotice(success);try{await refresh();}catch{setError("Saved, but the latest records could not be refreshed. Tap Refresh.");}}
    catch(e){setError(e.message||"The operation could not be completed.");}
    finally{setBusy(false);}
  };

  const addWarehouse=(e)=>{
    e.preventDefault();
    run(async()=>{
      const {error}=await supabase.from("warehouses").insert({workspace_id:workspaceId,code:warehouseForm.code.trim().toUpperCase(),name:warehouseForm.name.trim(),is_default:false});
      if(error) throw error;
      setWarehouseForm({code:"",name:""});
    },"Warehouse created.");
  };

  const createOrder=(e)=>{
    e.preventDefault();
    run(async()=>{
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
    run(async()=>{
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
    run(async()=>{
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
  const tabs=[["purchasing","Purchase orders"],["warehouses","Warehouses"],["transfers","Stock transfers"],["history","Movement history"]];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-xl font-bold">Inventory & procurement</h2><p className="text-sm text-slate-500">Workspace-scoped warehouse stock, purchasing and auditable movements.</p></div>
      <button className={secondary} onClick={()=>refresh().catch(e=>setError(e.message))}>Refresh</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Stock items</p><p className="mt-1 text-2xl font-bold">{stock.length}</p></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Warehouses</p><p className="mt-1 text-2xl font-bold">{warehouses.length}</p></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Recorded purchase-cost valuation</p><p className="mt-1 text-2xl font-bold">₹{valuation.toLocaleString("en-IN",{maximumFractionDigits:2})}</p><p className="text-xs text-slate-400">Based on the current stock price field</p></div>
    </div>
    <div className="flex flex-wrap gap-2">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={tab===id?primary:secondary}>{label}</button>)}</div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    {tab==="purchasing"&&<>
      <form onSubmit={createOrder} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h3 className="font-semibold sm:col-span-2 lg:col-span-3">Create purchase order</h3>
        <input required className={field} placeholder="Supplier name" value={po.supplier} onChange={e=>setPo({...po,supplier:e.target.value})}/>
        <input className={field} placeholder="Supplier reference" value={po.reference} onChange={e=>setPo({...po,reference:e.target.value})}/>
        <input type="date" className={field} value={po.expected} onChange={e=>setPo({...po,expected:e.target.value})}/>
        <select required className={field} value={po.stockId} onChange={e=>setPo({...po,stockId:e.target.value})}><option value="">Select stock item</option>{stock.map(s=><option key={s.id} value={s.id}>{s.name} · {s.sku||"No SKU"}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={field} placeholder="Quantity" value={po.quantity} onChange={e=>setPo({...po,quantity:e.target.value})}/>
        <input required type="number" min="0" step="0.0001" className={field} placeholder="Unit cost (₹)" value={po.unitCost} onChange={e=>setPo({...po,unitCost:e.target.value})}/>
        <button disabled={busy||!stock.length} className={primary+" sm:col-span-2 lg:col-span-3"}>Create purchase order</button>
      </form>
      <form onSubmit={receiveGoods} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h3 className="font-semibold sm:col-span-2 lg:col-span-3">Receive goods into a warehouse</h3>
        <select required className={field} value={receipt.orderId} onChange={e=>setReceipt({...receipt,orderId:e.target.value,itemId:""})}><option value="">Select order</option>{orders.filter(o=>["ordered","partially_received"].includes(o.status)).map(o=><option key={o.id} value={o.id}>{o.supplier_name} · {o.status}</option>)}</select>
        <select required className={field} value={receipt.warehouseId} onChange={e=>setReceipt({...receipt,warehouseId:e.target.value})}><option value="">Select warehouse</option>{warehouses.filter(w=>w.is_active).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select required className={field} value={receipt.itemId} onChange={e=>setReceipt({...receipt,itemId:e.target.value})}><option value="">Select order line</option>{openItems.map(i=><option key={i.id} value={i.id}>{productName(i.stock_id)} · remaining {(Number(i.quantity_ordered)-Number(i.quantity_received)).toFixed(4)}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" className={field} placeholder="Received quantity" value={receipt.quantity} onChange={e=>setReceipt({...receipt,quantity:e.target.value})}/>
        <input className={field} placeholder="Batch number (optional)" value={receipt.batch} onChange={e=>setReceipt({...receipt,batch:e.target.value})}/>
        <input type="date" className={field} value={receipt.expiry} onChange={e=>setReceipt({...receipt,expiry:e.target.value})}/>
        <button disabled={busy||!openItems.length||!warehouses.length} className={primary+" sm:col-span-2 lg:col-span-3"}>Receive goods</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Supplier","Order date","Expected","Status"].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{orders.map(o=><tr key={o.id}><td className="p-3 font-medium">{o.supplier_name}</td><td className="p-3">{o.order_date}</td><td className="p-3">{o.expected_date||"—"}</td><td className="p-3 capitalize">{o.status.replaceAll("_"," ")}</td></tr>)}</tbody></table>{!orders.length&&<p className="p-5 text-center text-sm text-slate-500">No purchase orders yet.</p>}</div>
    </>}

    {tab==="warehouses"&&<>
      <form onSubmit={addWarehouse} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <input required className={field} placeholder="Warehouse code" value={warehouseForm.code} onChange={e=>setWarehouseForm({...warehouseForm,code:e.target.value})}/>
        <input required className={field} placeholder="Warehouse name" value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm,name:e.target.value})}/>
        <button disabled={busy} className={primary}>Add warehouse</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">{warehouses.map(w=><div key={w.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{w.name} {w.is_default&&<span className="text-xs text-violet-700">· Default</span>}</p><p className="text-sm text-slate-500">{w.code} · {w.is_active?"Active":"Inactive"}</p></div>)}</div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Item","Warehouse","Quantity","Low-stock level"].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{stock.map(s=><tr key={s.id}><td className="p-3">{s.name}{s.variant_label ? <span className="ml-1 text-xs text-violet-700">· {s.variant_label}</span> : null}{s.barcode ? <span className="block text-xs text-slate-400">{s.barcode}</span> : null}</td><td className="p-3">{warehouses.find(w=>w.id===s.warehouse_id)?.name||"—"}</td><td className="p-3">{s.quantity} {s.unit||""}</td><td className="p-3">{s.low_stock}</td></tr>)}</tbody></table></div>
    </>}

    {tab==="transfers"&&<>
      <form onSubmit={moveStock} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <select required className={field} value={transfer.stockId} onChange={e=>setTransfer({...transfer,stockId:e.target.value})}><option value="">Select source stock</option>{stock.filter(s=>Number(s.quantity)>0).map(s=><option key={s.id} value={s.id}>{s.name} · {warehouses.find(w=>w.id===s.warehouse_id)?.name} · {s.quantity}</option>)}</select>
        <select required className={field} value={transfer.warehouseId} onChange={e=>setTransfer({...transfer,warehouseId:e.target.value})}><option value="">Destination warehouse</option>{warehouses.filter(w=>w.is_active&&w.id!==selectedStock?.warehouse_id).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input required type="number" min="0.0001" max={selectedStock?.quantity||undefined} step="0.0001" className={field} placeholder="Quantity to transfer" value={transfer.quantity} onChange={e=>setTransfer({...transfer,quantity:e.target.value})}/>
        <button disabled={busy||!selectedStock||!transfer.warehouseId} className={primary+" sm:col-span-3"}>Transfer stock</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Date","From","To","Reference"].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{transfers.map(t=><tr key={t.id}><td className="p-3">{new Date(t.created_at).toLocaleString()}</td><td className="p-3">{warehouses.find(w=>w.id===t.from_warehouse_id)?.name||"—"}</td><td className="p-3">{warehouses.find(w=>w.id===t.to_warehouse_id)?.name||"—"}</td><td className="p-3">{t.id.slice(0,8)}</td></tr>)}</tbody></table></div>
    </>}

    {tab==="history"&&<><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Date","Item","Warehouse","Movement","Change","Reference"].map(x=><th key={x} className="whitespace-nowrap p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{movements.map(m=><tr key={m.id}><td className="whitespace-nowrap p-3">{new Date(m.created_at).toLocaleString()}</td><td className="p-3">{productName(m.stock_id)}</td><td className="p-3">{warehouses.find(w=>w.id===m.warehouse_id)?.name||"—"}</td><td className="p-3">{m.movement_type.replaceAll("_"," ")}</td><td className="p-3">{m.quantity_delta>0?"+":""}{m.quantity_delta}</td><td className="p-3">{m.reference_type||"—"}</td></tr>)}</tbody></table>{!movements.length&&<p className="p-5 text-center text-sm text-slate-500">No movements recorded yet.</p>}</div><div className="mt-4 overflow-x-auto rounded-xl border bg-white"><h3 className="border-b p-3 font-semibold">Batch & expiry tracking</h3><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Item","Warehouse","Batch","Quantity","Expiry"].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody className="divide-y">{batches.map(b=><tr key={b.id}><td className="p-3">{productName(b.stock_id)}</td><td className="p-3">{warehouses.find(w=>w.id===b.warehouse_id)?.name||"—"}</td><td className="p-3">{b.batch_number}</td><td className="p-3">{b.quantity}</td><td className="p-3">{b.expires_on||"—"}</td></tr>)}</tbody></table>{!batches.length&&<p className="p-4 text-center text-sm text-slate-500">No batch records yet.</p>}</div></>}
  </div>;
}
