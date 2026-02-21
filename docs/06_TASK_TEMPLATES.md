# TASK TEMPLATES — Beispiele (MVP)

## Template 1: Vegetationskontrolle (Bodenschutz / Luzerne)
- Kategorie: Vegetationskontrolle - Bodenschutz
- Klasse: 1
- Default Geofence: 25m
- Proof Policy:
  - min_photos: 2 (Uebersicht + Detail)
  - require_gps: true
  - require_time_window: optional
  - redundancy: 2 (2 unterschiedliche Worker)
- Pflichtfelder / Checkliste:
  - wuchs_status: OK | ZU_NIEDRIG | NICHT_VORHANDEN (pflicht)
  - kommentar: text (optional)
- Safety:
  - public_access_only: true
  - no_trespass: true

## Template 2: Werkzeugreinigung nach SOP
- Kategorie: Werkzeugreinigung SOP
- Klasse: 2
- Default Geofence: 50m (Werkstatt / Rueckgabeort)
- Proof Policy:
  - min_photos: 4 (vorher/nachher + Seriennummer + Ablageort)
  - require_gps: true
  - redundancy: 0
- Checkliste (pflicht):
  - werkzeug_id: string (Barcode/Seriennummer)
  - reinigungsschritte: array bools (SOP-Items)
  - schutzkleidung_getragen: true/false
  - rueckgabe_bestaetigt: true/false
- Safety:
  - public_access_only: false
  - permit_required: true (falls Zugriff nur intern)

## Template 3: Probenentnahme nach Anleitung (nur als Konzept — Klasse 2/3 je nach Regulierung)
- Kategorie: Probenentnahme SOP
- Hinweis:
  - In vielen Faellen fachlich/regulatorisch sensibel. Im MVP nur wenn SOP + Freigabe vorhanden.
  - Sonst als Klasse 3 abbilden (Fachkraftpflicht).
