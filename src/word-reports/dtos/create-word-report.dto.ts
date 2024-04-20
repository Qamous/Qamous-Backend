export class CreateWordReportDto {
  wordID: number;
  // The user ID of the person whose word was reported
  userReportedID: number;
  reportText: string;
  createdAt: Date;
}
