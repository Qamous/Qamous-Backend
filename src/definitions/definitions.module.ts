import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Definition } from '../typeorm/entities/definition';
import { DefinitionsController } from './controllers/definitions/definitions.controller';
import { DefinitionsService } from './services/definitions/definitions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Definition])], // DefinitionRepository is provided here
  controllers: [DefinitionsController],
  providers: [DefinitionsService],
})
export class DefinitionsModule {}
