# DATA MODEL - Entities & Beziehungen (MVP vNext)

## 1) Uebersicht
- User (Role) erstellt Tickets oder meldet Bottom-up Hinweise.
- Jedes Ticket ist genau einem Project zugeordnet (Pflicht).
- Ticket hat Proofs, StatusEvents und optionale Taxonomie-Zuordnungen.
- TaxonomyTerm ist zentral verwaltet (kontrollierter Katalog).
- PushSubscription speichert Web-Push Endpunkte pro User.
- NotificationEvent bildet ausgeloeste In-App/Push-Benachrichtigungen ab.

## 2) Entities (Felderauszug)
### User
- id (uuid)
- email (unique)
- display_name
- role: ADMIN | REQUESTER | WORKER | QA
- tags (text[])
- is_verified
- created_at

### Project
- id (uuid)
- owner_user_id
- name
- description
- created_at

### Ticket
- id (uuid)
- project_id (NOT NULL)
- creator_user_id
- title
- description
- category
- task_class: 1 | 2 | 3
- origin: TOP_DOWN | BOTTOM_UP_HINT
- hint_note (nullable)
- status: NEW | QUALIFIED | PUBLISHED | ACCEPTED | PROOF_SUBMITTED | NEEDS_CHANGES | COMPLETED | REJECTED | ARCHIVED
- location_lat, location_lng
- geofence_radius_m
- time_window_start (nullable)
- time_window_end (nullable)
- deadline_at
- proof_policy_json
- safety_flags_json
- accepted_by_user_id (nullable)
- accepted_at (nullable)
- created_at, updated_at

### TaxonomyTerm
- id (uuid)
- domain (z. B. vegetation, incident_type, waste_type, method, urgency)
- label
- slug (unique)
- active
- order_index
- created_at, updated_at

### TicketTaxonomy
- ticket_id
- term_id
- created_at
- PK(ticket_id, term_id)

### TicketTemplate
- id
- name
- category
- task_class
- checklist_json
- proof_policy_json
- default_geofence_radius_m
- created_at

### Proof
- id
- ticket_id
- submitted_by_user_id
- submitted_at
- gps_lat, gps_lng (nullable)
- captured_at (nullable)
- validation_flags_json
- checklist_answers_json
- notes
- qa_status: PENDING | APPROVED | CHANGES_REQUESTED | REJECTED
- qa_decision_at, qa_decision_by, qa_comment
- created_at

### ProofFile
- id
- proof_id
- file_key
- file_mime
- file_size
- sha256
- created_at

### StatusEvent
- id
- ticket_id
- actor_user_id
- from_status (nullable)
- to_status
- event_type
- payload_json
- created_at

### PushSubscription
- id
- user_id
- endpoint
- p256dh
- auth
- user_agent
- created_at

### NotificationEvent
- id
- user_id
- ticket_id (nullable)
- event_type
- title
- body
- payload_json
- is_read
- created_at
- read_at (nullable)

## 3) Kernregeln
- Ticket ohne Project ist ungueltig.
- Worker-Hinweis (Bottom-up) erzeugt ein neues Klasse-2 Ticket in NEW.
- Worker-Hinweis braucht Text + Standort + mindestens 1 Foto.
- Date/Time Eingaben werden als ISO UTC gespeichert.
- Kanban-Statuswechsel sind nur entlang der Status-Maschine und RBAC erlaubt.
