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
  | "template:list"
  | "template:write"
  | "admin:users:read"
  | "admin:users:write"
  | "admin:metrics:read";

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
    "template:list",
    "template:write",
    "admin:users:read",
    "admin:users:write",
    "admin:metrics:read"
  ],
  REQUESTER: ["ticket:create", "ticket:list", "ticket:detail", "report:read", "template:list"],
  WORKER: ["ticket:list", "ticket:detail", "ticket:accept", "proof:submit", "template:list"],
  QA: ["ticket:list", "ticket:detail", "ticket:qualify", "ticket:publish", "proof:qa", "report:read", "template:list"]
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
