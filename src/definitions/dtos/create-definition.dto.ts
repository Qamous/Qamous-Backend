export class CreateDefinitionDto {
  wordId: number;
  definition: string;
  example: string;
  isArabic: boolean;
  createdAt: Date;
  countryCode: string;
}
