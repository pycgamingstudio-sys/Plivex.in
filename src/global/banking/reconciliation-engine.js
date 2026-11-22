const UTR_REGEX = /\b([0-9]{12})\b/;

const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const parseMoney = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[(),₹$£€\s]/g, "").replace(/,/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return 0;
  return negative ? -Math.abs(number) : number;
};

export function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(csvText || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field.trim()); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

export function categorizeBankTransaction(transaction) {
  const text = `${transaction?.narration || ""} ${transaction?.utr || ""}`.toLowerCase();
  const direction = transaction?.amount < 0 ? "debit" : "credit";
  const rules = [
    [/\b(salary|payroll|wages)\b/, "Payroll"],
    [/\b(rent|lease)\b/, "Rent"],
    [/\b(electricity|water bill|gas bill|internet|utility)\b/, "Utilities"],
    [/\b(bank fee|bank charge|commission|service charge)\b/, "Bank fees"],
    [/\b(gst|tds|income tax|tax payment)\b/, "Tax"],
    [/\b(supplier|vendor|purchase|procurement)\b/, "Supplier payment"],
    [/\b(customer|invoice|receipt|collection)\b/, "Customer receipt"],
  ];
  const found = rules.find(([pattern]) => pattern.test(text));
  return {
    category: found ? found[1] : direction === "credit" ? "Unclassified receipt" : "Unclassified payment",
    categoryConfidence: found ? 0.85 : 0.25,
    categorySource: "description_rule",
  };
}

export function parseBankStatementCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const find = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const dateIndex = find([/^date$/, /date$/, /valuedate/]);
  const narrationIndex = find([/narration/, /description/, /particulars/, /details/, /remarks/]);
  const creditIndex = find([/credit/, /deposit/, /paidin/]);
  const debitIndex = find([/debit/, /withdrawal/, /paidout/]);
  const amountIndex = find([/amount/]);
  const referenceIndex = find([/utr/, /reference/, /^ref$/, /transactionid/]);
  const typeIndex = find([/^type$/, /drcr/, /transactiontype/]);
  if (dateIndex < 0 || narrationIndex < 0 || (creditIndex < 0 && debitIndex < 0 && amountIndex < 0)) {
    throw new Error("CSV needs Date, Narration/Description and Amount or Credit/Debit columns.");
  }

  return rows.slice(1).map((cells, index) => {
    const narration = String(cells[narrationIndex] || "").trim();
    const credit = creditIndex >= 0 ? Math.abs(parseMoney(cells[creditIndex])) : 0;
    const debit = debitIndex >= 0 ? Math.abs(parseMoney(cells[debitIndex])) : 0;
    let amount = 0;
    if (creditIndex >= 0 || debitIndex >= 0) {
      if (credit > 0 && debit > 0) return null;
      amount = credit > 0 ? credit : debit > 0 ? -debit : 0;
    } else {
      amount = parseMoney(cells[amountIndex]);
      if (amount > 0 && typeIndex >= 0 && /\b(dr|debit|withdrawal)\b/i.test(String(cells[typeIndex] || ""))) amount *= -1;
    }
    const reference = String(referenceIndex >= 0 ? cells[referenceIndex] || "" : "").trim();
    if (!amount || (!narration && !reference)) return null;
    const utr = reference || (narration.match(UTR_REGEX)?.[0] || "");
    const transaction = {
      id: `${String(cells[dateIndex] || "").trim()}|${narration.toLowerCase()}|${amount.toFixed(2)}|${utr}`,
      date: String(cells[dateIndex] || "").trim(),
      narration,
      amount: Math.round(amount * 100) / 100,
      direction: amount > 0 ? "credit" : "debit",
      utr,
      sourceRow: index + 2,
    };
    return { ...transaction, ...categorizeBankTransaction(transaction) };
  }).filter(Boolean);
}

function fuzzyMatch(a, b) {
  if (!a || !b) return 0;
  const left = String(a).toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = String(b).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (left === right) return 100;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (!shorter.length || !longer.length) return 0;
  // A full saved payee/client name appearing inside bank narration is a strong
  // signal even when the narration adds words such as "monthly" or "payment".
  if (shorter.length >= 4 && longer.includes(shorter)) return 90;
  const leftTokens = new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2));
  const rightTokens = new Set(String(b).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = leftTokens.size && rightTokens.size
    ? Math.round((overlap / Math.max(leftTokens.size, rightTokens.size)) * 100) : 0;
  if (tokenScore >= 80) return tokenScore;
  let matches = 0;
  for (const char of new Set(shorter)) if (longer.includes(char)) matches += 1;
  return Math.round((matches / new Set(longer).size) * 100);
}

const amountMatches = (left, right) => Math.abs(Math.abs(Number(left || 0)) - Math.abs(Number(right || 0))) <= 0.01;

export function suggestReconciliationMatches(transactions, invoices, expenses) {
  const claimed = new Set();
  const entries = (Array.isArray(transactions) ? transactions : []).map((tx) => {
    let candidates = [];
    if (tx.amount > 0) {
      (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
        if (invoice.isDraft || invoice.is_draft || !["pending", "overdue", ""].includes(String(invoice.status || "").toLowerCase())) return;
        if (!amountMatches(invoice.total, tx.amount)) return;
        const exactUtr = Boolean(tx.utr && invoice.utrReference && tx.utr === invoice.utrReference);
        const similarity = fuzzyMatch(tx.narration, invoice.clientName || invoice.client_name);
        if (exactUtr || similarity >= 80) candidates.push({
          type: "invoice", id: invoice.id, label: invoice.number || invoice.id,
          score: exactUtr ? 100 : similarity, confidence: exactUtr ? "UTR + amount" : "Name + amount",
        });
      });
      const exactUtrCandidates = candidates.filter((candidate) => candidate.confidence === "UTR + amount");
      if (exactUtrCandidates.length) candidates = exactUtrCandidates;
    } else if (tx.amount < 0) {
      (Array.isArray(expenses) ? expenses : []).forEach((expense) => {
        if (!["unpaid", "pending", "overdue", ""].includes(String(expense.status || "").toLowerCase())) return;
        if (!amountMatches(expense.amount, tx.amount)) return;
        const similarity = fuzzyMatch(tx.narration, [expense.vendor, expense.notes].filter(Boolean).join(" "));
        if (similarity >= 80) candidates.push({
          type: "expense", id: expense.id, label: expense.vendor || expense.id,
          score: similarity, confidence: "Payee + amount",
        });
      });
    }
    const available = candidates.filter((candidate) => !claimed.has(`${candidate.type}:${candidate.id}`));
    if (available.length === 1) {
      const match = available[0];
      claimed.add(`${match.type}:${match.id}`);
      return { ...tx, matchStatus: "SUGGESTED", matchedRecordType: match.type, matchedRecordId: match.id, matchedRecordLabel: match.label, matchConfidence: match.confidence };
    }
    if (available.length > 1) return { ...tx, matchStatus: "REVIEW_REQUIRED", candidateCount: available.length };
    return { ...tx, matchStatus: "UNMATCHED", matchedRecordType: null, matchedRecordId: null };
  });
  const matched = entries.filter((entry) => entry.matchStatus === "SUGGESTED").length;
  return { matched, unmatched: entries.length - matched, totalReconciled: 0, applied: 0, entries };
}
