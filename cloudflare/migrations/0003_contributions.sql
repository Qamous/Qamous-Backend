-- The existing example column is the Franco example. Preserve every old value.
ALTER TABLE definitions ADD COLUMN arabicExample TEXT;

CREATE TABLE word_spellings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wordId INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  script TEXT NOT NULL CHECK(script IN ('ar','franco')),
  spelling TEXT NOT NULL,
  searchText TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(wordId,script,searchText)
);
CREATE INDEX word_spellings_search ON word_spellings(searchText);
CREATE INDEX words_arabic_lookup ON words(arabicWord COLLATE NOCASE);

-- Reserve a request before writing its word/meanings. Retries return the same
-- contribution, including when the response was lost after a successful commit.
CREATE TABLE contribution_submissions (
  id TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payloadHash TEXT NOT NULL,
  wordId INTEGER REFERENCES words(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL
);
ALTER TABLE definitions ADD COLUMN submissionId TEXT REFERENCES contribution_submissions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX definitions_submission_language ON definitions(submissionId,isArabic);
