export class UpdateDefinitionDto {
  wordId: number;
  id: number;
  definition?: string;
  example?: string;
  isArabic?: boolean;
  likeCount?: number;
  dislikeCount?: number;
  AddedTimestamp: Date;
  countryCode?: string;
}
