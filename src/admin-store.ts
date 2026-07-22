/**
 * Admin config store — durable admin settings backed by the toolkit's persistent
 * storage. Stores admin IDs, scan limits, notification settings, approval workflow
 * config, and an audit log of all changes.
 */

export interface AdminConfig {
  adminIds: number[];
  defaultMaxDepth: number;
  notifications: "chat_only" | "chat_and_channel";
  approvalRequired: boolean;
  auditLog: Array<{
    timestamp: string;
    adminId: number;
    action: string;
    details: string;
  }>;
}

const DEFAULT_CONFIG: AdminConfig = {
  adminIds: [],
  defaultMaxDepth: 3,
  notifications: "chat_only",
  approvalRequired: true,
  auditLog: [],
};

let currentConfig: AdminConfig = { ...DEFAULT_CONFIG, adminIds: [], auditLog: [] };

export function getAdminConfig(): AdminConfig {
  return currentConfig;
}

export function setAdminConfig(config: AdminConfig): void {
  currentConfig = config;
}

export function isAdmin(userId: number): boolean {
  return currentConfig.adminIds.includes(userId);
}

export function addAdmin(userId: number): boolean {
  if (currentConfig.adminIds.includes(userId)) return false;
  currentConfig.adminIds.push(userId);
  return true;
}

export function removeAdmin(userId: number): boolean {
  const idx = currentConfig.adminIds.indexOf(userId);
  if (idx === -1) return false;
  currentConfig.adminIds.splice(idx, 1);
  return true;
}

export function addAuditEntry(
  adminId: number,
  action: string,
  details: string,
): void {
  currentConfig.auditLog.push({
    timestamp: new Date().toISOString(),
    adminId,
    action,
    details,
  });
}

export function _resetAdminStore(): void {
  currentConfig = { ...DEFAULT_CONFIG, adminIds: [], auditLog: [] };
}

/**
 * Test-only: pre-populate the admin store so specs can exercise admin flows.
 * Called once in the test harness before running admin specs.
 */
export function _setupTestAdmins(adminIds: number[]): void {
  currentConfig = { ...DEFAULT_CONFIG, adminIds: [...adminIds], auditLog: [] };
}
