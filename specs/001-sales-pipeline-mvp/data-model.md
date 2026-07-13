# Data Model — 001 · Sales Pipeline MVP

Storage: `bun:sqlite` (single file `pipeline.db`). No ORM (Article VIII). Constitution invariants enforced at the schema level where possible.

## Entities & schema

```sql
PRAGMA foreign_keys = ON;

-- PROJECT (builder + micro-area precision — Article V)
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  builder_name       TEXT NOT NULL,
  project_name       TEXT NOT NULL,
  area               TEXT NOT NULL,
  micro_area         TEXT NOT NULL,            -- REQUIRED; never coarse (Article V)
  total_units        INTEGER NOT NULL,
  exclusivity_start  TEXT,                     -- ISO date
  exclusivity_end    TEXT,                     -- ISO date; max 8+4 months (Ν.4072/2012)
  exclusivity_phase  TEXT,
  commission_model   TEXT,                     -- 'buyer_only' | 'hybrid'
  listed_at          TEXT NOT NULL
);

-- UNIT
CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  unit_code          TEXT NOT NULL,
  floor              INTEGER,
  sqm                REAL,
  rooms              INTEGER,
  orientation        TEXT,
  features_json      TEXT,                     -- parking, storage, energy_class, etc.
  asking_initial     INTEGER NOT NULL,
  asking_current     INTEGER NOT NULL,
  sale_price         INTEGER,                  -- NULL until contract
  status             TEXT NOT NULL DEFAULT 'live'  -- live|reserved|sold|withdrawn
);

CREATE TABLE price_changes (
  id INTEGER PRIMARY KEY,
  unit_id            INTEGER NOT NULL REFERENCES units(id),
  changed_at         TEXT NOT NULL,
  old_price          INTEGER NOT NULL,
  new_price          INTEGER NOT NULL,
  reason             TEXT
);

-- BUYER (analytical — NO PII, Article IV)
CREATE TABLE buyers (
  id INTEGER PRIMARY KEY,
  pseudonym          TEXT NOT NULL UNIQUE,     -- e.g. "#14"
  segment            TEXT,                     -- first_home|investor|upgrader|foreign
  budget_band        TEXT,                     -- '<150k'|'150-250k'|'250-400k'|'400k+'
  financing          TEXT,                     -- cash|mortgage|spiti_mou_2
  area_pref          TEXT,
  source_channel     TEXT NOT NULL,            -- spitogatos|xe|referral|walkin|social
  consent_flag       INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);

-- BUYER IDENTITY (PII — separate, encrypted at rest, Article IV)
-- Insert ONLY when consent/lawful basis recorded. Erasure = DELETE this row;
-- the buyers/opportunities/events rows survive de-identified (right-to-erasure, minimum-legal GDPR).
CREATE TABLE buyer_identity (
  buyer_id           INTEGER PRIMARY KEY REFERENCES buyers(id),
  name_enc           BLOB,                     -- AES-GCM; key from non-committed secret
  phone_enc          BLOB,
  email_enc          BLOB,
  consent_date       TEXT
);

-- OPPORTUNITY (one live buyer↔project relationship; carries stage + next action)
CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  buyer_id           INTEGER NOT NULL REFERENCES buyers(id),
  focus_unit_id      INTEGER REFERENCES units(id),  -- current unit of focus; NULL if still "ψάχνει"
  stage              TEXT NOT NULL,            -- Lead|Επίσκεψη|Προσφορά|Κράτηση|Συμβόλαιο|Fallthrough
  temperature        TEXT NOT NULL,            -- hot|warm|cold
  next_action        TEXT NOT NULL CHECK (length(trim(next_action)) > 0),  -- Article II, enforced
  next_owner         TEXT NOT NULL,            -- one of: Χρήστος | Λωίδα | Γιολάντα
  updated_at         TEXT NOT NULL,
  UNIQUE(buyer_id, project_id)                 -- GRAIN: one opportunity per buyer per project
);

-- SALES EVENT (append-only log; funnel + separation test via handled_by)
CREATE TABLE sales_events (
  id INTEGER PRIMARY KEY,
  opportunity_id     INTEGER NOT NULL REFERENCES opportunities(id),
  unit_id            INTEGER REFERENCES units(id),  -- the specific unit this viewing/offer was on
  event_type         TEXT NOT NULL,            -- inquiry|viewing|offer|reservation|contract|fallthrough
  event_date         TEXT NOT NULL,
  interest           INTEGER,                  -- 1..5 for viewings
  amount             INTEGER,                  -- for offers
  note               TEXT,
  handled_by         TEXT NOT NULL,            -- Χρήστος|Λωίδα|Γιολάντα — Article VI / separation test
  next_action        TEXT NOT NULL CHECK (length(trim(next_action)) > 0)
);

-- MARKETING ASSET (attribution + CAC)
CREATE TABLE marketing_assets (
  id INTEGER PRIMARY KEY,
  project_id         INTEGER REFERENCES projects(id),
  unit_id            INTEGER REFERENCES units(id),
  asset_type         TEXT NOT NULL,            -- render|staging|tour|listing_copy
  tool_used          TEXT,                     -- Cedreo|VSAI|CloudPano
  cost               REAL,
  produced_at        TEXT
);

CREATE INDEX idx_opp_project ON opportunities(project_id);
CREATE INDEX idx_events_opp ON sales_events(opportunity_id);
CREATE INDEX idx_buyers_seg ON buyers(segment, area_pref);

-- COMPS (neighbourhood comparables: own sold units + operator-entered known REAL sales)
CREATE TABLE comps (
  id INTEGER PRIMARY KEY,
  area               TEXT NOT NULL,
  micro_area         TEXT NOT NULL,            -- Article V granularity applies here too
  sqm                REAL,
  rooms              INTEGER,
  sale_price         INTEGER NOT NULL,         -- actual SALE price, never asking
  sale_date          TEXT,
  source             TEXT NOT NULL,            -- 'own_transaction' | 'manual_known_sale'
  entered_by         TEXT,                     -- operator, for manual entries
  note               TEXT
);
CREATE INDEX idx_comps_area ON comps(micro_area);
```

