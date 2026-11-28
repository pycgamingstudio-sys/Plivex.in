export function getAssistantRequestPolicy({
  isGlobalWorkspace = false,
  needsWorkspaceContext = false,
  needsPurchasingContext = false,
  needsGlobalFinanceContext = false,
  needsGlobalClientContext = false,
  needsGlobalExpenseContext = false,
  needsGlobalProductContext = false,
  needsGlobalSupplierContext = false,
  needsGlobalTransferContext = false,
  needsGlobalBranchContext = false,
  needsGlobalMemberContext = false,
  needsGlobalApprovalContext = false,
  needsGlobalApprovalSourceContext = false,
  hasImage = false,
} = {}) {
  const needsGlobalContext = Boolean(
    needsGlobalFinanceContext ||
    needsGlobalClientContext ||
    needsGlobalExpenseContext ||
    needsGlobalProductContext ||
    needsGlobalSupplierContext ||
    needsGlobalTransferContext ||
    needsGlobalBranchContext ||
    needsGlobalMemberContext ||
    needsGlobalApprovalContext ||
    needsGlobalApprovalSourceContext
  );
  const simpleConversationalTurn = !needsWorkspaceContext &&
    !needsPurchasingContext &&
    !needsGlobalContext &&
    !hasImage;
  return {
    needsGlobalContext,
    loadGlobalContext: needsGlobalContext,
    simpleConversationalTurn,
    thinkingLevel: simpleConversationalTurn ? "low" : "medium",
    maxOutputTokens: simpleConversationalTurn ? 1200 : 1800,
  };
}
