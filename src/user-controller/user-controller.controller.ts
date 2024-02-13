import { Controller, Post, Body, Get, Param, Patch } from '@nestjs/common';
import { UserService } from '../user-service/user-service.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  async registerUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.registerUser(createUserDto);
  }

  @Post('login')
  async loginUser(@Body() loginUserDto: any) {
    // Implement login logic in the UserService
    return this.userService.loginUser(loginUserDto);
  }

  @Get(':id')
  async getUserProfile(@Param('id') userId: string) {
    return this.userService.getUserProfile(userId);
  }

  @Patch(':id')
  async updateUserProfile(
    @Param('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateUserProfile(userId, updateUserDto);
  }
}
