import { ConfigService } from '@nestjs/config';
import { StripeModule } from '@golevelup/nestjs-stripe';

export const StripeConfig = StripeModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    apiKey: configService.get('STRIPE_SECRET_KEY'),
    webhookConfig: {
      stripeSecrets: {
        account: configService.get('STRIPE_WEBHOOK_SECRET'),
      },
      requestBodyProperty: 'rawBody',
    },
  }),
  inject: [ConfigService],
});