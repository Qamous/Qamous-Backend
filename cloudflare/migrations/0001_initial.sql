PRAGMA foreign_keys = ON;
CREATE TABLE countries (countryCode TEXT PRIMARY KEY, countryName TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firstName TEXT NOT NULL, lastName TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password TEXT, dateOfBirth TEXT, profilePicture BLOB,
  likesReceived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL, countryCountryCode TEXT REFERENCES countries(countryCode),
  points INTEGER NOT NULL DEFAULT 0,
  passwordVersion TEXT NOT NULL DEFAULT 'legacy'
);
CREATE TABLE words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES users(id),
  arabicWord TEXT NOT NULL, francoArabicWord TEXT,
  createdAt TEXT NOT NULL, reportCount INTEGER NOT NULL DEFAULT 0,
  searchText TEXT NOT NULL DEFAULT ''
);
CREATE TABLE definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wordId INTEGER NOT NULL REFERENCES words(id),
  userId INTEGER NOT NULL REFERENCES users(id),
  countryCode TEXT REFERENCES countries(countryCode),
  definition TEXT NOT NULL, example TEXT, isArabic INTEGER NOT NULL,
  AddedTimestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  likeCount INTEGER NOT NULL DEFAULT 0, dislikeCount INTEGER NOT NULL DEFAULT 0,
  reportCount INTEGER NOT NULL DEFAULT 0, searchText TEXT NOT NULL DEFAULT ''
);
CREATE TABLE "definition-likes-dislikes" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liked INTEGER NOT NULL CHECK (liked IN (0,1)),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX reactions_pair ON "definition-likes-dislikes"(definitionId,userId,id DESC);
CREATE TABLE "definition-reports" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
  definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
  reportText TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE TABLE "word-reports" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
  wordId INTEGER NOT NULL REFERENCES words(id), reportText TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE TABLE words_countries_countries (
  wordsId INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE ON UPDATE CASCADE,
  countriesCountryCode TEXT NOT NULL REFERENCES countries(countryCode) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY(wordsId,countriesCountryCode)
);
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX session_expiry ON sessions(expires);
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reset_user ON password_resets(user_id);
CREATE TABLE posts (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
  createdSeconds INTEGER NOT NULL, createdNanoseconds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE embeddings (
  documentId TEXT PRIMARY KEY, wordId INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  content TEXT NOT NULL, contentHash TEXT NOT NULL, vector TEXT, updatedAt INTEGER NOT NULL
);
CREATE INDEX definitions_word ON definitions(wordId,isArabic);
CREATE INDEX definitions_user ON definitions(userId);
CREATE INDEX definitions_country ON definitions(countryCode);
CREATE INDEX words_owner ON words(userId);
CREATE INDEX word_reports_pair ON "word-reports"(wordId,userId);
CREATE INDEX definition_reports_pair ON "definition-reports"(definitionId,userId);
