import { ValidationFlags } from "../types";

const EARTH_RADIUS_M = 6371000;

export type GeoValidationInput = {
  ticketLat: number;
  ticketLng: number;
  proofLat: number | null;
  proofLng: number | null;
  geofenceRadiusM: number;
  requireGps: boolean;
};

export type TimeValidationInput = {
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  deadlineAt: Date;
  capturedAt: Date | null;
  submittedAt: Date;
};

export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function validateGeofence(input: GeoValidationInput): boolean {
  const { ticketLat, ticketLng, proofLat, proofLng, geofenceRadiusM, requireGps } = input;

  if (proofLat == null || proofLng == null) {
    return !requireGps;
  }

  const distance = haversineDistanceMeters(ticketLat, ticketLng, proofLat, proofLng);
  return distance <= geofenceRadiusM;
}

export function validateTimeWindow(input: TimeValidationInput): boolean {
  const { timeWindowStart, timeWindowEnd, deadlineAt, capturedAt, submittedAt } = input;
  const effectiveTs = capturedAt ?? submittedAt;

  if (timeWindowStart && effectiveTs < timeWindowStart) {
    return false;
  }

  if (timeWindowEnd) {
    return effectiveTs <= timeWindowEnd;
  }

  return effectiveTs <= deadlineAt;
}

export function buildValidationFlags(params: {
  ticketLat: number;
  ticketLng: number;
  proofLat: number | null;
  proofLng: number | null;
  geofenceRadiusM: number;
  requireGps: boolean;
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  deadlineAt: Date;
  capturedAt: Date | null;
  submittedAt: Date;
  exifPresent?: boolean;
}): ValidationFlags {
  return {
    geofence_ok: validateGeofence({
      ticketLat: params.ticketLat,
      ticketLng: params.ticketLng,
      proofLat: params.proofLat,
      proofLng: params.proofLng,
      geofenceRadiusM: params.geofenceRadiusM,
      requireGps: params.requireGps
    }),
    time_ok: validateTimeWindow({
      timeWindowStart: params.timeWindowStart,
      timeWindowEnd: params.timeWindowEnd,
      deadlineAt: params.deadlineAt,
      capturedAt: params.capturedAt,
      submittedAt: params.submittedAt
    }),
    exif_present: params.exifPresent ?? params.capturedAt != null
  };
}
