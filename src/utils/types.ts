export type CreateUserParams = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  dateOfBirth: Date;
  createdAt: Date;
};

export type UpdateUserParams = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  dateOfBirth: Date;
  createdAt: Date;
};
