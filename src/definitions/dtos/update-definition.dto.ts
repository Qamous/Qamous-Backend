export class UpdateDefinitionDto {
  id: number;
  definition?: string;
  example?: string;
  isArabic?: boolean;
  likeCount?: number;
  dislikeCount?: number;
  AddedTimestamp: Date;
  countryCode?: string;
}
