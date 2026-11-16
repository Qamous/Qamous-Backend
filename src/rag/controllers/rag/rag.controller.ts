import { Body, Controller, HttpException, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { RagRequest, RagResponse } from "../../dtos/rag.dto";
import { RagService } from "../../services/rag/rag.service";
import { AuthenticatedGuard } from "../../../utils/guards/local.guard";
import { SubscriptionGuard } from "../../../utils/guards/subscription.guard";
import { RequestType } from "express-serve-static-core";

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  async handleQuery(@Body() request: RagRequest, @Req() req: RequestType): Promise<RagResponse> {
    try {
      return await this.ragService.processQuery(request, req.user.id);
    } catch (error) {
      throw new HttpException(
        'Failed to process RAG query: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('premium')
  @UseGuards(AuthenticatedGuard, SubscriptionGuard)
  async handlePremiumQuery(@Body() request: RagRequest, @Req() req: RequestType): Promise<RagResponse> {
    try {
      return await this.ragService.processQuery(request, req.user.id);
    } catch (error) {
      throw new HttpException(
        'Failed to process RAG query: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
