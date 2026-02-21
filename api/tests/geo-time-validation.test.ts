import assert from "node:assert/strict";
import test from "node:test";
import { haversineDistanceMeters, validateGeofence, validateTimeWindow } from "../src/lib/geoTimeValidation";

test("geoTimeValidation validates geofence when inside radius", () => {
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
});

test("geoTimeValidation fails geofence when outside radius", () => {
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
});

test("geoTimeValidation allows missing gps if policy does not require gps", () => {
    assert.equal(
      validateGeofence({
        ticketLat: 52.52,
        ticketLng: 13.405,
        proofLat: null,
        proofLng: null,
        geofenceRadiusM: 50,
        requireGps: false
      }),
      true
    );
});

test("geoTimeValidation validates time inside time window", () => {
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
});

test("geoTimeValidation fails time when captured after deadline", () => {
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
});