## Derived metric views (deterministic — Article III)

```sql
-- Reservation velocity (leading indicator)
CREATE VIEW v_velocity AS
SELECT o.project_id,
       AVG(julianday(res.event_date) - julianday(o.updated_at)) AS avg_days_to_reservation
FROM opportunities o
JOIN sales_events res ON res.opportunity_id = o.id AND res.event_type = 'reservation'
GROUP BY o.project_id;

-- Price realization
CREATE VIEW v_price_realization AS
SELECT u.project_id, u.id AS unit_id,
       CAST(u.sale_price AS REAL) / u.asking_initial AS realization
FROM units u WHERE u.sale_price IS NOT NULL;

-- Ready-buyer pool (the strongest, non-copyable number)
CREATE VIEW v_buyer_pool AS
SELECT segment, area_pref, budget_band, COUNT(*) AS ready_buyers
FROM buyers GROUP BY segment, area_pref, budget_band;

-- Separation test
CREATE VIEW v_separation AS
SELECT handled_by, COUNT(*) AS events
FROM sales_events GROUP BY handled_by;
```

## Derived logic (implemented in code, deterministic)

- **temperature(interest)**: `interest >= 4 → hot`, `=3 → warm`, `<=2 → cold`. Offers → hot.
- **counter(asking, offer)**: only if `offer < asking`. `pct_below = (asking-offer)/asking`; `suggested = round((offer + (asking-offer)*0.6) / 500) * 500` (weighted toward asking, rounded to €500).
- **recommendation(unit)** for reports: many viewings & 0 offers → "τιμή ψηλά, προτεινόμενη προσαρμογή €X (βάσει comps)"; few viewings → "presentation/channel — staging refresh ή αλλαγή καναλιού"; healthy → "hold".
