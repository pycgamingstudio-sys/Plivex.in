import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCashflowForecast, buildCustomBusinessReport, buildSalesTrend } from "../analytics/business-insights.js";

const invoices=[
 {number:"INV-1",issueDate:"2026-10-05",dueDate:"2026-11-25",clientName:"A Ltd",total:1180,amountPaid:500,currency:"INR",status:"Pending"},
 {number:"INV-2",issueDate:"2026-10-10",dueDate:"2026-12-05",clientName:"B Ltd",total:590,currency:"INR",status:"Paid"},
 {number:"INV-3",issueDate:"2026-09-10",dueDate:"2026-10-10",clientName:"A Ltd",total:1000,currency:"USD",status:"Pending"},
 {number:"INV-D",issueDate:"2026-10-12",dueDate:"2026-11-20",total:200,currency:"INR",status:"Draft"},
];
const expenses=[
 {date:"2026-08-02",vendor:"Rent",category:"Rent",amount:300,currencyCode:"INR"},
 {date:"2026-09-02",vendor:"Rent",category:"Rent",amount:330,currencyCode:"INR"},
 {date:"2026-10-02",vendor:"Utilities",category:"Utilities",amount:270,currencyCode:"INR"},
];

test("custom BI report groups selected metric by month/customer/category and isolates currency",()=>{
 const rows=buildCustomBusinessReport({invoices,expenses,metric:"revenue",groupBy:"party",currency:"INR"});
 assert.deepEqual(rows.map(x=>x.label),["A Ltd","B Ltd"]);
 assert.equal(rows[0].amount,1180);
 assert.equal(rows[1].amount,590);
 const category=buildCustomBusinessReport({invoices,expenses,metric:"expenses",groupBy:"category",currency:"INR"});
 assert.equal(category.find(x=>x.label==="Rent").amount,630);
});

test("custom BI collected and outstanding metrics include partial receipts and exclude drafts",()=>{
 const collected=buildCustomBusinessReport({invoices,expenses,metric:"collected",groupBy:"month",currency:"INR",isPaid:(x)=>x.status==="Paid"});
 const outstanding=buildCustomBusinessReport({invoices,expenses,metric:"outstanding",groupBy:"month",currency:"INR",isPaid:(x)=>x.status==="Paid"});
 assert.equal(collected.reduce((sum,x)=>sum+x.amount,0),1090);
 assert.equal(outstanding.reduce((sum,x)=>sum+x.amount,0),680);
});

test("cashflow forecast includes known receivables and trailing expense average",()=>{
 const rows=buildCashflowForecast({invoices,expenses,currency:"INR",asOf:"2026-11-22",isPaid:(x)=>x.status==="Paid",months:3});
 assert.equal(rows[0].expectedInflows,680);
 assert.equal(rows[0].projectedExpenses,300);
 assert.equal(rows[1].expectedInflows,0);
 assert.equal(rows[0].netCashflow,380);
});

test("sales trend returns monthly revenue, expenses and period growth",()=>{
 const rows=buildSalesTrend({invoices,expenses,currency:"INR",asOf:"2026-11-22",months:3});
 assert.equal(rows.length,3);
 assert.equal(rows[1].sales,1770);
 assert.equal(rows[1].expenses,270);
});


test("Reports UI exposes custom BI filters and forecast assumptions",async()=>{
 const ui=await readFile(new URL("../../components/dashboard/ReportsTab.jsx",import.meta.url),"utf8");
 assert.match(ui,/Custom business intelligence/);
 assert.match(ui,/Cash-flow forecast and sales trend/);
 assert.match(ui,/previous three calendar months/);
 assert.match(ui,/Export custom report/);
});
