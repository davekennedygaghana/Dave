-- OrthoBoard — Reference Lab: skema awal
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','learner')),
  created_at    TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE categories (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100
);

INSERT INTO categories (slug, name, sort_order) VALUES
  ('basic-science',        'Basic science dan biomekanik',            10),
  ('anatomy',              'Anatomi serta korelasi klinis',           20),
  ('surgical-approaches',  'Surgical approaches dan structures at risk', 30),
  ('trauma',               'Trauma',                                  40),
  ('spine',                'Spine',                                   50),
  ('sports',               'Sports medicine',                         60),
  ('adult-reconstruction', 'Adult reconstruction',                    70),
  ('pediatric',            'Pediatric orthopaedics',                  80),
  ('hand-upper-extremity', 'Hand dan upper extremity',                90),
  ('foot-ankle',           'Foot dan ankle',                         100),
  ('oncology',             'Oncology',                               110),
  ('infection',            'Infeksi',                                120),
  ('other',                'Topik lain',                             999);

-- Sumber referensi (PDF) yang diunggah admin
CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  edition     TEXT NOT NULL DEFAULT '',
  authors     TEXT NOT NULL DEFAULT '',
  filename    TEXT,            -- nama berkas asli (NULL = sumber tanpa berkas)
  stored_name TEXT,            -- nama berkas di DATA_DIR/sources
  size_bytes  INTEGER,
  sha256      TEXT,
  page_count  INTEGER,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sources_sha ON sources(sha256) WHERE sha256 IS NOT NULL;

-- Cache teks per halaman PDF (untuk peninjauan dan generasi draft)
CREATE TABLE source_pages (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page      INTEGER NOT NULL,
  text      TEXT NOT NULL,
  PRIMARY KEY (source_id, page)
);

CREATE TABLE questions (
  id            TEXT PRIMARY KEY,           -- ID permanen, tidak pernah dipakai ulang
  format        TEXT NOT NULL CHECK (format IN ('cbt','viva','osce','essay')),
  category      TEXT NOT NULL REFERENCES categories(slug),
  topic         TEXT NOT NULL DEFAULT '',
  subtopic      TEXT NOT NULL DEFAULT '',
  body_region   TEXT NOT NULL DEFAULT '',
  difficulty    TEXT NOT NULL DEFAULT 'sedang' CHECK (difficulty IN ('mudah','sedang','sulit')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','needs_review','approved')),
  is_demo       INTEGER NOT NULL DEFAULT 0,
  content       TEXT NOT NULL,              -- JSON sesuai format
  source_id     INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  book_title    TEXT NOT NULL DEFAULT '',
  edition       TEXT NOT NULL DEFAULT '',
  chapter       TEXT NOT NULL DEFAULT '',
  pdf_page_start INTEGER,
  pdf_page_end   INTEGER,
  print_page     TEXT,                      -- nomor halaman cetak (teks, mis. "412-413")
  print_page_verified INTEGER NOT NULL DEFAULT 0,
  review_note   TEXT NOT NULL DEFAULT '',   -- alasan perlu ditinjau
  origin        TEXT NOT NULL DEFAULT 'manual', -- manual | import | ai
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  approved_at   TEXT,
  approved_by   INTEGER REFERENCES users(id),
  -- soal demo tidak boleh berstatus disetujui
  CHECK (NOT (is_demo = 1 AND status = 'approved'))
);
CREATE INDEX questions_status ON questions(status, is_demo);
CREATE INDEX questions_category ON questions(category, format);

CREATE TABLE question_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,   -- JSON seluruh isi soal pada versi tersebut
  change_note TEXT NOT NULL DEFAULT '',
  changed_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (question_id, version)
);

-- Paket harian (satu per pengguna per tanggal WITA)
CREATE TABLE daily_packages (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,        -- YYYY-MM-DD menurut zona waktu aplikasi
  target     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE daily_package_items (
  package_id  TEXT NOT NULL REFERENCES daily_packages(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  PRIMARY KEY (package_id, position),
  UNIQUE (package_id, question_id)
);

-- Soal yang pernah dibuka dalam mode soal baru (tidak boleh masuk paket baru lagi)
CREATE TABLE question_exposures (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  package_id  TEXT,
  opened_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('new','remedial')),
  mode        TEXT NOT NULL CHECK (mode IN ('practice','exam')),
  package_id  TEXT REFERENCES daily_packages(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  current_index INTEGER NOT NULL DEFAULT 0,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  time_limit_seconds INTEGER,
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX sessions_user ON sessions(user_id, status);

CREATE TABLE session_items (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  opened_at   TEXT,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, question_id)
);

-- Satu baris per soal per sesi. graded_at NULL = belum dinilai (tidak dihitung selesai).
CREATE TABLE attempts (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  package_id  TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('new','remedial')),
  format      TEXT NOT NULL,
  question_version INTEGER NOT NULL,
  response    TEXT NOT NULL DEFAULT '{}',  -- JSON: {choice} atau {text}
  submitted_at TEXT,                       -- jawaban dikunci
  graded_at   TEXT,
  auto_graded INTEGER NOT NULL DEFAULT 0,  -- 1 = nilai otomatis (CBT), 0 = nilai mandiri
  is_correct  INTEGER,
  score       REAL,                        -- 0..1
  grade       TEXT,                        -- JSON: {checked:[...], criticalMissed:[...]}
  updated_at  TEXT NOT NULL,
  UNIQUE (session_id, question_id)
);
-- Satu soal hanya bisa punya satu percobaan "soal baru" per pengguna: tidak mungkin terhitung ganda
CREATE UNIQUE INDEX attempts_new_once ON attempts(user_id, question_id) WHERE kind = 'new';
CREATE INDEX attempts_user_q ON attempts(user_id, question_id, graded_at);
CREATE INDEX attempts_package ON attempts(package_id);

CREATE TABLE bookmarks (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

-- Antrean generasi draft oleh AI (opsional)
CREATE TABLE ai_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page_start  INTEGER NOT NULL,
  page_end    INTEGER NOT NULL,
  format      TEXT NOT NULL,
  category    TEXT NOT NULL,
  chapter     TEXT NOT NULL DEFAULT '',
  count       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX ai_jobs_status ON ai_jobs(status, id);
