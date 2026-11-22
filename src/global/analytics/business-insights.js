const amountOf=(value)=>Number.isFinite(Number(value))?Number(value):0;
const dateOf=(value)=>String(value||"").slice(0,10);
const monthOf=(value)=>dateOf(value).slice(0,7);
const validMonth=(value)=>/^\d{4}-\d{2}$/.test(value);
const round2=(value)=>Math.round((value+Number.EPSILON)*100)/100;

export function buildCustomBusinessReport({invoices=[],expenses=[],metric="revenue",groupBy="month",currency="INR",isPaid=()=>false}={}){
  const buckets=new Map();
  const add=(key,amount,count=1)=>{const row=buckets.get(key)||{label:key,amount:0,records:0};row.amount+=amount;row.records+=count;buckets.set(key,row);};
  const validInvoices=(Array.isArray(invoices)?invoices:[]).filter(x=>String(x.currency||"").toUpperCase()===currency&&!["draft","cancelled","canceled","void"].includes(String(x.status||"").toLowerCase()));
  const validExpenses=(Array.isArray(expenses)?expenses:[]).filter(x=>String(x.currencyCode||"").toUpperCase()===currency);
  if(metric==="operating_difference"){
    const monthly=new Map();
    for(const invoice of validInvoices){const month=monthOf(invoice.issueDate);if(!validMonth(month))continue;const row=monthly.get(month)||{sales:0,expenses:0,records:0};row.sales+=amountOf(invoice.total);row.records+=1;monthly.set(month,row);}
    for(const expense of validExpenses){const month=monthOf(expense.date);if(!validMonth(month))continue;const row=monthly.get(month)||{sales:0,expenses:0,records:0};row.expenses+=amountOf(expense.amount);row.records+=1;monthly.set(month,row);}
    return [...monthly.entries()].map(([label,row])=>({label,amount:round2(row.sales-row.expenses),records:row.records,currency})).sort((a,b)=>a.label.localeCompare(b.label));
  }
  if(metric==="expenses"){
    for(const expense of validExpenses){
      const key=groupBy==="month"?monthOf(expense.date):groupBy==="party"?String(expense.vendor||"Unspecified vendor"):String(expense.category||expense.categoryName||"Uncategorised");
      if(key)add(key,amountOf(expense.amount));
    }
  }else{
    for(const invoice of validInvoices){
      const paid=Boolean(isPaid(invoice));
      const total=amountOf(invoice.total);
      const recordedPaid=amountOf(invoice.amountPaid??invoice.amount_paid);
      const paidAmount=Math.min(total,Math.max(0,recordedPaid||(paid?total:0)));
      if(metric==="collected"&&paidAmount<=0)continue;
      if(metric==="outstanding"&&paidAmount>=total)continue;
      const amount=metric==="outstanding"?Math.max(0,total-paidAmount):metric==="collected"?paidAmount:total;
      const key=groupBy==="month"?monthOf(invoice.issueDate):String(invoice.clientName||invoice.client_name||"Unspecified customer");
      if(key)add(key,amount);
    }
  }
  const rows=[...buckets.values()].map(row=>({...row,amount:round2(row.amount),currency}));
  return rows.sort((a,b)=>groupBy==="month"?a.label.localeCompare(b.label):b.amount-a.amount).slice(0,100);
}

export function buildCashflowForecast({invoices=[],expenses=[],currency="INR",asOf=new Date().toISOString().slice(0,10),isPaid=()=>false,months=3}={}){
  const base=new Date(asOf+"T00:00:00.000Z");
  const periods=Array.from({length:Math.max(1,Math.min(6,months))},(_,index)=>{
    const date=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+index,1));
    return {key:date.toISOString().slice(0,7),label:date.toLocaleDateString("en",{month:"short",year:"numeric",timeZone:"UTC"}),expectedInflows:0,projectedExpenses:0,receivableCount:0};
  });
  const byMonth=new Map(periods.map(row=>[row.key,row]));
  const validInvoices=(Array.isArray(invoices)?invoices:[]).filter(x=>String(x.currency||"").toUpperCase()===currency&&!["draft","cancelled","canceled","void"].includes(String(x.status||"").toLowerCase()));
  for(const invoice of validInvoices){
    if(isPaid(invoice))continue;
    const balance=Math.max(0,amountOf(invoice.total)-amountOf(invoice.amountPaid??invoice.amount_paid));
    if(!balance)continue;
    const due=dateOf(invoice.dueDate||invoice.due_date);
    if(!validMonth(monthOf(due))||due.length!==10)continue;
    const key=due<=asOf?periods[0].key:monthOf(due);
    const row=byMonth.get(key);
    if(row){row.expectedInflows+=balance;row.receivableCount+=1;}
  }
  const priorMonths=Array.from({length:3},(_,index)=>{
    const date=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()-(index+1),1));
    return date.toISOString().slice(0,7);
  });
  const expensesByMonth=new Map(priorMonths.map(key=>[key,0]));
  for(const expense of Array.isArray(expenses)?expenses:[]){
    if(String(expense.currencyCode||"").toUpperCase()!==currency)continue;
    const key=monthOf(expense.date);
    if(expensesByMonth.has(key))expensesByMonth.set(key,expensesByMonth.get(key)+amountOf(expense.amount));
  }
  const averageMonthlyExpense=round2([...expensesByMonth.values()].reduce((sum,value)=>sum+value,0)/3);
  return periods.map(row=>({
    ...row,expectedInflows:round2(row.expectedInflows),projectedExpenses:averageMonthlyExpense,
    netCashflow:round2(row.expectedInflows-averageMonthlyExpense),currency
  }));
}

export function buildSalesTrend({invoices=[],expenses=[],currency="INR",asOf=new Date().toISOString().slice(0,10),isPaid=()=>false,months=6}={}){
  const base=new Date(asOf+"T00:00:00.000Z");
  const periods=Array.from({length:Math.max(1,Math.min(12,months))},(_,index)=>{
    const date=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()-(months-1-index),1));
    return {key:date.toISOString().slice(0,7),sales:0,expenses:0};
  });
  const byMonth=new Map(periods.map(row=>[row.key,row]));
  for(const invoice of Array.isArray(invoices)?invoices:[]){
    if(String(invoice.currency||"").toUpperCase()!==currency||["draft","cancelled","canceled","void"].includes(String(invoice.status||"").toLowerCase()))continue;
    const row=byMonth.get(monthOf(invoice.issueDate));if(row)row.sales+=amountOf(invoice.total);
  }
  for(const expense of Array.isArray(expenses)?expenses:[]){
    if(String(expense.currencyCode||"").toUpperCase()!==currency)continue;
    const row=byMonth.get(monthOf(expense.date));if(row)row.expenses+=amountOf(expense.amount);
  }
  return periods.map((row,index)=>({
    ...row,sales:round2(row.sales),expenses:round2(row.expenses),difference:round2(row.sales-row.expenses),
    previousSales:index?round2(periods[index-1].sales):0,
    growthPercent:index&&periods[index-1].sales?round2((row.sales-periods[index-1].sales)/periods[index-1].sales*100):null,
    currency
  }));
}
