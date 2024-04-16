export class CreateDefinitionDto {
  wordId: number;
  userId: number;
  definition: string;
  example: string;
  isArabic: boolean;
  createdAt: Date;
}
