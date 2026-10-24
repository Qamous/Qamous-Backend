-- Derived public display records. Authoritative content remains in the existing tables.
CREATE TABLE public_card_payloads (
 definitionId INTEGER PRIMARY KEY REFERENCES definitions(id) ON DELETE CASCADE,
 payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE TABLE public_feed_candidates (
 definitionId INTEGER PRIMARY KEY REFERENCES definitions(id) ON DELETE CASCADE,
 isArabic INTEGER NOT NULL, likeCount INTEGER NOT NULL, dislikeCount INTEGER NOT NULL
);
CREATE INDEX public_feed_language ON public_feed_candidates(isArabic,definitionId,likeCount,dislikeCount);
INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE d.reportCount<=5 AND w.reportCount<=5;

CREATE TRIGGER prepared_feed_card_insert AFTER INSERT ON dictionary_cards BEGIN
 DELETE FROM public_feed_candidates WHERE definitionId=NEW.definitionId;
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE c.definitionId=NEW.definitionId AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
END;

CREATE TRIGGER prepared_feed_card_update AFTER UPDATE ON dictionary_cards BEGIN
 DELETE FROM public_feed_candidates WHERE definitionId=NEW.definitionId;
 DELETE FROM public_feed_candidates WHERE definitionId=OLD.definitionId;
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE c.definitionId=NEW.definitionId AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
END;

CREATE TRIGGER prepared_feed_card_delete AFTER DELETE ON dictionary_cards BEGIN
 DELETE FROM public_feed_candidates WHERE definitionId=OLD.definitionId;
END;

CREATE TRIGGER prepared_definition_insert AFTER INSERT ON definitions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (NEW.id);
 DELETE FROM public_feed_candidates WHERE definitionId IN (NEW.id);
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE d.id=NEW.id AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (SELECT canonicalArabic FROM words w WHERE w.id=NEW.wordId));
END;

CREATE TRIGGER prepared_definition_update AFTER UPDATE ON definitions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (OLD.id,NEW.id);
 DELETE FROM public_feed_candidates WHERE definitionId IN (OLD.id,NEW.id);
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE d.id=NEW.id AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (SELECT canonicalArabic FROM words w WHERE w.id=OLD.wordId OR w.id=NEW.wordId));
END;

CREATE TRIGGER prepared_definition_delete AFTER DELETE ON definitions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (OLD.id);
 DELETE FROM public_feed_candidates WHERE definitionId IN (OLD.id);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (SELECT canonicalArabic FROM words w WHERE w.id=OLD.wordId));
END;

CREATE TRIGGER prepared_word_insert AFTER INSERT ON words BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (NEW.canonicalArabic) OR w.id IN (NEW.id));
 DELETE FROM public_feed_candidates WHERE definitionId IN (SELECT id FROM definitions WHERE wordId IN (NEW.id));
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE w.id=NEW.id AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
END;

CREATE TRIGGER prepared_word_update AFTER UPDATE ON words BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (OLD.canonicalArabic,NEW.canonicalArabic) OR w.id IN (OLD.id,NEW.id));
 DELETE FROM public_feed_candidates WHERE definitionId IN (SELECT id FROM definitions WHERE wordId IN (OLD.id,NEW.id));
 INSERT INTO public_feed_candidates
 SELECT d.id,c.isArabic,d.likeCount,d.dislikeCount FROM dictionary_cards c
 JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=d.wordId
 WHERE w.id=NEW.id AND d.reportCount<=5 AND w.reportCount<=5
 ON CONFLICT(definitionId) DO UPDATE SET isArabic=excluded.isArabic,likeCount=excluded.likeCount,dislikeCount=excluded.dislikeCount
 WHERE public_feed_candidates.isArabic!=excluded.isArabic OR public_feed_candidates.likeCount!=excluded.likeCount OR public_feed_candidates.dislikeCount!=excluded.dislikeCount;
END;

CREATE TRIGGER prepared_word_delete AFTER DELETE ON words BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic IN (OLD.canonicalArabic) OR w.id IN (OLD.id));
 DELETE FROM public_feed_candidates WHERE definitionId IN (SELECT id FROM definitions WHERE wordId IN (OLD.id));
END;

