export type Row = Record<string, unknown>;
export interface UserRow extends Row {
  id: number; firstName: string; lastName: string; username: string; email: string;
  password: string; passwordVersion: string; createdAt: string; dateOfBirth: string | null;
  likesReceived: number; points: number; countryCountryCode: string | null;
}
export interface DictionaryRow extends Row {
  id: number; wordId: number; userId: number; arabicWord: string; francoArabicWord: string | null;
  definition: string; example: string | null; isArabic: number; countryCode: string | null;
}
export const nowSql = () => new Date().toISOString().replace('T',' ').replace('Z','');
export const normalize = (s:string) => s.normalize('NFKD').replace(/\p{M}/gu,'').replace(/ـ/g,'').toLocaleLowerCase('en');
export const escapeLike = (s:string) => s.replace(/[\\%_]/g,'\\$&');
export const sqlName = (s:string) => '"'+s.replaceAll('"','""')+'"';
export const positiveId = (value:string) => {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1) throw new ApiError(400,'Invalid ID');
  return n;
};
export class ApiError extends Error {
  readonly status:400|401|403|404|409|413|415|429|503;
  constructor(status:ApiError['status'], message:string) {super(message);this.status=status;}
}
export function text(value:unknown, field:string, max=255, required=true):string {
  if(typeof value!=='string'||(required&&!value.trim())||value.length>max) throw new ApiError(400,`Invalid ${field}`);
  return value.trim();
}
export function publicUser(user:UserRow, owner=false) {
  const visible:Row={id:Number(user.id),firstName:user.firstName,username:user.username,likesReceived:user.likesReceived,points:user.points,createdAt:user.createdAt};
  if(owner) Object.assign(visible,{lastName:user.lastName,email:user.email,dateOfBirth:user.dateOfBirth,countryCountryCode:user.countryCountryCode});
  return visible;
}
export const requireUser = (user:UserRow|null) => {if(!user) throw new ApiError(401,'User not authenticated properly'); return user;};

export const rankedSql = (filter:string, pagination=false) => `
WITH RankedDefinitions AS (
 SELECT d.*,w.id AS wordId,w.arabicWord,w.francoArabicWord,w.reportCount AS wordReportCount,
 d.id AS definitionId,d.reportCount AS definitionReportCount,
 (d.likeCount-d.dislikeCount) AS likeDislikeDifference,
 CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE w.francoArabicWord END AS word,
 EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=1) AS isLiked,
 EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=0) AS isDisliked,
 EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=d.id AND r.userId=?) AS isReported,
 ROW_NUMBER() OVER(PARTITION BY w.id,d.isArabic ORDER BY (d.likeCount-d.dislikeCount) DESC,d.id) AS ranking
 FROM definitions d JOIN words w ON w.id=d.wordId
 WHERE w.reportCount<=5 AND d.reportCount<=5 ${filter}
)
SELECT wordId,definitionId,definition,likeCount,dislikeCount,likeDislikeDifference,isArabic,countryCode,word,
 wordReportCount,definitionReportCount,isLiked,isDisliked,isReported,example,arabicWord,francoArabicWord
FROM RankedDefinitions WHERE ranking=1 ORDER BY likeDislikeDifference DESC,definitionId ${pagination?'LIMIT ? OFFSET ?':''}`;

export function withWord(row:Row) {
  const {arabicWord,francoArabicWord,wordCreatedAt,wordUserId,wordReportCount,...definition}=row;
  delete definition.searchText;
  return {...definition,isArabic:!!definition.isArabic,isLiked:!!row.isLiked,isDisliked:!!row.isDisliked,isReported:!!row.isReported,word:{id:row.wordId,userId:wordUserId,arabicWord,francoArabicWord,createdAt:wordCreatedAt,reportCount:wordReportCount}};
}
export const joinWord = 'SELECT d.*,w.arabicWord,w.francoArabicWord,w.createdAt AS wordCreatedAt,w.userId AS wordUserId,w.reportCount AS wordReportCount FROM definitions d JOIN words w ON w.id=d.wordId';
export const personalJoinWord=joinWord.replace(' FROM definitions d',`,
 EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=1) AS isLiked,
 EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=0) AS isDisliked,
 EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=d.id AND r.userId=?) AS isReported
 FROM definitions d`);
