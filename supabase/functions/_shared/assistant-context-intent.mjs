const OVERVIEW_PATTERN = /\b(workspace|work space|my data|my records|all records|all data|team|members|accounting|reminder|activity)\b|कार्यक्षेत्र|मेरा डेटा|मेरे रिकॉर्ड|सभी रिकॉर्ड/i;
const INVOICE_ITEMS_PATTERN = /\b(invoice|invoices|bill|billing|line item|item-wise|invoice detail)\b|इनवॉइस|बिल/i;
const LEAD_ACTIVITIES_PATTERN = /\b(lead|follow.?up|lead history|lead activity)\b|लीड|फॉलो.?अप/i;
const RECEIPT_ITEMS_PATTERN = /\b(purchase receipt|goods receipt|receipt item|received item)\b|माल प्राप्त|रसीद की वस्तु/i;
const REMINDERS_PATTERN = /\b(reminders?|remind|notification|due alert)\b|रिमाइंडर|याद दिला/i;
const STOCK_ALLOCATIONS_PATTERN = /\b(stock allocation|allocated stock|invoice stock|stock allocated)\b|स्टॉक आवंटन/i;
const ACCOUNTING_PATTERN = /\b(accounting|chart of accounts|account code|account head|ledger account)\b|लेखा|खाता शीर्ष/i;
const WORKSPACE_SETTINGS_PATTERN = /\b(workspace settings|country code|locale|currency|workspace type)\b|कार्यस्थल सेटिंग/i;
const MEMBERS_PATTERN = /\b(team|member|members|staff|employee)\b|टीम|कर्मचारी|सदस्य/i;

export function detectSupplementaryContextNeeds(userText = "") {
  const overviewRequest = OVERVIEW_PATTERN.test(userText);
  return {
    overviewRequest,
    wantsInvoiceItems: overviewRequest || INVOICE_ITEMS_PATTERN.test(userText),
    wantsLeadActivities: overviewRequest || LEAD_ACTIVITIES_PATTERN.test(userText),
    wantsReceiptItems: overviewRequest || RECEIPT_ITEMS_PATTERN.test(userText),
    wantsReminders: overviewRequest || REMINDERS_PATTERN.test(userText),
    wantsStockAllocations: overviewRequest || STOCK_ALLOCATIONS_PATTERN.test(userText),
    wantsAccounting: overviewRequest || ACCOUNTING_PATTERN.test(userText),
    wantsWorkspaceSettings: overviewRequest || WORKSPACE_SETTINGS_PATTERN.test(userText),
    wantsMembers: overviewRequest || MEMBERS_PATTERN.test(userText),
  };
}
