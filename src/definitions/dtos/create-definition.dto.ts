export class CreateDefinitionDto {
  wordID: number;
  userID: number;
  definition: string;
  example: string;
  isArabic: boolean;
  createdAt: Date;
}
