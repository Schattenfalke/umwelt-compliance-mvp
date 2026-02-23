-- 03A_schema.sql (PostgreSQL)
-- Hinweis: jsonb wird im MVP bewusst genutzt, um schnell zu iterieren.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('ADMIN','REQUESTER','WORKER','QA')),
  tags text[] DEFAULT ARRAY[]::text[],
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  task_class int NOT NULL CHECK (task_class IN (1,2,3)),
  checklist_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  proof_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_geofence_radius_m int NOT NULL DEFAULT 25,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  task_class int NOT NULL CHECK (task_class IN (1,2,3)),
  origin text NOT NULL DEFAULT 'TOP_DOWN' CHECK (origin IN ('TOP_DOWN','BOTTOM_UP_HINT')),
  hint_note text,
  status text NOT NULL CHECK (status IN ('NEW','QUALIFIED','PUBLISHED','ACCEPTED','PROOF_SUBMITTED','NEEDS_CHANGES','COMPLETED','REJECTED','ARCHIVED')),
  location_lat double precision NOT NULL,
  location_lng double precision NOT NULL,
  geofence_radius_m int NOT NULL,
  time_window_start timestamptz,
  time_window_end timestamptz,
  deadline_at timestamptz NOT NULL,
  proof_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_flags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_project ON tickets(project_id);
CREATE INDEX idx_tickets_loc ON tickets(location_lat, location_lng);

CREATE TABLE taxonomy_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  label text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, label)
);

CREATE INDEX idx_taxonomy_terms_domain_active ON taxonomy_terms(domain, active);

CREATE TABLE ticket_taxonomy (
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, term_id)
);

CREATE INDEX idx_ticket_taxonomy_ticket ON ticket_taxonomy(ticket_id);
CREATE INDEX idx_ticket_taxonomy_term ON ticket_taxonomy(term_id);

CREATE TABLE proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  gps_lat double precision,
  gps_lng double precision,
  captured_at timestamptz,
  validation_flags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checklist_answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  qa_status text NOT NULL DEFAULT 'PENDING' CHECK (qa_status IN ('PENDING','APPROVED','CHANGES_REQUESTED','REJECTED')),
  qa_decision_at timestamptz,
  qa_decision_by uuid REFERENCES users(id) ON DELETE SET NULL,
  qa_comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proofs_ticket ON proofs(ticket_id);
CREATE INDEX idx_proofs_qastatus ON proofs(ticket_id, qa_status);

CREATE TABLE proof_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id uuid NOT NULL REFERENCES proofs(id) ON DELETE CASCADE,
  file_key text NOT NULL,
  file_mime text NOT NULL,
  file_size bigint NOT NULL,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX idx_notification_events_user ON notification_events(user_id, is_read, created_at DESC);

CREATE TABLE status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_events_ticket ON status_events(ticket_id, created_at);

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tickets_updated
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_taxonomy_terms_updated
BEFORE UPDATE ON taxonomy_terms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
