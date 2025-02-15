import { User } from '../typeorm/entities/user';
import { Request } from "@nestjs/common";

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
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  password?: string;
  dateOfBirth?: Date;
  createdAt?: Date;
  likesReceived?: number;
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
  francoArabicWord: string;
  CountriesOfUse: string[];
  createdAt: Date;
};

export type CreateDefinitionParams = {
  // TODO: Define the properties of the CreateDefinitionParams type
};

// This is so that TypeScript knows that the Request object can have a user property of type User
declare module 'express-serve-static-core' {
  interface RequestType extends Request {
    user?: User;
  }
}

export interface UserRequest extends Request {
  user?: User;
}