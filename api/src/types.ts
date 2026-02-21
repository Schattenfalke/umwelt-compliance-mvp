export const ROLES = ["ADMIN", "REQUESTER", "WORKER", "QA"] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = [
  "NEW",
  "QUALIFIED",
  "PUBLISHED",
  "ACCEPTED",
  "PROOF_SUBMITTED",
  "NEEDS_CHANGES",
  "COMPLETED",
  "REJECTED",
  "ARCHIVED"
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const QA_DECISIONS = ["APPROVE", "REQUEST_CHANGES", "REJECT", "ESCALATE"] as const;
export type QaDecision = (typeof QA_DECISIONS)[number];

export type UserJwt = {
  id: string;
  email: string;
  role: Role;
};

export type ProofPolicy = {
  min_photos?: number;
  require_gps?: boolean;
  redundancy?: number;
  required_fields?: string[];
};

export type SafetyFlags = {
  public_access_only?: boolean;
  permit_required?: boolean;
  no_trespass?: boolean;
};

export type ValidationFlags = {
  geofence_ok: boolean;
  time_ok: boolean;
  exif_present: boolean;
};
