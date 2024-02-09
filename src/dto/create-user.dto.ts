export class CreateUserDto {
  readonly username: string;
  readonly emailAddress: string;
  readonly password: string;
  readonly fullName: string;
  readonly profilePicture?: string;
  readonly dateOfBirth?: Date;
}
