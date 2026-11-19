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
  const readOnlyQuestion = /\b(?:show|list|view|report|status|how many|how much|what are|display)\b/i.test(source);
  const directReceiptRequest = /\b(?:receive\s+(?:stock|goods)|stock\s*received)\b|\bmaal\s+(?:aa\s+gaya|mil\s+gaya)\b|माल\s+(?:आ\s+गया|मिल\s+गया)/i.test(source);
  return {
    purchaseOrderIntentActive: awaitingPurchaseOrderField
      || (purchaseOrderMention && explicitWriteIntent)
      || /\b(?:mangwa(?:ya|i)|mangwaya)\b/i.test(source),
    warehouseIntentActive: awaitingWarehouseField
      || (warehouseMention && (explicitWriteIntent || /\b(?:open|opened|khola|kholna|bana(?:o|na)?)\b/i.test(source))),
    goodsReceiptIntentActive: awaitingGoodsReceiptField
      || (goodsReceiptMention && (explicitWriteIntent || (!readOnlyQuestion && directReceiptRequest))),
  };
}
