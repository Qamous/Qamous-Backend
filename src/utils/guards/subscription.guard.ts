import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { SubscriptionsService } from "../../subscriptions/services/subscriptions/subscriptions.service";

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private subscriptionService: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    return this.subscriptionService.isUserSubscribed(user.id);
  }
}