CREATE TRIGGER prepared_definition_provenance_insert AFTER INSERT ON definition_provenance BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT NEW.definitionId);
END;

CREATE TRIGGER prepared_definition_provenance_update AFTER UPDATE ON definition_provenance BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT OLD.definitionId);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT NEW.definitionId);
END;

CREATE TRIGGER prepared_definition_provenance_delete AFTER DELETE ON definition_provenance BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT OLD.definitionId);
END;

CREATE TRIGGER prepared_definition_examples_insert AFTER INSERT ON definition_examples BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT NEW.definitionId);
END;

CREATE TRIGGER prepared_definition_examples_update AFTER UPDATE ON definition_examples BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT OLD.definitionId);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT NEW.definitionId);
END;

CREATE TRIGGER prepared_definition_examples_delete AFTER DELETE ON definition_examples BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT OLD.definitionId);
END;

CREATE TRIGGER prepared_import_pronunciations_insert AFTER INSERT ON import_pronunciations BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=NEW.recordKey);
END;

CREATE TRIGGER prepared_import_pronunciations_update AFTER UPDATE ON import_pronunciations BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=OLD.recordKey);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=NEW.recordKey);
END;

CREATE TRIGGER prepared_import_pronunciations_delete AFTER DELETE ON import_pronunciations BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=OLD.recordKey);
END;

CREATE TRIGGER prepared_import_records_insert AFTER INSERT ON import_records BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=NEW.recordKey);
END;

CREATE TRIGGER prepared_import_records_update AFTER UPDATE ON import_records BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=OLD.recordKey);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=NEW.recordKey);
END;

CREATE TRIGGER prepared_import_records_delete AFTER DELETE ON import_records BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE recordKey=OLD.recordKey);
END;

CREATE TRIGGER prepared_import_sources_insert AFTER INSERT ON import_sources BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.sourceId=NEW.id);
END;

CREATE TRIGGER prepared_import_sources_update AFTER UPDATE ON import_sources BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.sourceId=OLD.id);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.sourceId=NEW.id);
END;

CREATE TRIGGER prepared_import_sources_delete AFTER DELETE ON import_sources BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.sourceId=OLD.id);
END;

CREATE TRIGGER prepared_import_change_templates_insert AFTER INSERT ON import_change_templates BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE changes=NEW.id);
END;

CREATE TRIGGER prepared_import_change_templates_update AFTER UPDATE ON import_change_templates BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE changes=OLD.id);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE changes=NEW.id);
END;

CREATE TRIGGER prepared_import_change_templates_delete AFTER DELETE ON import_change_templates BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT definitionId FROM definition_provenance WHERE changes=OLD.id);
END;

CREATE TRIGGER prepared_contribution_submissions_insert AFTER INSERT ON contribution_submissions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT id FROM definitions WHERE submissionId=NEW.id);
END;

CREATE TRIGGER prepared_contribution_submissions_update AFTER UPDATE ON contribution_submissions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT id FROM definitions WHERE submissionId=OLD.id);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT id FROM definitions WHERE submissionId=NEW.id);
END;

CREATE TRIGGER prepared_contribution_submissions_delete AFTER DELETE ON contribution_submissions BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT id FROM definitions WHERE submissionId=OLD.id);
END;

CREATE TRIGGER prepared_word_spellings_insert AFTER INSERT ON word_spellings BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=NEW.wordId));
END;

CREATE TRIGGER prepared_word_spellings_update AFTER UPDATE ON word_spellings BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=OLD.wordId));
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=NEW.wordId));
END;

CREATE TRIGGER prepared_word_spellings_delete AFTER DELETE ON word_spellings BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=OLD.wordId));
END;

CREATE TRIGGER prepared_users_insert AFTER INSERT ON users BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.importerUserId=NEW.id);
END;

CREATE TRIGGER prepared_users_update AFTER UPDATE OF username ON users WHEN OLD.username IS NOT NEW.username BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.importerUserId=OLD.id);
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.importerUserId=NEW.id);
END;

CREATE TRIGGER prepared_users_delete AFTER DELETE ON users BEGIN
 DELETE FROM public_card_payloads WHERE definitionId IN (SELECT p.definitionId FROM definition_provenance p JOIN import_records r ON r.recordKey=p.recordKey WHERE r.importerUserId=OLD.id);
END;
