import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Subscription } from "../typeorm/entities/subscription";
import { User } from "../typeorm/entities/user";
import { SubscriptionController } from "./controllers/subscriptions/subscriptions.controller";
import { SubscriptionService } from "./services/subscriptions/subscriptions.service";
import { StripeConfig } from "../utils/config/stripe.config";

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User]),
    StripeConfig
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService]
})
export class SubscriptionsModule {
}