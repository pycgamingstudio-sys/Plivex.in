// Enterprise identifier schema & dynamic role-prefixed invite tokens (frontend engine).

const HEX = "0123456789ABCDEF";
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomFrom = (chars, len) => {
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// Workspace ID: WS-[TIMESTAMP_HEX]-[RANDOM_4_HEX]  e.g. WS-6B2A8F-9F2B
export const generateWorkspaceId = () => `WS-${Date.now().toString(16).toUpperCase()}-${randomFrom(HEX, 4)}`;

// User ID: USR-[TIMESTAMP_HEX]-[RANDOM_6_ALPHANUMERIC]  e.g. USR-6B2A8F-X9K3M2
export const generateUserRef = () => `USR-${Date.now().toString(16).toUpperCase()}-${randomFrom(ALNUM, 6)}`;

// App RBAC role ↔ invite-token role prefix
export const ROLE_TO_PREFIX = { manager: "MNG", employee: "S", storekeeper: "SHOP", accountant: "A" };
export const PREFIX_TO_APP_ROLE = { S: "employee", A: "accountant", SHOP: "storekeeper", MNG: "manager", CA: "accountant" };

// Token role name → app RBAC role
export const TOKEN_ROLE_TO_APP_ROLE = {
  SALES_EXECUTIVE: "employee",
  ACCOUNTANT: "accountant",
  SHOPKEEPER: "storekeeper",
  MANAGER: "manager",
  CA_AUDITOR: "accountant",
};

// [ROLE_PREFIX]-[WORKSPACE_ID]-[UNIQUE_STAMP]
export const generateInviteCode = (rolePrefix, workspaceId) =>
  `${(rolePrefix || "S").toUpperCase()}-${workspaceId}-${randomFrom(ALNUM, 6)}`;

export function parseAndValidateInviteCode(inviteCode) {
  if (!inviteCode || typeof inviteCode !== 'string') {
    throw new Error("Invalid invite code format");
  }

  const parts = inviteCode.split('-');
  if (parts.length < 3) {
    throw new Error("Malformed invite code sequence");
  }

  const prefix = parts[0].toUpperCase();
  const workspaceId = parts.slice(1, parts.length - 1).join('-');
  const uniqueStamp = parts[parts.length - 1];

  const roleMapping = {
    'S': { role: 'SALES_EXECUTIVE', redirectRoute: '/dashboard/sales-crm' },
    'A': { role: 'ACCOUNTANT', redirectRoute: '/dashboard/accounting' },
    'SHOP': { role: 'SHOPKEEPER', redirectRoute: '/dashboard/pos-billing' },
    'MNG': { role: 'MANAGER', redirectRoute: '/dashboard/operations' },
    'CA': { role: 'CA_AUDITOR', redirectRoute: '/dashboard/compliance' },
  };

  const matchedConfig = roleMapping[prefix];

  if (!matchedConfig) {
    throw new Error("Unrecognized role prefix in invite code");
  }

  return {
    rolePrefix: prefix,
    assignedRole: matchedConfig.role,
    targetWorkspaceId: workspaceId,
    uniqueStamp: uniqueStamp,
    defaultRedirectRoute: matchedConfig.redirectRoute,
    appRole: TOKEN_ROLE_TO_APP_ROLE[matchedConfig.role],
  };
}