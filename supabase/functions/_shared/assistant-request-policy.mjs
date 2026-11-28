export function getAssistantRequestPolicy({
  isGlobalWorkspace = false,
  needsWorkspaceContext = false,
  needsPurchasingContext = false,
  needsGlobalFinanceContext = false,
  needsGlobalClientContext = false,
  needsGlobalExpenseContext = false,
  needsGlobalProductContext = false,
  needsGlobalSupplierContext = false,
  hasImage = false,
} = {}) {
  const needsGlobalContext = Boolean(
    needsGlobalFinanceContext ||
    needsGlobalClientContext ||
    needsGlobalExpenseContext ||
    needsGlobalProductContext
  );
  const simpleConversationalTurn = !needsWorkspaceContext &&
    !needsPurchasingContext &&
    !needsGlobalContext &&
    !hasImage;
  return {
    needsGlobalContext,
    // Global workspace identity alone is not a reason to query invoices or
    // business records. Only retrieve the modules the user's request needs.
    loadGlobalContext: needsGlobalContext,
    simpleConversationalTurn,
    thinkingLevel: simpleConversationalTurn ? "low" : "medium",
    maxOutputTokens: simpleConversationalTurn ? 1200 : 1800,
  };
}
