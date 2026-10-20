-- Maintain a small ranked feed instead of sorting every definition per request.
CREATE TABLE dictionary_cards (
 wordId INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 isArabic INTEGER NOT NULL, definitionId INTEGER NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
 score INTEGER NOT NULL, AddedTimestamp TEXT NOT NULL, sortWord TEXT NOT NULL,
 PRIMARY KEY(wordId,isArabic)
) WITHOUT ROWID;
CREATE INDEX dictionary_cards_popular ON dictionary_cards(score DESC,definitionId);
CREATE INDEX dictionary_cards_newest ON dictionary_cards(AddedTimestamp DESC,definitionId DESC);
CREATE INDEX dictionary_cards_alphabetic ON dictionary_cards(sortWord COLLATE NOCASE,definitionId);
CREATE INDEX dictionary_cards_definition ON dictionary_cards(definitionId);
CREATE TABLE dictionary_card_totals(isArabic INTEGER PRIMARY KEY,total INTEGER NOT NULL);
INSERT INTO dictionary_card_totals VALUES(0,0),(1,0);
CREATE TRIGGER card_total_insert AFTER INSERT ON dictionary_cards BEGIN
 UPDATE dictionary_card_totals SET total=total+1 WHERE isArabic=NEW.isArabic;
END;
CREATE TRIGGER card_total_delete AFTER DELETE ON dictionary_cards BEGIN
 UPDATE dictionary_card_totals SET total=total-1 WHERE isArabic=OLD.isArabic;
END;
INSERT INTO dictionary_cards
 SELECT wordId,isArabic,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN arabicWord ELSE COALESCE(francoArabicWord,arabicWord) END FROM (
  SELECT d.*,w.arabicWord,w.francoArabicWord,ROW_NUMBER() OVER(PARTITION BY d.wordId,d.isArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking
  FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.reportCount<=5 AND w.reportCount<=5
 ) WHERE ranking=1;
CREATE TRIGGER dictionary_definition_insert AFTER INSERT ON definitions WHEN NEW.displayLanguage!='hidden' BEGIN
 INSERT INTO dictionary_cards
 SELECT d.wordId,d.isArabic,d.id,d.likeCount-d.dislikeCount,d.AddedTimestamp,CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END
 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.wordId=NEW.wordId AND d.isArabic=NEW.isArabic AND d.reportCount<=5 AND w.reportCount<=5
 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1
 ON CONFLICT(wordId,isArabic) DO UPDATE SET definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord
 WHERE dictionary_cards.definitionId!=excluded.definitionId OR dictionary_cards.score!=excluded.score OR dictionary_cards.sortWord!=excluded.sortWord;
END;
CREATE TRIGGER dictionary_definition_update AFTER UPDATE OF likeCount,dislikeCount,reportCount,displayLanguage,isArabic,wordId,AddedTimestamp ON definitions BEGIN
 DELETE FROM dictionary_cards WHERE wordId=OLD.wordId AND isArabic=OLD.isArabic;
 INSERT INTO dictionary_cards
 SELECT d.wordId,d.isArabic,d.id,d.likeCount-d.dislikeCount,d.AddedTimestamp,CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END
 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.wordId=OLD.wordId AND d.isArabic=OLD.isArabic AND d.reportCount<=5 AND w.reportCount<=5
 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1;
 INSERT INTO dictionary_cards
 SELECT d.wordId,d.isArabic,d.id,d.likeCount-d.dislikeCount,d.AddedTimestamp,CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END
 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.wordId=NEW.wordId AND d.isArabic=NEW.isArabic AND d.reportCount<=5 AND w.reportCount<=5
 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1 ON CONFLICT(wordId,isArabic) DO NOTHING;
END;
CREATE TRIGGER dictionary_definition_delete AFTER DELETE ON definitions BEGIN
 INSERT INTO dictionary_cards
 SELECT d.wordId,d.isArabic,d.id,d.likeCount-d.dislikeCount,d.AddedTimestamp,CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END
 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.wordId=OLD.wordId AND d.isArabic=OLD.isArabic AND d.reportCount<=5 AND w.reportCount<=5
 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1
 ON CONFLICT(wordId,isArabic) DO UPDATE SET definitionId=excluded.definitionId,score=excluded.score,AddedTimestamp=excluded.AddedTimestamp,sortWord=excluded.sortWord;
END;
CREATE TRIGGER dictionary_word_update AFTER UPDATE OF arabicWord,francoArabicWord,reportCount ON words BEGIN
 DELETE FROM dictionary_cards WHERE wordId=NEW.id;
 INSERT INTO dictionary_cards
 SELECT wordId,isArabic,id,likeCount-dislikeCount,AddedTimestamp,CASE WHEN isArabic=1 THEN NEW.arabicWord ELSE COALESCE(NEW.francoArabicWord,NEW.arabicWord) END FROM (
 SELECT d.*,ROW_NUMBER() OVER(PARTITION BY isArabic ORDER BY likeCount-dislikeCount DESC,id) AS ranking
 FROM public_definitions d WHERE d.wordId=NEW.id AND d.reportCount<=5 AND NEW.reportCount<=5
 ) WHERE ranking=1;
END;
-- Normalized trigram indexes preserve contains-search for three or more
-- characters, without copying pronunciation into Franco or indexing hidden glosses.
CREATE VIRTUAL TABLE word_search USING fts5(searchText,content='words',content_rowid='id',tokenize='trigram');
CREATE VIRTUAL TABLE definition_search USING fts5(searchText,content='definitions',content_rowid='id',tokenize='trigram');
INSERT INTO word_search(rowid,searchText) SELECT id,searchText FROM words;
INSERT INTO definition_search(rowid,searchText) SELECT id,searchText FROM public_definitions;
CREATE TRIGGER word_search_insert AFTER INSERT ON words BEGIN INSERT INTO word_search(rowid,searchText) VALUES(NEW.id,NEW.searchText); END;
CREATE TRIGGER word_search_delete AFTER DELETE ON words BEGIN INSERT INTO word_search(word_search,rowid,searchText) VALUES('delete',OLD.id,OLD.searchText); END;
CREATE TRIGGER word_search_update AFTER UPDATE OF searchText ON words BEGIN
 INSERT INTO word_search(word_search,rowid,searchText) VALUES('delete',OLD.id,OLD.searchText);
 INSERT INTO word_search(rowid,searchText) VALUES(NEW.id,NEW.searchText);
END;
CREATE TRIGGER definition_search_insert AFTER INSERT ON definitions WHEN NEW.displayLanguage!='hidden' BEGIN INSERT INTO definition_search(rowid,searchText) VALUES(NEW.id,NEW.searchText); END;
CREATE TRIGGER definition_search_delete AFTER DELETE ON definitions WHEN OLD.displayLanguage!='hidden' BEGIN INSERT INTO definition_search(definition_search,rowid,searchText) VALUES('delete',OLD.id,OLD.searchText); END;
CREATE TRIGGER definition_search_update AFTER UPDATE OF searchText,displayLanguage ON definitions BEGIN
 INSERT INTO definition_search(definition_search,rowid,searchText) SELECT 'delete',OLD.id,OLD.searchText WHERE OLD.displayLanguage!='hidden';
 INSERT INTO definition_search(rowid,searchText) SELECT NEW.id,NEW.searchText WHERE NEW.displayLanguage!='hidden';
END;
