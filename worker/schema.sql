-- отчёты: от игрока (кнопка) и автоматические (детекторы); запись сессии — gzip JSON
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,           -- user | auto
  build TEXT, sid TEXT, ua TEXT,
  detector TEXT, text TEXT, frames INTEGER, level INTEGER,
  rec BLOB, shot BLOB
);
-- телеметрия: сессии, уровни, срабатывания детекторов, производительность
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  sid TEXT, build TEXT, type TEXT NOT NULL, level INTEGER, frame INTEGER, data TEXT
);
CREATE INDEX IF NOT EXISTS events_type ON events(type, build);
