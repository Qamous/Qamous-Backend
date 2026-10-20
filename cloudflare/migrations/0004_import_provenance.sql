-- Import ownership is deliberately separate from original authorship.
ALTER TABLE users ADD COLUMN accountKind TEXT NOT NULL DEFAULT 'member' CHECK(accountKind IN ('member','import'));
ALTER TABLE definitions ADD COLUMN languageCode TEXT;
ALTER TABLE definitions ADD COLUMN displayLanguage TEXT NOT NULL DEFAULT 'legacy' CHECK(displayLanguage IN ('legacy','ar','en','hidden'));
CREATE VIEW public_definitions AS SELECT * FROM definitions WHERE displayLanguage!='hidden';
CREATE TABLE import_accounts (
  aliasIndex INTEGER PRIMARY KEY CHECK(aliasIndex BETWEEN 0 AND 29),
  userId INTEGER NOT NULL UNIQUE REFERENCES users(id)
);
CREATE TABLE import_sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sourceUrl TEXT NOT NULL,
  license TEXT NOT NULL, licenseUrl TEXT NOT NULL, rightsStatus TEXT NOT NULL,
  credit TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '',
  attributionRequired INTEGER NOT NULL CHECK(attributionRequired IN (0,1)),
  releaseHash TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY, manifestHash TEXT NOT NULL, createdAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'local_preview', approvedAt TEXT,
  reportJson TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE import_license_documents (
  sourceId TEXT PRIMARY KEY REFERENCES import_sources(id),
  fileName TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE import_records (
  recordKey INTEGER PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES import_sources(id),
  sourceEntryId TEXT NOT NULL, sourceUrl TEXT NOT NULL,
  importerUserId INTEGER NOT NULL REFERENCES users(id),
  batchId INTEGER NOT NULL REFERENCES import_batches(id), contentHash BLOB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','held','duplicate','removed')),
  reasons TEXT NOT NULL DEFAULT '[]', wordId INTEGER REFERENCES words(id) ON DELETE SET NULL,
  arabic TEXT NOT NULL, franco TEXT NOT NULL, transliteration TEXT NOT NULL,
  dialect TEXT NOT NULL, definitionAr TEXT NOT NULL, definitionEn TEXT NOT NULL,
  originalMetadata TEXT NOT NULL DEFAULT '{}', fingerprint BLOB NOT NULL UNIQUE,
  importedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX import_records_source_status ON import_records(sourceId,status,recordKey);
CREATE INDEX import_records_batch ON import_records(batchId,recordKey);
CREATE INDEX import_records_account ON import_records(importerUserId);
CREATE INDEX import_records_source_batch_word ON import_records(sourceId,batchId,wordId,recordKey);
CREATE TABLE definition_provenance (
  definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
  recordKey INTEGER NOT NULL REFERENCES import_records(recordKey) ON DELETE CASCADE,
  language TEXT NOT NULL,
  changes INTEGER NOT NULL REFERENCES import_change_templates(id),
  PRIMARY KEY(definitionId,recordKey,language)
) WITHOUT ROWID;
CREATE TABLE import_change_templates (id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE);
CREATE INDEX definition_provenance_record ON definition_provenance(recordKey);
CREATE TABLE definition_examples (
  id INTEGER PRIMARY KEY, definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
  recordKey INTEGER NOT NULL REFERENCES import_records(recordKey) ON DELETE CASCADE,
  text TEXT NOT NULL, language TEXT NOT NULL,
  script TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'usage',
  UNIQUE(definitionId,recordKey,text,language)
);
CREATE INDEX definition_examples_definition ON definition_examples(definitionId);
CREATE INDEX definition_examples_record ON definition_examples(recordKey);
CREATE TABLE import_example_holds (
  recordKey INTEGER NOT NULL REFERENCES import_records(recordKey) ON DELETE CASCADE,
  itemKey TEXT NOT NULL, reason TEXT NOT NULL, original TEXT NOT NULL,
  PRIMARY KEY(recordKey,itemKey)
);
CREATE TABLE import_spelling_holds (
  recordKey INTEGER NOT NULL REFERENCES import_records(recordKey) ON DELETE CASCADE,
  spelling TEXT NOT NULL, reasons TEXT NOT NULL,
  PRIMARY KEY(recordKey,spelling)
);
-- Shared credits never overwrite a real member's text or ownership.
CREATE INDEX definitions_exact_import_match ON definitions(wordId,isArabic,countryCode);
-- Text pronunciation is never substituted for an Arabizi spelling. Audio is
-- excluded unless a separate, verified grant authorizes its reuse.
CREATE TABLE import_pronunciations (
  recordKey INTEGER NOT NULL REFERENCES import_records(recordKey) ON DELETE CASCADE,
  scheme TEXT NOT NULL, value TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ar',
  kind TEXT NOT NULL DEFAULT 'transcription',
  PRIMARY KEY(recordKey,scheme,value)
) WITHOUT ROWID;
