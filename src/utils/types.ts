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
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  dateOfBirth: Date;
  createdAt: Date;
};

export type CreateCountryParams = {
  countryCode: string;
  countryName: string;
};

export type UpdateCountryParams = {
  countryCode: string;
  countryName: string;
};
