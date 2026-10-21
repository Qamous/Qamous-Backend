-- Keep a tiny registry of occupied ID ranges. A range contains at most 1,000
-- word IDs, so even two language URLs per word stay well below sitemap limits.
-- The registry follows future imports and deletions without rewriting a build.
CREATE TABLE seo_sitemap_buckets (bucket INTEGER PRIMARY KEY) WITHOUT ROWID;
INSERT INTO seo_sitemap_buckets(bucket)
  SELECT DISTINCT CAST(id / 1000 AS INTEGER) FROM words;
CREATE TRIGGER seo_bucket_word_insert AFTER INSERT ON words BEGIN
  INSERT OR IGNORE INTO seo_sitemap_buckets(bucket) VALUES (CAST(NEW.id / 1000 AS INTEGER));
END;
CREATE TRIGGER seo_bucket_word_delete AFTER DELETE ON words BEGIN
  DELETE FROM seo_sitemap_buckets
  WHERE bucket = CAST(OLD.id / 1000 AS INTEGER)
    AND NOT EXISTS (SELECT 1 FROM words
      WHERE id >= CAST(OLD.id / 1000 AS INTEGER) * 1000
        AND id < (CAST(OLD.id / 1000 AS INTEGER) + 1) * 1000);
END;

-- Keyset alphabetical browsing avoids OFFSET scans at large page numbers.
CREATE INDEX dictionary_cards_seo_alphabetic
  ON dictionary_cards(isArabic, sortWord COLLATE NOCASE, canonicalArabic);
