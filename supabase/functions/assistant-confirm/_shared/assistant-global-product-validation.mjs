import { majorToMinorUnits } from "./assistant-global-payment-validation.mjs";

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

function priceToMinor(value, currencyCode) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return 0;
  return majorToMinorUnits(amount, currencyCode);
}

export function validateGlobalProductAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_product") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = cleanText(raw.name, 200);
  const currencyCode = cleanText(raw.currency_code, 3).toUpperCase();
  const unit = cleanText(raw.unit || "unit", 32);
  if (!name || !/^[A-Z]{3}$/.test(currencyCode) || !unit) return null;
  const salePrice = priceToMinor(raw.sale_price, currencyCode);
  const purchaseCost = priceToMinor(raw.purchase_cost, currencyCode);
  if (raw.sale_price !== undefined && raw.sale_price !== null && raw.sale_price !== "" && salePrice === null) return null;
  if (raw.purchase_cost !== undefined && raw.purchase_cost !== null && raw.purchase_cost !== "" && purchaseCost === null) return null;
  return {
    type: "create_global_product",
    payload: {
      name, currency_code: currencyCode, unit,
      sku: cleanText(raw.sku, 80),
      description: cleanText(raw.description, 4000),
      sale_price: raw.sale_price === undefined || raw.sale_price === null || raw.sale_price === "" ? null : Number(raw.sale_price),
      purchase_cost: raw.purchase_cost === undefined || raw.purchase_cost === null || raw.purchase_cost === "" ? null : Number(raw.purchase_cost),
      tax_code: cleanText(raw.tax_code, 64),
      is_active: raw.is_active === false ? false : true,
    },
  };
}
