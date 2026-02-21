import { TicketStatus } from "../types";

const transitions: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["QUALIFIED"],
  QUALIFIED: ["PUBLISHED"],
  PUBLISHED: ["ACCEPTED"],
  ACCEPTED: ["PROOF_SUBMITTED"],
  PROOF_SUBMITTED: ["COMPLETED", "NEEDS_CHANGES", "REJECTED"],
  NEEDS_CHANGES: ["PROOF_SUBMITTED"],
  COMPLETED: ["ARCHIVED"],
  REJECTED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: []
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }
}

export function allowedTransitionsFor(status: TicketStatus): TicketStatus[] {
  return transitions[status];
}
