import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission, requirePermission } from "../src/lib/rbac";

test("rbac grants requester ticket creation but not qa actions", () => {
  assert.equal(hasPermission("REQUESTER", "ticket:create"), true);
  assert.equal(hasPermission("REQUESTER", "proof:qa"), false);
});

test("rbac grants qa actions to QA role", () => {
  assert.equal(hasPermission("QA", "ticket:qualify"), true);
  assert.equal(hasPermission("QA", "proof:qa"), true);
});

test("rbac throws on forbidden permission", () => {
  assert.throws(() => requirePermission("WORKER", "ticket:create"), /FORBIDDEN:ticket:create/);
});
