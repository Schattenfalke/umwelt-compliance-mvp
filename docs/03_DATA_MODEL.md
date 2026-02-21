# DATA MODEL — Entities & Beziehungen (MVP)

## 1) Uebersicht (ERD in Worten)
- User (role) erstellt Tickets (Creator)
- Ticket gehoert optional zu Project
- Ticket hat viele Proofs
- Ticket hat viele StatusEvents (Audit)
- QAReview ist ein Event/Record zu einem Proof oder Ticket
- TicketTemplate definiert Checkliste + Proof-Policy (optional, aber sinnvoll)
- Proof hat ProofFiles (Fotos) und ProofFields (Pflichtfelder/Checkliste)

## 2) Entities (Felderauszug)
### User
- id (uuid)
- email (unique)
- display_name
- role: ADMIN | REQUESTER | WORKER | QA
- tags (text[]) (skills/region)
- is_verified (bool)
- created_at

### Project
- id
- name
- owner_user_id
- description
- created_at

### Ticket
- id
- project_id (nullable)
- creator_user_id
- title
- description
- category
- task_class: 1 | 2 | 3
- status: NEW | QUALIFIED | PUBLISHED | ACCEPTED | PROOF_SUBMITTED | NEEDS_CHANGES | COMPLETED | REJECTED | ARCHIVED
- location_lat, location_lng
- geofence_radius_m
- time_window_start (nullable)  # optional
- time_window_end (nullable)
- deadline_at
- proof_policy_json (jsonb)  # e.g. {min_photos:2, require_gps:true, redundancy:2}
- safety_flags_json (jsonb)  # e.g. {public_access_only:true, permit_required:false}
- accepted_by_user_id (nullable)
- accepted_at (nullable)
- created_at, updated_at

### TicketTemplate (optional in MVP, empfohlen)
- id
- name
- category
- task_class
- checklist_json (jsonb)       # list of fields and rules
- proof_policy_json (jsonb)
- default_geofence_radius_m
- created_at

### Proof
- id
- ticket_id
- submitted_by_user_id
- submitted_at
- gps_lat (nullable)
- gps_lng (nullable)
- captured_at (nullable)       # from EXIF if present
- validation_flags_json (jsonb) # {geofence_ok:true, time_ok:true, exif_present:false}
- checklist_answers_json (jsonb)
- notes (text)
- qa_status: PENDING | APPROVED | CHANGES_REQUESTED | REJECTED
- qa_decision_at (nullable)
- qa_decision_by (nullable user)
- qa_comment (text)
- created_at

### ProofFile
- id
- proof_id
- file_key (storage path)
- file_mime
- file_size
- sha256
- created_at

### StatusEvent (Audit Trail)
- id
- ticket_id
- actor_user_id
- from_status (nullable)
- to_status
- event_type (e.g. STATUS_CHANGE, QA_DECISION, COMMENT)
- payload_json (jsonb)
- created_at

## 3) Indizes (MVP)
- Ticket(status)
- Ticket(project_id)
- Ticket(location_lat, location_lng) (optional: for bbox query)
- Proof(ticket_id, qa_status)
- StatusEvent(ticket_id, created_at)

## 4) Datenvalidierung (MVP)
- geofence_radius_m >= 5 und <= 2000 (guardrails)
- deadline_at > now()
- worker darf nur 1 Ticket gleichzeitig ACCEPTED (optional policy)
