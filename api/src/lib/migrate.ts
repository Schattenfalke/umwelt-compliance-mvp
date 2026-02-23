import { pool } from "./db";

async function ensureTicketProjectRequired(): Promise<void> {
  await pool.query(`
    DO $$
    DECLARE
      fallback_owner uuid;
      fallback_project uuid;
    BEGIN
      IF EXISTS (SELECT 1 FROM tickets WHERE project_id IS NULL) THEN
        SELECT id INTO fallback_owner
        FROM users
        WHERE role = 'REQUESTER'
        ORDER BY created_at ASC
        LIMIT 1;

        IF fallback_owner IS NULL THEN
          SELECT id INTO fallback_owner
          FROM users
          ORDER BY created_at ASC
          LIMIT 1;
        END IF;

        IF fallback_owner IS NULL THEN
          RAISE EXCEPTION 'Cannot enforce project assignment without at least one user';
        END IF;

        SELECT id INTO fallback_project
        FROM projects
        WHERE owner_user_id = fallback_owner
          AND name = 'Migration Projektzuordnung'
        ORDER BY created_at ASC
        LIMIT 1;

        IF fallback_project IS NULL THEN
          INSERT INTO projects (owner_user_id, name, description)
          VALUES (
            fallback_owner,
            'Migration Projektzuordnung',
            'Automatisch erzeugtes Projekt fuer bestehende Tickets ohne Projektzuordnung'
          )
          RETURNING id INTO fallback_project;
        END IF;

        UPDATE tickets
        SET project_id = fallback_project
        WHERE project_id IS NULL;
      END IF;
    END $$;
  `);

  await pool.query("ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_project_id_fkey");
  await pool.query("ALTER TABLE tickets ALTER COLUMN project_id SET NOT NULL");
  await pool.query(`
    ALTER TABLE tickets
    ADD CONSTRAINT tickets_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
  `);
}

async function ensureTicketOriginColumns(): Promise<void> {
  await pool.query("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin text");
  await pool.query("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS hint_note text");
  await pool.query("UPDATE tickets SET origin = 'TOP_DOWN' WHERE origin IS NULL");
  await pool.query("ALTER TABLE tickets ALTER COLUMN origin SET DEFAULT 'TOP_DOWN'");
  await pool.query("ALTER TABLE tickets ALTER COLUMN origin SET NOT NULL");
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_origin_check'
      ) THEN
        ALTER TABLE tickets
        ADD CONSTRAINT tickets_origin_check
        CHECK (origin IN ('TOP_DOWN', 'BOTTOM_UP_HINT'));
      END IF;
    END $$;
  `);
}

async function ensureTaxonomyTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS taxonomy_terms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      domain text NOT NULL,
      label text NOT NULL,
      slug text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      order_index int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (domain, label)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_taxonomy (
      ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ticket_id, term_id)
    )
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_domain_active ON taxonomy_terms(domain, active)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_ticket_taxonomy_ticket ON ticket_taxonomy(ticket_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_ticket_taxonomy_term ON ticket_taxonomy(term_id)");

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_taxonomy_terms_updated'
      ) THEN
        CREATE TRIGGER trg_taxonomy_terms_updated
        BEFORE UPDATE ON taxonomy_terms
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$;
  `);
}

async function ensurePushTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint text NOT NULL,
      p256dh text NOT NULL,
      auth text NOT NULL,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, endpoint)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_events (
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
    )
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_notification_events_user ON notification_events(user_id, is_read, created_at DESC)");
}

export async function ensureRuntimeSchema(): Promise<void> {
  await ensureTicketOriginColumns();
  await ensureTaxonomyTables();
  await ensurePushTables();
  await ensureTicketProjectRequired();
}
