import { Controller, Post, Get, UseGuards, Req, Res, RawBodyRequest } from "@nestjs/common";
import { Response, Request } from "express";
import { ConfigService } from "@nestjs/config";
import { SubscriptionsService } from "../../services/subscriptions/subscriptions.service";
import { AuthenticatedGuard } from "../../../utils/guards/local.guard";
import { RequestType } from "express-serve-static-core";
import { Stripe } from "stripe";

@Controller("subscriptions")
export class SubscriptionsController {
  constructor(
    private subscriptionService: SubscriptionsService,
    private configService: ConfigService
  ) {
  }

  @UseGuards(AuthenticatedGuard)
  @Post("subscribe")
  async subscribe(@Req() req: RequestType) {
    return this.subscriptionService.createSubscription(req.user.id);
  }

  @Post("webhook")
  async handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response
  ) {
    const signature = request.headers["stripe-signature"];
    const webhookSecret = this.configService.get("STRIPE_WEBHOOK_SECRET");

    try {
      const stripe = new Stripe(this.configService.get("STRIPE_SECRET_KEY"), {
        apiVersion: "2025-01-27.acacia"
      });

      const event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        webhookSecret
      );

      await this.subscriptionService.handleWebhookEvent(event);
      response.send({ received: true });
    } catch (err) {
      response.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  @UseGuards(AuthenticatedGuard)
  @Post("cancel")
  async cancel(@Req() req: RequestType): Promise<void> {
    return this.subscriptionService.cancelSubscription(req.user.id);
  }

  @UseGuards(AuthenticatedGuard)
  @Get("status")
  async getStatus(@Req() req: RequestType): Promise<{ isSubscribed: boolean }> {
    const isSubscribed = await this.subscriptionService.isUserSubscribed(req.user.id);
    return { isSubscribed };
  }
}