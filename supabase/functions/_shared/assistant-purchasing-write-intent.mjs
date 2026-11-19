export function detectPurchasingWriteIntent(value, {
  explicitWriteIntent = false,
  awaitingPurchaseOrderField = false,
  awaitingWarehouseField = false,
  awaitingGoodsReceiptField = false,
} = {}) {
  const source = String(value ?? "");
  const purchaseOrderMention = /\b(?:purchase\s*order|po)\b|\b(?:mangwa(?:ya|i)|mangwaya)\b/i.test(source);
  const warehouseMention = /\b(?:warehouse|godown)\b|गोदाम/i.test(source);
  const goodsReceiptMention = /\b(?:goods\s*receipt|grn|stock\s*received|receive\s+(?:stock|goods))\b|\bmaal\s+(?:aa\s+gaya|mil\s+gaya)\b|माल\s+(?:आ\s+गया|मिल\s+गया)/i.test(source);
  return {
    purchaseOrderIntentActive: purchaseOrderMention && (explicitWriteIntent || awaitingPurchaseOrderField || /\bmangwa(?:ya|i)\b|\bmangwaya\b/i.test(source)),
    warehouseIntentActive: warehouseMention && (explicitWriteIntent || awaitingWarehouseField),
    goodsReceiptIntentActive: goodsReceiptMention && (explicitWriteIntent || awaitingGoodsReceiptField || /\b(?:stock\s*received|maal\s+(?:aa\s+gaya|mil\s+gaya))\b|माल\s+(?:आ\s+गया|मिल\s+गया)/i.test(source)),
  };
}
