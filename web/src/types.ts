export type Role = "ADMIN" | "REQUESTER" | "WORKER" | "QA";

export type TaxonomyTerm = {
  id: string;
  domain: string;
  label: string;
  slug: string;
  active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type TicketStatus =
  | "NEW"
  | "QUALIFIED"
  | "PUBLISHED"
  | "ACCEPTED"
  | "PROOF_SUBMITTED"
  | "NEEDS_CHANGES"
  | "COMPLETED"
  | "REJECTED"
  | "ARCHIVED";

export type Ticket = {
  id: string;
  project_id: string;
  creator_user_id: string;
  title: string;
  description: string;
  category: string;
  task_class: number;
  origin: "TOP_DOWN" | "BOTTOM_UP_HINT";
  hint_note: string | null;
  status: TicketStatus;
  location_lat: number;
  location_lng: number;
  geofence_radius_m: number;
  time_window_start: string | null;
  time_window_end: string | null;
  deadline_at: string;
  proof_policy_json: Record<string, unknown>;
  safety_flags_json: Record<string, unknown>;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  taxonomy_terms: TaxonomyTerm[];
  created_at: string;
  updated_at: string;
};

export type Proof = {
  id: string;
  ticket_id: string;
  submitted_by_user_id: string;
  submitted_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  captured_at: string | null;
  validation_flags_json: Record<string, unknown>;
  checklist_answers_json: Record<string, unknown>;
  notes: string;
  qa_status: string;
  qa_decision_at: string | null;
  qa_decision_by: string | null;
  qa_comment: string | null;
  files?: Array<{
    id: string;
    file_key: string;
    file_mime: string;
    file_size: number;
    sha256: string;
    created_at: string;
  }>;
};

export type TicketDetail = Ticket & {
  proofs: Proof[];
  status_events: Array<{
    id: string;
    from_status: string | null;
    to_status: string;
    event_type: string;
    payload_json: Record<string, unknown>;
    created_at: string;
  }>;
};

export type UserJwt = {
  id: string;
  email: string;
  role: Role;
  exp: number;
  iat: number;
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  is_verified: boolean;
  created_at: string;
};

export type TicketTemplate = {
  id: string;
  name: string;
  category: string;
  task_class: number;
  checklist_json: Record<string, unknown>;
  proof_policy_json: Record<string, unknown>;
  default_geofence_radius_m: number;
  created_at: string;
};

export type AdminMetrics = {
  generated_at: string;
  totals: {
    tickets: number;
    proofs: number;
    qa_decided_proofs: number;
  };
  kpis: {
    median_ticket_to_accepted_seconds: number | null;
    first_pass_proof_complete_rate: number | null;
    avg_qa_cycle_seconds: number | null;
    change_request_rate: number | null;
  };
};

export type Project = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type QaQueueEntry = {
  proof_id: string;
  ticket_id: string;
  ticket_title: string;
  category: string;
  submitted_by_user_id: string;
  submitted_at: string;
  validation_flags_json: Record<string, unknown>;
  qa_status: string;
};

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

export type NotificationEvent = {
  id: string;
  user_id: string;
  ticket_id: string | null;
  event_type: string;
  title: string;
  body: string;
  payload_json: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};
