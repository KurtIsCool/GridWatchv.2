PRAGMA foreign_keys = ON;

CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  publisher TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  external_id TEXT,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  raw_object_key TEXT,
  inline_content TEXT,
  processing_status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK(current_revision > 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX source_items_publisher_external_id ON source_items(publisher, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX source_items_source_url ON source_items(source_url);
CREATE INDEX source_items_content_hash ON source_items(content_hash);
CREATE INDEX source_items_retrieved_at ON source_items(retrieved_at DESC);

CREATE TABLE source_revisions (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  retrieved_at TEXT NOT NULL,
  raw_object_key TEXT,
  UNIQUE(source_item_id, revision_number),
  UNIQUE(source_item_id, content_hash)
);

CREATE TABLE candidate_events (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  parser_version TEXT NOT NULL,
  ai_model TEXT,
  extraction_json TEXT,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  validation_status TEXT NOT NULL CHECK(validation_status IN ('VALIDATED','REVIEW_REQUIRED','REJECTED')),
  validation_errors TEXT NOT NULL DEFAULT '[]',
  review_reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(source_item_id, source_revision, parser_version)
);
CREATE INDEX candidate_events_validation_status ON candidate_events(validation_status, created_at DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE RESTRICT,
  candidate_event_id TEXT NOT NULL UNIQUE REFERENCES candidate_events(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  event_type TEXT NOT NULL CHECK(event_type IN ('CONFIRMED','SCHEDULED','GRID_RISK','COMMUNITY','RESTORED','UNKNOWN')),
  status TEXT NOT NULL CHECK(status IN ('PUBLISHED','SUPERSEDED','REVOKED')),
  cause TEXT,
  start_at TEXT,
  end_at TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  reviewed_at TEXT,
  supersedes TEXT REFERENCES events(id),
  created_at TEXT NOT NULL,
  UNIQUE(source_item_id, revision)
);
CREATE INDEX events_public_timeline ON events(status, start_at DESC, published_at DESC);

CREATE TABLE event_targets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  barangay_psgc TEXT NOT NULL CHECK(length(barangay_psgc) = 10),
  canonical_name TEXT NOT NULL,
  coverage TEXT NOT NULL CHECK(coverage IN ('WHOLE','PORTION','UNKNOWN')),
  match_status TEXT NOT NULL,
  UNIQUE(event_id, barangay_psgc, source_label)
);
CREATE INDEX event_targets_barangay ON event_targets(barangay_psgc, event_id);

CREATE TABLE event_feeders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  feeder_id TEXT NOT NULL,
  match_status TEXT NOT NULL,
  UNIQUE(event_id, feeder_id)
);
CREATE INDEX event_feeders_feeder ON event_feeders(feeder_id, event_id);

CREATE TABLE review_queue (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  candidate_event_id TEXT NOT NULL REFERENCES candidate_events(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX review_queue_one_pending ON review_queue(candidate_event_id) WHERE status = 'PENDING';

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  items_detected INTEGER NOT NULL DEFAULT 0 CHECK(items_detected >= 0),
  items_processed INTEGER NOT NULL DEFAULT 0 CHECK(items_processed >= 0),
  error_message TEXT
);
CREATE INDEX ingestion_runs_source_time ON ingestion_runs(source, started_at DESC);

CREATE TABLE usage_daily (
  date TEXT PRIMARY KEY,
  browser_runs INTEGER NOT NULL DEFAULT 0 CHECK(browser_runs >= 0),
  browser_seconds INTEGER NOT NULL DEFAULT 0 CHECK(browser_seconds >= 0),
  ai_calls INTEGER NOT NULL DEFAULT 0 CHECK(ai_calls >= 0),
  ai_units INTEGER NOT NULL DEFAULT 0 CHECK(ai_units >= 0),
  queue_operations INTEGER NOT NULL DEFAULT 0 CHECK(queue_operations >= 0)
);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resource TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX operational_events_type_time ON operational_events(type, created_at DESC);
