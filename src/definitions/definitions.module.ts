import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from '@nestjs/typeorm';
import { Definition } from '../typeorm/entities/definition';
import { DefinitionsController } from './controllers/definitions/definitions.controller';
import { DefinitionsService } from './services/definitions/definitions.service';
import { Country } from '../typeorm/entities/country';
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Definition, Country]), // DefinitionRepository is provided here
    forwardRef(() => UsersModule),
  ],
  controllers: [DefinitionsController],
  providers: [DefinitionsService],
  exports: [DefinitionsService],
})
export class DefinitionsModule {}
