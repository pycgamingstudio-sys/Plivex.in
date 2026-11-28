const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function parseRows(source) {
  const rows = [];
  let row = [], field = "", quoted = false;
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
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[(),₹$£€\s]/g, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return negative ? -Math.abs(amount) : amount;
}

function validIsoDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function parseBankStatementImport(csvText) {
  const rows = parseRows(String(csvText || "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one transaction.");
  const headers = rows[0].map(normalizeHeader);
  const find = (aliases) => headers.findIndex((header) => aliases.includes(header));
  const dateIndex = find(["date", "transactiondate", "valuedate"]);
  const descriptionIndex = find(["description", "narration", "details", "memo", "particulars", "remarks"]);
  const referenceIndex = find(["reference", "ref", "referencenumber", "transactionid", "utr", "utrreference"]);
  const amountIndex = find(["amount", "transactionamount", "amountinr"]);
  const debitIndex = find(["debit", "withdrawal", "moneyout", "debitamount"]);
  const creditIndex = find(["credit", "deposit", "moneyin", "creditamount"]);
  const directionIndex = find(["direction", "type", "drcr", "transactiontype"]);
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error("CSV needs Date, Description/Narration and Amount or Debit/Credit columns.");
  }
  const valid = [], errors = [], seenReferences = new Map();
  rows.slice(1).forEach((cells, index) => {
    const sourceRow = index + 2;
    const rawRow = Object.fromEntries(headers.map((header, i) => [header || `column_${i + 1}`, cells[i] ?? ""]));
    const issue = (reason) => errors.push({ sourceRow, reason, rawRow });
    if (cells.length !== headers.length) { issue("Column count does not match the CSV header."); return; }
    const date = String(cells[dateIndex] || "").trim();
    const description = String(cells[descriptionIndex] || "").trim();
    const reference = referenceIndex >= 0 ? String(cells[referenceIndex] || "").trim() : "";
    if (!validIsoDate(date)) { issue("Date must be a valid ISO date (YYYY-MM-DD)."); return; }
    if (!description) { issue("Description is required."); return; }
    let amount;
    let direction;
    if (amountIndex >= 0) {
      const signed = parseAmount(cells[amountIndex]);
      if (signed === null || signed === 0) { issue("Amount must be a valid non-zero number."); return; }
      amount = Math.abs(signed);
      const rawDirection = directionIndex >= 0 ? String(cells[directionIndex] || "").trim().toLowerCase() : "";
      if (/^(dr|debit|withdrawal|out)$/.test(rawDirection)) direction = "debit";
      else if (/^(cr|credit|deposit|in)$/.test(rawDirection)) direction = "credit";
      else if (!rawDirection) direction = signed < 0 ? "debit" : "credit";
      else { issue("Direction must be Debit/DR or Credit/CR."); return; }
      if (signed < 0 && direction === "credit") { issue("Signed amount conflicts with the Credit direction."); return; }
      if (signed > 0 && direction === "debit" && rawDirection === "") { issue("A positive amount cannot be inferred as a debit without a direction."); return; }
    } else {
      const debitRaw = debitIndex >= 0 ? String(cells[debitIndex] ?? "").trim() : "";
      const creditRaw = creditIndex >= 0 ? String(cells[creditIndex] ?? "").trim() : "";
      const debit = debitRaw ? parseAmount(debitRaw) : 0;
      const credit = creditRaw ? parseAmount(creditRaw) : 0;
      if (debit === null || credit === null || (debit > 0 && credit > 0)) { issue("Debit and Credit must be valid, and only one may be positive."); return; }
      if (debit > 0) { amount = debit; direction = "debit"; }
      else if (credit > 0) { amount = credit; direction = "credit"; }
      else { issue("Each row needs a positive Debit or Credit amount."); return; }
    }
    if (reference) {\n      const referenceKey = `${date}|${direction}|${amount.toFixed(4)}|${reference.toLowerCase()}`;\n      if (seenReferences.has(referenceKey)) { issue(`Duplicate bank reference; first seen on row ${seenReferences.get(referenceKey)}.`); return; }\n      seenReferences.set(referenceKey, sourceRow);\n    }\n    valid.push({ date, description, reference: reference || null, amount, direction, sourceRow, rawRow });
  });
  return { rows: valid, errors, totalRows: rows.length - 1 };
}
