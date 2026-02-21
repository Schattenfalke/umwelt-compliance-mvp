import { pool } from "./db";
import { TicketStatus } from "../types";

export async function writeStatusEvent(params: {
  ticketId: string;
  actorUserId: string | null;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `
    INSERT INTO status_events (ticket_id, actor_user_id, from_status, to_status, event_type, payload_json)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      params.ticketId,
      params.actorUserId,
      params.fromStatus,
      params.toStatus,
      params.eventType,
      JSON.stringify(params.payload ?? {})
    ]
  );
}
