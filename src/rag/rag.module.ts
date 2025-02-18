import { Module } from '@nestjs/common';
import { RagController } from './controllers/rag/rag.controller';
import { RagService } from './services/rag/rag.service';
import { TypeOrmModule } from "@nestjs/typeorm";
import { Word } from "../typeorm/entities/word";
import { Definition } from "../typeorm/entities/definition";
import { ModelService } from "./services/model/model.service";
import { VectorStoreService } from "./services/vector-store/vector-store.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Word, Definition]),
  ],
  controllers: [RagController],
  providers: [RagService, ModelService, VectorStoreService]
})
export class RagModule {}
