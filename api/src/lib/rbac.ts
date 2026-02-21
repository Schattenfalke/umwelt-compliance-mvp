import { Role } from "../types";

type Permission =
  | "ticket:create"
  | "ticket:list"
  | "ticket:detail"
  | "ticket:qualify"
  | "ticket:publish"
  | "ticket:accept"
  | "proof:submit"
  | "proof:qa"
  | "report:read"
  | "admin:users:read"
  | "admin:users:write";

const matrix: Record<Role, Permission[]> = {
  ADMIN: [
    "ticket:create",
    "ticket:list",
    "ticket:detail",
    "ticket:qualify",
    "ticket:publish",
    "ticket:accept",
    "proof:submit",
    "proof:qa",
    "report:read",
    "admin:users:read",
    "admin:users:write"
  ],
  REQUESTER: ["ticket:create", "ticket:list", "ticket:detail", "report:read"],
  WORKER: ["ticket:list", "ticket:detail", "ticket:accept", "proof:submit"],
  QA: ["ticket:list", "ticket:detail", "ticket:qualify", "ticket:publish", "proof:qa", "report:read"]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return matrix[role].includes(permission);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`FORBIDDEN:${permission}`);
  }
}

export type { Permission };
