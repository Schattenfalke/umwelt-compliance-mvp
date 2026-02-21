# DECISIONS (MVP Defaults)

Datum: 2026-02-21

1. Auth-Default
- Unklarheit: Datenmodell hat kein `password_hash` Feld.
- Entscheidung: Login bleibt `email + password`, aber Passwort wird als gemeinsames MVP-Demo-Passwort (`AUTH_DEMO_PASSWORD`) validiert.
- Folge: Demo-User werden beim API-Start per Seed angelegt (`admin/requester/worker/qa`).

2. Worker-Accept Policy
- Unklarheit: "1 aktives Ticket pro Worker" ist im Datenmodell als optional markiert.
- Entscheidung: Policy ist aktiv.
- Folge: Worker kann kein weiteres Ticket auf `ACCEPTED` setzen, solange bereits ein eigenes `ACCEPTED` Ticket existiert.

3. Reject/Rework Pfad
- Unklarheit: PRD nennt "Ausgespielt oder Abgelehnt", State-Machine nennt `PROOF_SUBMITTED -> REJECTED` und `REJECTED -> PUBLISHED`.
- Entscheidung: QA `REJECT` setzt Ticket auf `REJECTED`; Rework erfolgt durch erneutes `publish` (`REJECTED -> PUBLISHED`).

4. Escalation-Verknuepfung
- Unklarheit: Datenmodell hat keine explizite `linked_ticket_id` Spalte.
- Entscheidung: Bei `ESCALATE` wird ein neues Klasse-3 Ticket in `NEW` erstellt, Verknuepfung ueber `proof_policy_json.source_ticket_id` und `status_events.payload_json`.

5. Geo/Time Validation Verhalten
- Unklarheit: Ob Upload bei Geo/Time-Fehler blockiert werden soll.
- Entscheidung: Upload wird nicht blockiert; Flags (`geofence_ok`, `time_ok`, `exif_present`) werden persistiert und QA entscheidet.

6. Storage-Default
- Unklarheit: Tech Spec nennt S3/MinIO optional, User fordert Docker nur fuer Postgres+API+Web.
- Entscheidung: Proof-Dateien werden lokal im API-Container gespeichert (`UPLOAD_DIR`) und nur als Metadaten im MVP verwendet.

7. QA Queue API
- Unklarheit: OpenAPI hat kein dediziertes QA-Queue Endpoint.
- Entscheidung: initial ueber `GET /tickets?status=PROOF_SUBMITTED`; spaeter ersetzt durch dedizierten Endpoint `GET /qa/queue` (siehe Entscheidung 12).

8. Admin-Minimum
- Unklarheit: UI-Flow fordert Admin-User-Rollenpflege, OpenAPI listet keine Admin-Endpunkte.
- Entscheidung: Minimal ergaenzt um `GET /admin/users` und `PATCH /admin/users/{userId}/role` fuer die geforderte Admin-Funktion.

9. Upload-Rate-Limit
- Unklarheit: Tech Spec fordert Upload-Rate-Limiting, aber ohne Schwellwerte.
- Entscheidung: Sliding-Window-Limit fuer Proof-Uploads auf `10` Requests pro `60` Sekunden pro User/IP.
- Folge: Bei Ueberschreitung antwortet die API mit HTTP 429.

10. KPI-Definitionen fuer Pilot
- Unklarheit: KPI-Formeln sind im PRD benannt, aber nicht formalisiert.
- Entscheidung:
  - `median_ticket_to_accepted_seconds`: Median aus `accepted_at - created_at` fuer akzeptierte Tickets.
  - `first_pass_proof_complete_rate`: Anteil Tickets, deren erster entschiedener Proof direkt `APPROVED` ist.
  - `avg_qa_cycle_seconds`: Mittelwert aus `qa_decision_at - submitted_at`.
  - `change_request_rate`: Anteil `CHANGES_REQUESTED` unter QA-entschiedenen Proofs.

11. Template 3 Klassenwahl
- Unklarheit: Vorlage 3 ist in `06_TASK_TEMPLATES.md` als Klasse 2/3 Kontext beschrieben.
- Entscheidung: Seed defaultet auf Klasse `3` (konservativ/fachkraftpflichtig).

12. QA Queue Darstellung
- Unklarheit: UI-Flow fordert QA Queue als Proof-Liste mit Flag-Filtern, bestehende API war ticket-zentriert.
- Entscheidung: Neuer Endpunkt `GET /qa/queue?flag=...` liefert pending Proofs mit `geo_fail`, `time_fail`, `exif_missing` Filtern.

13. Projekt-Report Erzeugung
- Unklarheit: PRD fordert Projekt-Export, vorhandene API hatte nur Ticket-PDF.
- Entscheidung: Neuer Endpunkt `GET /reports/project.pdf?project_id=...`; Requester duerfen nur eigene Projekte exportieren.

14. Projekt-Basis API
- Unklarheit: Fuer Projekt-Filter und Projekt-Report fehlte ein einfacher Create/List-Flow.
- Entscheidung: Minimal ergaenzt um `GET /projects` und `POST /projects`, plus Demo-Projekt-Seed fuer requester.

15. Proof Viewer Dateizugriff
- Unklarheit: Q-02 verlangt Foto-Ansicht, aber es gab keinen Download-Endpoint fuer gespeicherte Proof-Dateien.
- Entscheidung: Neuer geschuetzter QA-Endpoint `GET /proofs/{proofId}/files/{fileId}` streamt Bilder inline mit DB-MIME-Type.

16. EXIF-Fallback beim Proof Upload
- Unklarheit: PRD fordert EXIF-Extraction, aber Upload erlaubte nur manuelle Felder.
- Entscheidung: EXIF wird pro hochgeladenem Bild gelesen; fehlende `gps_lat`, `gps_lng`, `captured_at` werden aus EXIF aufgefuellt.
- Default: EXIF-Zeitstempel ohne explizite Zeitzone werden als UTC interpretiert.
- Folge: `validation_flags_json.exif_present` basiert auf real gefundenen EXIF-Daten, nicht auf manuell gesetztem `captured_at`.

17. Redundanz im bestehenden Lifecycle
- Unklarheit: PRD nennt optional Redundanz, Statusmodell hat aber keinen separaten Sammelstatus.
- Entscheidung: `proof_policy_json.redundancy` wird als Mindestanzahl `APPROVED`-Proofs (integer, min 1) ausgewertet; Ticket bleibt bis Erreichen in `PROOF_SUBMITTED`.
- Folge: Zusaeztliche Proof-Uploads sind in `PROOF_SUBMITTED` erlaubt, damit Redundanz ohne Statusbruch erfuellt werden kann.

18. Karten-Preview im MVP
- Unklarheit: UI-Flow fordert Kartenansichten, ohne feste Kartenbibliothek im Tech-Stack.
- Entscheidung: Karte wird als leichte Static-Map-Preview (OpenStreetMap Static Map) in Requester/Worker/QA Screens gerendert.
