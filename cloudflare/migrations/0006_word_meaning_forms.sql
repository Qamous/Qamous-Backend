-- Additive representation upgrade. Keep legacy word/definition IDs, authors,
-- timestamps and reaction rows. Source records and submissions identify senses.
ALTER TABLE words ADD COLUMN canonicalArabic TEXT;
UPDATE words SET canonicalArabic=trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(arabicWord,'ً',''),'ٌ',''),'ٍ',''),'َ',''),'ُ',''),'ِ',''),'ّ',''),'ْ',''),'ٰ',''),'ـ',''),'  ',' '),'  ',' '),'  ',' '));
CREATE INDEX words_canonical_arabic ON words(canonicalArabic,id);
CREATE TRIGGER words_canonical_insert AFTER INSERT ON words WHEN NEW.canonicalArabic IS NULL BEGIN UPDATE words SET canonicalArabic=trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(arabicWord,'ً',''),'ٌ',''),'ٍ',''),'َ',''),'ُ',''),'ِ',''),'ّ',''),'ْ',''),'ٰ',''),'ـ',''),'  ',' '),'  ',' '),'  ',' ')) WHERE id=NEW.id; END;
CREATE TRIGGER words_canonical_update AFTER UPDATE OF arabicWord ON words BEGIN UPDATE words SET canonicalArabic=trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(arabicWord,'ً',''),'ٌ',''),'ٍ',''),'َ',''),'ُ',''),'ِ',''),'ّ',''),'ْ',''),'ٰ',''),'ـ',''),'  ',' '),'  ',' '),'  ',' ')) WHERE id=NEW.id; END;
ALTER TABLE contribution_submissions ADD COLUMN arabicForm TEXT;
ALTER TABLE contribution_submissions ADD COLUMN francoForm TEXT;
ALTER TABLE contribution_submissions ADD COLUMN transliteration TEXT;
ALTER TABLE contribution_submissions ADD COLUMN ipa TEXT;
ALTER TABLE contribution_submissions ADD COLUMN englishExample TEXT;
ALTER TABLE contribution_submissions ADD COLUMN dialect TEXT;
ALTER TABLE contribution_submissions ADD COLUMN arabicVariants TEXT;
ALTER TABLE contribution_submissions ADD COLUMN francoVariants TEXT;
ALTER TABLE import_records ADD COLUMN displayFranco TEXT;
-- Existing bilingual submission rows already share a submissionId. Preserve
-- those links; never guess that unrelated definitions are translations.
DROP TRIGGER dictionary_definition_insert;
DROP TRIGGER dictionary_definition_update;
DROP TRIGGER dictionary_definition_delete;
DROP TRIGGER dictionary_word_update;
DROP TRIGGER card_total_insert;
DROP TRIGGER card_total_delete;
-- Retain the previous derived cache for rollback. Renaming avoids bulk
-- deletion during the quota-bounded release; it is no longer read or updated.
ALTER TABLE dictionary_cards RENAME TO dictionary_cards_v1;
DROP INDEX dictionary_cards_popular;
DROP INDEX dictionary_cards_newest;
DROP INDEX dictionary_cards_alphabetic;
DROP INDEX dictionary_cards_definition;
UPDATE dictionary_card_totals SET total=0;
INSERT INTO dictionary_card_totals VALUES(2,0);
CREATE TABLE dictionary_cards (
 canonicalArabic TEXT NOT NULL,isArabic INTEGER NOT NULL,
 wordId INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
 score INTEGER NOT NULL,AddedTimestamp TEXT NOT NULL,sortWord TEXT NOT NULL,
 PRIMARY KEY(canonicalArabic,isArabic)
) WITHOUT ROWID;
CREATE INDEX dictionary_cards_popular ON dictionary_cards(score DESC,definitionId);
CREATE INDEX dictionary_cards_newest ON dictionary_cards(AddedTimestamp DESC,definitionId DESC);
CREATE INDEX dictionary_cards_alphabetic ON dictionary_cards(sortWord COLLATE NOCASE,definitionId);
CREATE INDEX dictionary_cards_definition ON dictionary_cards(definitionId);
CREATE TRIGGER card_total_insert AFTER INSERT ON dictionary_cards BEGIN UPDATE dictionary_card_totals SET total=total+1 WHERE isArabic=NEW.isArabic; UPDATE dictionary_card_totals SET total=total+1 WHERE isArabic=2 AND (SELECT COUNT(*) FROM dictionary_cards WHERE canonicalArabic=NEW.canonicalArabic)=1; END;
CREATE TRIGGER card_total_delete AFTER DELETE ON dictionary_cards BEGIN UPDATE dictionary_card_totals SET total=total-1 WHERE isArabic=OLD.isArabic; UPDATE dictionary_card_totals SET total=total-1 WHERE isArabic=2 AND NOT EXISTS(SELECT 1 FROM dictionary_cards WHERE canonicalArabic=OLD.canonicalArabic); END;
INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY w.canonicalArabic,d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.reportCount<=5 AND w.reportCount<=5
 ) WHERE ranking=1;
CREATE TRIGGER dictionary_definition_insert AFTER INSERT ON definitions WHEN NEW.displayLanguage!='hidden' BEGIN INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=NEW.wordId) AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord; END;
CREATE TRIGGER dictionary_definition_update AFTER UPDATE OF likeCount,dislikeCount,reportCount,displayLanguage,isArabic,wordId,AddedTimestamp ON definitions BEGIN DELETE FROM dictionary_cards WHERE canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=OLD.wordId); INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=OLD.wordId) AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord; INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=NEW.wordId) AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord; END;
CREATE TRIGGER dictionary_definition_delete AFTER DELETE ON definitions BEGIN INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=OLD.wordId) AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord; END;
CREATE TRIGGER dictionary_word_update AFTER UPDATE OF canonicalArabic,francoArabicWord,reportCount ON words BEGIN
 DELETE FROM dictionary_cards WHERE canonicalArabic=OLD.canonicalArabic; INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=NEW.id) AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord;
 INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=OLD.canonicalArabic AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord;
END;
CREATE TRIGGER dictionary_word_delete AFTER DELETE ON words BEGIN INSERT INTO dictionary_cards
 SELECT canonicalArabic,isArabic,wordId,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN canonicalArabic ELSE COALESCE(francoArabicWord,canonicalArabic) END FROM (
 SELECT w.canonicalArabic,d.*,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
 FROM public_definitions d JOIN words w ON w.id=d.wordId
 WHERE w.canonicalArabic=OLD.canonicalArabic AND w.reportCount<=5 AND d.reportCount<=5
 ) WHERE ranking=1
 ON CONFLICT(canonicalArabic,isArabic) DO UPDATE SET wordId=excluded.wordId,definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord; END;
