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
  intentCount = 0,
  hasWriteIntent = false,
  needsAnalytics = false,
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
  const hasBusinessContext = Boolean(
    needsWorkspaceContext || needsPurchasingContext || needsGlobalContext || hasImage || needsAnalytics
  );
  const safeIntentCount = Number.isInteger(intentCount) && intentCount > 0 ? intentCount : 0;
  const multiStepTurn = safeIntentCount > 1 || (needsPurchasingContext && hasWriteIntent);
  const simpleConversationalTurn = !hasBusinessContext && safeIntentCount === 0 && !hasWriteIntent;
  const requestClass = simpleConversationalTurn ? "simple" : multiStepTurn ? "multi_step" : "business";
  return {
    needsGlobalContext,
    loadGlobalContext: needsGlobalContext,
    simpleConversationalTurn,
    multiStepTurn,
    requestClass,
    thinkingLevel: simpleConversationalTurn ? "low" : multiStepTurn ? "high" : "medium",
    maxOutputTokens: simpleConversationalTurn ? 1200 : multiStepTurn ? 2600 : 1800,
  };
}
