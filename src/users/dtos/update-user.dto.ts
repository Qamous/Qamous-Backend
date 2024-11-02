export class UpdateUserDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  oldPassword?: string;
  password?: string;
  passwordConfirmation?: string;
  dateOfBirth?: Date;
  createdAt?: Date;
  likesReceived?: number;
}
