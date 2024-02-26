import { Module } from '@nestjs/common';
import { DefinitionsController } from './controllers/definitions/definitions.controller';
import { DefinitionsService } from './services/definitions/definitions.service';

@Module({
  controllers: [DefinitionsController],
  providers: [DefinitionsService]
})
export class DefinitionsModule {}
