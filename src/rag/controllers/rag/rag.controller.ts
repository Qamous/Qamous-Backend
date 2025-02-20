import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { RagRequest, RagResponse } from "../../dtos/rag.dto";
import { RagService } from "../../services/rag/rag.service";
import { AuthenticatedGuard } from "../../../utils/guards/local.guard";
import { SubscriptionGuard } from "../../../utils/guards/subscription.guard";

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  async handleQuery(@Body() request: RagRequest): Promise<RagResponse> {
    try {
      return await this.ragService.processQuery(request);
    } catch (error) {
      throw new HttpException(
        'Failed to process RAG query: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('premium')
  @UseGuards(AuthenticatedGuard, SubscriptionGuard)
  async handlePremiumQuery(@Body() request: RagRequest): Promise<RagResponse> {
    try {
      return await this.ragService.processQuery(request);
    } catch (error) {
      throw new HttpException(
        'Failed to process RAG query: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
