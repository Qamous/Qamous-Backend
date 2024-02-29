export class UpdateUserDto {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  oldPassword: string;
  newPassword: string;
  passwordConfirmation: string;
  dateOfBirth: Date;
  createdAt: Date;
}
