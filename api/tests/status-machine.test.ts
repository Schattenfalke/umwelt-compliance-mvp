import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, canTransition } from "../src/lib/statusMachine";

test("statusMachine allows documented transitions", () => {
  assert.equal(canTransition("NEW", "QUALIFIED"), true);
  assert.equal(canTransition("QUALIFIED", "PUBLISHED"), true);
  assert.equal(canTransition("PUBLISHED", "ACCEPTED"), true);
  assert.equal(canTransition("ACCEPTED", "PROOF_SUBMITTED"), true);
  assert.equal(canTransition("PROOF_SUBMITTED", "COMPLETED"), true);
  assert.equal(canTransition("PROOF_SUBMITTED", "NEEDS_CHANGES"), true);
  assert.equal(canTransition("NEEDS_CHANGES", "PROOF_SUBMITTED"), true);
});

test("statusMachine rejects invalid transitions", () => {
  assert.equal(canTransition("NEW", "PUBLISHED"), false);
  assert.equal(canTransition("ACCEPTED", "COMPLETED"), false);
  assert.throws(() => assertTransition("NEW", "PUBLISHED"), /INVALID_TRANSITION:NEW->PUBLISHED/);
});

test("statusMachine allows rejected rework path", () => {
  assert.equal(canTransition("REJECTED", "PUBLISHED"), true);
});
