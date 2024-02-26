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

export type CreateWordParams = {
  arabicWord: string;
  FrancoArabicWord: string;
  CountriesOfUse: string[];
  createdAt: Date;
};

export type CreateDefinitionParams = {
  // TODO: Define the properties of the CreateDefinitionParams type
};
