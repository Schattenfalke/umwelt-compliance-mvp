import assert from "node:assert/strict";
import { haversineDistanceMeters, validateGeofence, validateTimeWindow } from "../src/lib/geoTimeValidation";
import { canTransition, assertTransition } from "../src/lib/statusMachine";
import { hasPermission, requirePermission } from "../src/lib/rbac";

function runGeoTimeTests(): void {
  const distance = haversineDistanceMeters(52.52, 13.405, 52.5202, 13.4052);
  assert.ok(distance < 50);

  assert.equal(
    validateGeofence({
      ticketLat: 52.52,
      ticketLng: 13.405,
      proofLat: 52.5202,
      proofLng: 13.4052,
      geofenceRadiusM: 50,
      requireGps: true
    }),
    true
  );

  assert.equal(
    validateGeofence({
      ticketLat: 52.52,
      ticketLng: 13.405,
      proofLat: 52.53,
      proofLng: 13.415,
      geofenceRadiusM: 50,
      requireGps: true
    }),
    false
  );

  assert.equal(
    validateTimeWindow({
      timeWindowStart: new Date("2026-01-01T10:00:00Z"),
      timeWindowEnd: new Date("2026-01-01T12:00:00Z"),
      deadlineAt: new Date("2026-01-01T18:00:00Z"),
      capturedAt: new Date("2026-01-01T11:00:00Z"),
      submittedAt: new Date("2026-01-01T11:30:00Z")
    }),
    true
  );

  assert.equal(
    validateTimeWindow({
      timeWindowStart: null,
      timeWindowEnd: null,
      deadlineAt: new Date("2026-01-01T12:00:00Z"),
      capturedAt: new Date("2026-01-01T12:01:00Z"),
      submittedAt: new Date("2026-01-01T12:01:00Z")
    }),
    false
  );
}

function runStatusTransitionTests(): void {
  assert.equal(canTransition("NEW", "QUALIFIED"), true);
  assert.equal(canTransition("QUALIFIED", "PUBLISHED"), true);
  assert.equal(canTransition("PUBLISHED", "ACCEPTED"), true);
  assert.equal(canTransition("ACCEPTED", "PROOF_SUBMITTED"), true);
  assert.equal(canTransition("PROOF_SUBMITTED", "COMPLETED"), true);
  assert.equal(canTransition("PROOF_SUBMITTED", "NEEDS_CHANGES"), true);
  assert.equal(canTransition("NEEDS_CHANGES", "PROOF_SUBMITTED"), true);
  assert.equal(canTransition("NEW", "PUBLISHED"), false);
  assert.equal(canTransition("REJECTED", "PUBLISHED"), true);
  assert.throws(() => assertTransition("NEW", "PUBLISHED"), /INVALID_TRANSITION:NEW->PUBLISHED/);
}

function runRbacTests(): void {
  assert.equal(hasPermission("REQUESTER", "ticket:create"), true);
  assert.equal(hasPermission("REQUESTER", "proof:qa"), false);
  assert.equal(hasPermission("QA", "ticket:qualify"), true);
  assert.equal(hasPermission("QA", "proof:qa"), true);
  assert.equal(hasPermission("ADMIN", "admin:users:read"), true);
  assert.throws(() => requirePermission("WORKER", "ticket:create"), /FORBIDDEN:ticket:create/);
}

runGeoTimeTests();
runStatusTransitionTests();
runRbacTests();

console.log("All core logic tests passed.");
