SELECT 'duplicate_votes' AS check_name,COUNT(*) AS violations FROM
  (SELECT 1 FROM "definition-likes-dislikes" GROUP BY definitionId,userId HAVING COUNT(*)>1)
UNION ALL
SELECT 'self_votes',COUNT(*) FROM "definition-likes-dislikes" r JOIN definitions d ON d.id=r.definitionId WHERE r.userId=d.userId
UNION ALL
SELECT 'definition_counters',COUNT(*) FROM definitions d WHERE
  likeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=1) OR
  dislikeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=0)
UNION ALL
SELECT 'user_totals',COUNT(*) FROM users u WHERE
  likesReceived!=COALESCE((SELECT SUM(likeCount) FROM definitions WHERE userId=u.id),0) OR
  points!=COALESCE((SELECT SUM(contributionPoints+likeCount-dislikeCount) FROM definitions WHERE userId=u.id),0);
PRAGMA foreign_key_check;
