/**
 * Shared authorization predicate for invoice-share management actions.
 * Public-token reads are deliberately separate from owner-only management.
 */
export function isShareLinkOwner(link, userId) {
  return typeof userId === "string"
    && userId.length > 0
    && typeof link?.created_by === "string"
    && link.created_by === userId;
}
