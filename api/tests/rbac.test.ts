import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission, requirePermission } from "../src/lib/rbac";

test("rbac grants requester ticket creation but not qa actions", () => {
  assert.equal(hasPermission("REQUESTER", "ticket:create"), true);
  assert.equal(hasPermission("REQUESTER", "proof:qa"), false);
  assert.equal(hasPermission("REQUESTER", "notification:read"), true);
});

test("rbac grants qa actions to QA role", () => {
  assert.equal(hasPermission("QA", "ticket:qualify"), true);
  assert.equal(hasPermission("QA", "proof:qa"), true);
  assert.equal(hasPermission("QA", "ticket:move"), true);
});

test("rbac allows admin user management write only for ADMIN", () => {
  assert.equal(hasPermission("ADMIN", "admin:users:write"), true);
  assert.equal(hasPermission("REQUESTER", "admin:users:write"), false);
  assert.equal(hasPermission("WORKER", "admin:users:write"), false);
  assert.equal(hasPermission("QA", "admin:users:write"), false);
});

test("rbac throws on forbidden permission", () => {
  assert.equal(hasPermission("WORKER", "ticket:hint:create"), true);
  assert.equal(hasPermission("WORKER", "ticket:create"), false);
  assert.throws(() => requirePermission("WORKER", "ticket:create"), /FORBIDDEN:ticket:create/);
});
