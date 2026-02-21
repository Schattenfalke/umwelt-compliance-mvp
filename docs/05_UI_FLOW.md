# UI FLOW — Screens & Navigation (MVP)

## 1) Global
- Top Nav: Tickets, Projekte (optional), QA Queue (nur QA), Admin (nur Admin), Profil/Logout
- Mobile: Bottom Tabs (Tickets / QA / Profil)

## 2) Screens (Requesters)
### R-01 Ticket Liste (Projektfilter optional)
- Tabelle: Titel, Kategorie, Klasse, Status, Deadline, Assigned
- Actions: Neues Ticket

### R-02 Ticket erstellen
- Form:
  - Titel, Beschreibung
  - Kategorie, Task-Klasse
  - Standort: Karte + Pin + lat/lng (copy)
  - Geofence Radius Slider
  - Zeitfenster (optional) + Deadline
  - Proof-Policy: min Fotos, Redundanz, Pflichtfelder (simple builder)
  - Safety Flags: public_access_only, permit_required, no_trespass
- Submit -> Status NEW

### R-03 Ticket Detail (read-only + Timeline)
- Status Badge + Timeline (StatusEvents)
- Proofs Liste (falls vorhanden)
- Report Button

## 3) Screens (Workers)
### W-01 Mission Feed (Karte + Liste)
- Karte mit Pins
- Liste sortiert nach Distanz
- Filter: Kategorie, Klasse, Distanz

### W-02 Ticket Detail (vor Annahme)
- Regeln sichtbar: Geofence, Deadline, Proof-Policy, Zutritthinweise
- Button: Annehmen

### W-03 Active Ticket (nach Annahme)
- Checkliste (Pflichtfelder)
- Upload area (Fotos)
- Meta-Hinweis: GPS an, Uhrzeit ok
- Submit Proof

### W-04 Proof Status
- Anzeige: Pending / Changes Requested / Approved
- Bei Changes Requested: QA Kommentar + Button „Nachbessern“

## 4) Screens (QA)
### Q-01 QA Queue
- Liste Proofs: Ticket, Kategorie, Worker, Validierungsflags, eingereicht am
- Filter: flags (geo_fail, time_fail, exif_missing)

### Q-02 QA Review
- Proof viewer: Fotos + Map preview + Metadaten
- Checkliste Antworten
- Buttons: Approve / Request Changes / Reject / Escalate
- Kommentar Pflicht bei Request/Reject/Escalate

## 5) Admin (minimal)
- User Liste (role setzen)
- Template CRUD (optional MVP)
