export class UpdateUserDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  oldPassword: string;
  password?: string;
  passwordConfirmation?: string;
  dateOfBirth?: Date;
  createdAt?: Date;

  constructor(
    firstName: string,
    lastName: string,
    email: string,
    username: string,
    oldPassword: string,
    password: string,
    passwordConfirmation: string,
    dateOfBirth: Date,
    createdAt: Date,
  ) {
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.username = username;
    this.oldPassword = oldPassword;
    this.password = password;
    this.passwordConfirmation = passwordConfirmation;
    this.dateOfBirth = dateOfBirth;
    this.createdAt = createdAt;
  }
}
