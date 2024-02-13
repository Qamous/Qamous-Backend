import { Body, Injectable, Param } from '@nestjs/common';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';

@Injectable()
export class UserService {
  private _createUserDto: CreateUserDto;
  private _loginUserDto: any;
  private _userId: string;
  private _updateUserDto: UpdateUserDto;
  async registerUser(@Body() createUserDto: CreateUserDto) {
    this._createUserDto = createUserDto;
    // Implement registration logic
  }

  async loginUser(@Body() loginUserDto: any) {
    this._loginUserDto = loginUserDto;
    // Implement login logic
  }

  async getUserProfile(@Param('id') userId: string) {
    this._userId = userId;
    // Implement logic to fetch user profile
  }

  async updateUserProfile(@Param('id') userId: string, @Body() updateUserDto: UpdateUserDto) {
    this._userId = userId;
    this._updateUserDto = updateUserDto;
    // Implement logic to update user profile
  }
}
