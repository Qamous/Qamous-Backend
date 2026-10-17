-- Rebuild reputation from surviving contributions and valid, latest votes.
-- The earliest surviving definition gets the historical first-definition bonus.
ALTER TABLE definitions ADD COLUMN contributionPoints INTEGER NOT NULL DEFAULT 1 CHECK(contributionPoints IN (1,2));
UPDATE definitions SET contributionPoints=2 WHERE id IN (SELECT MIN(id) FROM definitions GROUP BY wordId);
DELETE FROM "definition-likes-dislikes" WHERE id NOT IN (
  SELECT MAX(id) FROM "definition-likes-dislikes" GROUP BY definitionId,userId
);
DELETE FROM "definition-likes-dislikes" WHERE userId=(SELECT userId FROM definitions WHERE id=definitionId);
CREATE UNIQUE INDEX reactions_one_per_user ON "definition-likes-dislikes"(definitionId,userId);
UPDATE definitions SET
  likeCount=(SELECT COUNT(*) FROM "definition-likes-dislikes" r WHERE r.definitionId=definitions.id AND liked=1),
  dislikeCount=(SELECT COUNT(*) FROM "definition-likes-dislikes" r WHERE r.definitionId=definitions.id AND liked=0);
UPDATE users SET
  likesReceived=COALESCE((SELECT SUM(likeCount) FROM definitions WHERE userId=users.id),0),
  points=COALESCE((SELECT SUM(contributionPoints+likeCount-dislikeCount) FROM definitions WHERE userId=users.id),0);

-- Keep accounting inside the same SQLite transaction as every write, including
-- FK cascades and ownership transfers. Application code never adjusts totals.
CREATE TRIGGER reaction_no_self_insert BEFORE INSERT ON "definition-likes-dislikes"
WHEN NEW.userId=(SELECT userId FROM definitions WHERE id=NEW.definitionId)
BEGIN SELECT RAISE(ABORT,'Self reactions are not allowed'); END;
CREATE TRIGGER reaction_no_self_update BEFORE UPDATE ON "definition-likes-dislikes"
WHEN NEW.userId=(SELECT userId FROM definitions WHERE id=NEW.definitionId)
BEGIN SELECT RAISE(ABORT,'Self reactions are not allowed'); END;
CREATE TRIGGER reaction_identity_immutable BEFORE UPDATE OF definitionId,userId ON "definition-likes-dislikes"
WHEN OLD.definitionId!=NEW.definitionId OR OLD.userId!=NEW.userId
BEGIN SELECT RAISE(ABORT,'Reaction identity cannot change'); END;
CREATE TRIGGER reaction_insert AFTER INSERT ON "definition-likes-dislikes"
BEGIN
  UPDATE definitions SET likeCount=likeCount+NEW.liked,dislikeCount=dislikeCount+1-NEW.liked WHERE id=NEW.definitionId;
  UPDATE users SET likesReceived=likesReceived+NEW.liked,points=points+2*NEW.liked-1 WHERE id=(SELECT userId FROM definitions WHERE id=NEW.definitionId);
END;
CREATE TRIGGER reaction_delete AFTER DELETE ON "definition-likes-dislikes"
BEGIN
  UPDATE definitions SET likeCount=likeCount-OLD.liked,dislikeCount=dislikeCount-(1-OLD.liked) WHERE id=OLD.definitionId;
  UPDATE users SET likesReceived=likesReceived-OLD.liked,points=points-(2*OLD.liked-1) WHERE id=(SELECT userId FROM definitions WHERE id=OLD.definitionId);
END;
CREATE TRIGGER reaction_update AFTER UPDATE OF liked ON "definition-likes-dislikes"
BEGIN
  UPDATE definitions SET likeCount=likeCount+NEW.liked-OLD.liked,dislikeCount=dislikeCount+OLD.liked-NEW.liked WHERE id=NEW.definitionId;
  UPDATE users SET likesReceived=likesReceived+NEW.liked-OLD.liked,points=points+2*(NEW.liked-OLD.liked) WHERE id=(SELECT userId FROM definitions WHERE id=NEW.definitionId);
END;
CREATE TRIGGER definition_points_insert AFTER INSERT ON definitions
BEGIN
  UPDATE users SET points=points+NEW.contributionPoints WHERE id=NEW.userId;
END;
-- Cascading reactions cannot find their deleted definition, so remove their
-- complete effect here using OLD, exactly once.
CREATE TRIGGER definition_points_delete AFTER DELETE ON definitions
BEGIN
  UPDATE users SET points=points-OLD.contributionPoints-OLD.likeCount+OLD.dislikeCount,likesReceived=likesReceived-OLD.likeCount WHERE id=OLD.userId;
END;
CREATE TRIGGER definition_points_transfer AFTER UPDATE OF userId ON definitions
WHEN NEW.userId!=OLD.userId
BEGIN
  UPDATE users SET points=points-OLD.contributionPoints-OLD.likeCount+OLD.dislikeCount,likesReceived=likesReceived-OLD.likeCount WHERE id=OLD.userId;
  UPDATE users SET points=points+NEW.contributionPoints+NEW.likeCount-NEW.dislikeCount,likesReceived=likesReceived+NEW.likeCount WHERE id=NEW.userId;
  DELETE FROM "definition-likes-dislikes" WHERE definitionId=NEW.id AND userId=NEW.userId;
END;
