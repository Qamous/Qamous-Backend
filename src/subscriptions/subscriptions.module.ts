import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Subscription } from "../typeorm/entities/subscription";
import { User } from "../typeorm/entities/user";
import { SubscriptionsController } from "./controllers/subscriptions/subscriptions.controller";
import { SubscriptionsService } from "./services/subscriptions/subscriptions.service";
import { StripeConfig } from "../utils/config/stripe.config";

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User]),
    StripeConfig
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService]
})
export class SubscriptionsModule {
}