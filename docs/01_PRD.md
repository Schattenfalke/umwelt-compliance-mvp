# PRD — Umwelt-Compliance Micro-Services (MVP)

## 0) Zielbild (1 Satz)
Eine Plattform, auf der auslagerbare Umwelt-Compliance Micro-Tasks als Tickets erfasst, von geeigneten Personen ausgefuehrt, per Proof (Foto/Metadaten/Checkliste) nachgewiesen und durch QA freigegeben werden — mit Audit-Trail und Report.

## 1) Problem / Ausgangslage
- In Projekten entstehen kleinteilige, wiederkehrende Feldaufgaben (Kontrolle, Foto, einfache SOP-Taetigkeiten).
- Ohne Plattform werden diese Aufgaben oft „nebenbei“ von Fachkraeften erledigt.
- Ergebnis: Fachkapazitaet ist gebunden, Nachweise sind heterogen, Audit-Trail ist lueckenhaft.

## 2) Zielgruppe / Personas
### Auftraggeber (PM / Umweltkoordination / Bauleitung)
- Will Tickets schnell erstellen, Regeln definieren, Status sehen, Reports exportieren.

### Ausfuehrende Person (Crowd / Student / Field-Tech / Partnerbetrieb)
- Will nahe Tickets sehen, sicher wissen „was gilt“, Aufgabe sauber abarbeiten, Proof hochladen, Geld/Badge erhalten.

### QA (Fachpruefung)
- Will Proof in Warteschlange prüfen, schnell nachfordern, Freigabe dokumentieren, Eskalation ausloesen.

## 3) MVP-Scope (hart)
### Im MVP drin
- Rollen: Auftraggeber, Ausfuehrende, QA, Admin (minimal)
- Task-Klassen: Klasse 1 (Crowd-faehig), Klasse 2 (Assistenz nach SOP), Klasse 3 nur als Eskalation (kein Crowd)
- Ticket-Lifecycle: Neu → Qualifiziert → Ausgespielt → Angenommen → Proof → QA → Abschluss
- Proof: Foto-Upload + Meta (GPS/Zeit) + Pflichtfelder + Checkliste
- QA: Freigabe / Nachforderung / Ablehnung / Eskalation
- Reporting: PDF pro Ticket + Projekt (Audit-Trail + Proof)

### Nicht im MVP (Non-Goals)
- Vollstaendige Abrechnung/Payroll, In-App Wallet
- Native App (nur Web + Mobile Web)
- KI-gestuetzte Bildanalyse als harte Entscheidung
- Komplexe Mehrmandanten-Compliance-Suiten
- Offline-first

## 4) Kern-Workflows (User Stories + Akzeptanz)
### US-01: Ticket erstellen (Auftraggeber)
**Als** Auftraggeber  
**moechte** ich ein Ticket mit Ort, Zeitfenster, Kategorie und Proof-Regeln erstellen,  
**damit** die Aufgabe standardisiert ausgelagert werden kann.

Akzeptanz:
- Pflichtfelder: Titel, Kategorie, Klasse, Standort (lat/lng), Geofence-Radius, Deadline, Proof-Policy
- System setzt Status = Neu
- Ticket ist im Backoffice sichtbar, aber noch nicht „ausgespielt“

### US-02: Ticket qualifizieren (QA)
Akzeptanz:
- QA kann Klasse und Proof-Policy bestaetigen oder korrigieren
- Status wechselt: Neu → Qualifiziert
- Audit-Trail schreibt: wer/wann/was

### US-03: Ticket-Feed (Ausfuehrende)
Akzeptanz:
- Ausfuehrende sehen Tickets nach Distanz + Sichtbarkeit + Skill/Tag Match
- Tickets im Status „Ausgespielt“ sind sichtbar
- Karte und Liste (minimal) vorhanden

### US-04: Ticket annehmen
Akzeptanz:
- Nur 1 aktive Annahme pro Ticket (Lock)
- Status: Ausgespielt → Angenommen
- SLA-Countdown (optional): Startzeit gespeichert

### US-05: Checkliste abarbeiten + Proof hochladen
Akzeptanz:
- Checkliste muss zu 100% ausgefuellt sein (Pflichtfelder)
- Proof Upload: mindestens N Fotos (Policy), EXIF wird extrahiert wenn vorhanden
- Validierungen: Geofence ok, Zeitfenster ok
- Status: Angenommen → Proof (wenn Upload vollstaendig)

### US-06: QA Review
Akzeptanz:
- QA sieht: Fotos, Metadaten, Checkliste, Validierungsflags, Kommentare
- Aktionen:
  - Freigabe: Status Proof → Abschluss
  - Nachforderung: Status bleibt Proof, aber „needs_more_info=true“, Nachricht an Ausfuehrende
  - Ablehnung: Status Proof → Ausgespielt (oder Abgelehnt), Grund wird gespeichert
  - Eskalation: erstellt Klasse-3 Ticket und verknuepft es

### US-07: Abschlussbericht
Akzeptanz:
- PDF enthaelt: Ticketdaten, Statushistorie, Proof-Links/Thumbnails, QA-Entscheidung, Zeitstempel
- Export fuer einzelnes Ticket und fuer Projekt-Filter

## 5) Regeln / Policies (MVP)
- Geofence: Proof gueltig, wenn lat/lng innerhalb Radius (Meters) vom Ticket-Point
- Zeitfenster: Proof gueltig innerhalb Start/Ende oder vor Deadline
- Redundanz (optional pro Ticket): Ticket schliesst erst nach >=2 Proofs von unterschiedlichen Ausfuehrenden
- Sicherheit/Legal: Tickets muessen „Zutritt nur oeffentlich“ oder „Permit required“ Flag haben; Crowd darf keine abgesperrten Bereiche betreten

## 6) Erfolgsmessung (Pilot-KPIs)
- Medianzeit Ticket → Angenommen
- Quote „Proof beim ersten Versuch vollstaendig“
- QA-Durchlaufzeit
- Nachforderungsrate
- Geschaetzte Fachstundenersparnis (Standardzeiten * Ticketvolumen)

## 7) Release-Plan
- Sprint 0: Templates/Policies, Grund-Datenmodell, Auth/RBAC
- Sprint 1: Ticketing + Feed + Annahme
- Sprint 2: Proof Upload + QA Review + Report
- Sprint 3: Pilot-Hardening + Metriken + Admin-Minimum
