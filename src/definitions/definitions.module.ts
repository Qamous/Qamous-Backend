import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Definition } from '../typeorm/entities/definition';
import { DefinitionsController } from './controllers/definitions/definitions.controller';
import { DefinitionsService } from './services/definitions/definitions.service';
import { Country } from '../typeorm/entities/country';

@Module({
  imports: [TypeOrmModule.forFeature([Definition, Country])], // DefinitionRepository is provided here
  controllers: [DefinitionsController],
  providers: [DefinitionsService],
  exports: [DefinitionsService],
})
export class DefinitionsModule {}
