import { Role } from "../types";

type Permission =
  | "project:create"
  | "project:list"
  | "ticket:create"
  | "ticket:hint:create"
  | "ticket:list"
  | "ticket:detail"
  | "ticket:qualify"
  | "ticket:publish"
  | "ticket:accept"
  | "ticket:move"
  | "proof:submit"
  | "proof:qa"
  | "report:read"
  | "export:ka5:read"
  | "template:list"
  | "template:write"
  | "taxonomy:read"
  | "taxonomy:write"
  | "notification:subscribe"
  | "notification:read"
  | "admin:users:read"
  | "admin:users:write"
  | "admin:metrics:read";

const matrix: Record<Role, Permission[]> = {
  ADMIN: [
    "project:create",
    "project:list",
    "ticket:create",
    "ticket:hint:create",
    "ticket:list",
    "ticket:detail",
    "ticket:qualify",
    "ticket:publish",
    "ticket:accept",
    "ticket:move",
    "proof:submit",
    "proof:qa",
    "report:read",
    "export:ka5:read",
    "template:list",
    "template:write",
    "taxonomy:read",
    "taxonomy:write",
    "notification:subscribe",
    "notification:read",
    "admin:users:read",
    "admin:users:write",
    "admin:metrics:read"
  ],
  REQUESTER: [
    "project:create",
    "project:list",
    "ticket:create",
    "ticket:list",
    "ticket:detail",
    "report:read",
    "export:ka5:read",
    "template:list",
    "taxonomy:read",
    "notification:subscribe",
    "notification:read"
  ],
  WORKER: [
    "project:list",
    "ticket:hint:create",
    "ticket:list",
    "ticket:detail",
    "ticket:accept",
    "ticket:move",
    "proof:submit",
    "template:list",
    "taxonomy:read",
    "notification:subscribe",
    "notification:read"
  ],
  QA: [
    "project:list",
    "ticket:list",
    "ticket:detail",
    "ticket:qualify",
    "ticket:publish",
    "ticket:move",
    "proof:qa",
    "report:read",
    "export:ka5:read",
    "template:list",
    "taxonomy:read",
    "notification:subscribe",
    "notification:read"
  ]
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
