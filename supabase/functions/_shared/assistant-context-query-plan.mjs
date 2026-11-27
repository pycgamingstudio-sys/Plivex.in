const matches = (value, pattern) => pattern.test(String(value || "").toLowerCase());

export function getLiveContextQueryPlan(userText = "") {
  const text = String(userText || "").slice(0, 5000);
  const finance = matches(text, /\b(sales|revenue|profit|loss|cash flow|financial|finance|income|turnover|performance|business report|business performance|growth|p&l)\b|बिक्री|मुनाफा|लाभ|नुकसान|कमाई|आमदनी|व्यापार की स्थिति/);
  const invoiceIntent = matches(text, /\b(invoice|invoices|bill|billing|payment|paid|pending|overdue|receivable|outstanding)\b|इनवॉइस|बिल|भुगतान|बकाया/);
  const clientIntent = matches(text, /\b(client|clients|customer|customers|grahak|contact)\b|ग्राहक/);
  const inventoryIntent = matches(text, /\b(stock|inventory|product|products|item|items|warehouse|godown|batch|transfer|low stock)\b|स्टॉक|माल|गोदाम|भंडार/);
  const expenseIntent = matches(text, /\b(expense|expenses|cost|costs|kharcha|kharche|spending)\b|खर्च|व्यय/);
  const quotationIntent = matches(text, /\b(quotation|quotations|quote|quotes|estimate)\b|कोटेशन/);
  const leadIntent = matches(text, /\b(lead|leads|prospect|pipeline)\b|लीड/);
  const serviceIntent = matches(text, /\b(service|services|rate card)\b|सेवा/);
  const purchasingIntent = matches(text, /\b(purchase order|purchase orders|purchasing|supplier|suppliers|receipt|receiving|goods received|procurement)\b|खरीद आदेश|सप्लायर|माल आया/);
  const profileIntent = matches(text, /\b(business profile|company profile|business details|gstin|tax registration|my business|workspace settings|country|currency)\b|व्यवसाय प्रोफाइल|जीएसटीआईएन/);
  const invoiceCreateIntent = matches(text, /\b(create|make|new|draft|prepare|banao|banana)\b.*\b(invoice|bill|quotation|quote)\b|\b(invoice|bill|quotation|quote)\b.*\b(create|make|new|draft|prepare)\b/);

  const inventory = inventoryIntent || purchasingIntent;
  return {
    invoices: invoiceIntent || finance || invoiceCreateIntent,
    clients: clientIntent || (invoiceCreateIntent && matches(text, /\b(client|customer|grahak)\b|ग्राहक/)),
    stock: inventoryIntent || purchasingIntent || invoiceCreateIntent,
    expenses: expenseIntent || finance,
    quotations: quotationIntent || invoiceCreateIntent,
    leads: leadIntent,
    services: serviceIntent || invoiceCreateIntent,
    businessProfile: profileIntent || finance || invoiceIntent || expenseIntent || invoiceCreateIntent,
    purchasing: purchasingIntent,
    inventory,
  };
}
