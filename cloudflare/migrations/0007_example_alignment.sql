-- Keep the original text and IDs. Alignment comes from source example blocks,
-- never from guessing that nearby sentences are translations.
ALTER TABLE definition_examples ADD COLUMN groupKeys TEXT NOT NULL DEFAULT '[]';
ALTER TABLE definition_examples ADD COLUMN alignment TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE contribution_submissions ADD COLUMN exampleAlignment TEXT NOT NULL DEFAULT 'unverified';
