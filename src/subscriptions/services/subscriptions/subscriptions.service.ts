import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from "../../../typeorm/entities/user";
import { Subscription } from "../../../typeorm/entities/subscription";
import { Stripe } from "stripe";
import { InjectStripeClient } from "@golevelup/nestjs-stripe";

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectStripeClient()
    private stripe: Stripe,
  ) {}

  private async handleSuccessfulPayment(invoice: Stripe.Invoice) {
    if (typeof invoice.customer === 'string') {
      const customer = await this.stripe.customers.retrieve(invoice.customer);

      // Check if customer is not deleted
      if (!customer.deleted && 'metadata' in customer) {
        const userId = parseInt(customer.metadata.userId);

        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);

        await this.subscriptionRepository.save({
          userId,
          status: 'active',
          endDate,
          autoRenew: true,
          amount: 20.00
        });
      }
    }
  }

  private async handleSubscriptionCancelled(subscription: Stripe.Subscription) {
    if (typeof subscription.customer === 'string') {
      const customer = await this.stripe.customers.retrieve(subscription.customer);

      // Check if customer is not deleted and has metadata
      if (!customer.deleted && 'metadata' in customer) {
        const userId = parseInt(customer.metadata.userId);
        await this.cancelSubscription(userId);
      }
    }
  }

  async createSubscription(userId: number): Promise<{ clientSecret: string, subscriptionId: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create or get Stripe customer
    if (!user.stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id.toString() }
      });

      user.stripeCustomerId = customer.id;
      await this.userRepository.save(user);
    }

    // Create the subscription in Stripe
    const subscription = await this.stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{
        price_data: {
          currency: 'usd',
          product: 'Monthly_Subscription',
          unit_amount: 2000, // $20.00 in cents
          recurring: {
            interval: 'month',
          },
        },
      }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    // Type assertion to handle the expanded invoice and payment intent
    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

    return {
      subscriptionId: subscription.id,
      clientSecret: paymentIntent.client_secret,
    };
  }

  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'customer.subscription.created':
        const createdSubscription = event.data.object as Stripe.Subscription;
        // Only handle if subscription is active
        if (createdSubscription.status === 'active') {
          await this.handleNewSubscription(createdSubscription);
        }
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdate(updatedSubscription);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionCancelled(deletedSubscription);
        break;

      case 'invoice.paid':
        const paidInvoice = event.data.object as Stripe.Invoice;
        await this.handleSuccessfulPayment(paidInvoice);
        break;

      case 'invoice.payment_failed':
        const failedInvoice = event.data.object as Stripe.Invoice;
        await this.handleFailedPayment(failedInvoice);
        break;
    }
  }

  private async handleNewSubscription(subscription: Stripe.Subscription) {
    if (typeof subscription.customer === 'string') {
      const customer = await this.stripe.customers.retrieve(subscription.customer);

      if (!customer.deleted && 'metadata' in customer) {
        const userId = parseInt(customer.metadata.userId);
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);

        await this.subscriptionRepository.save({
          userId,
          status: 'active',
          endDate,
          autoRenew: true,
          amount: subscription.items.data[0].price.unit_amount / 100 // Convert from cents
        });
      }
    }
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    if (typeof subscription.customer === 'string') {
      const customer = await this.stripe.customers.retrieve(subscription.customer);

      if (!customer.deleted && 'metadata' in customer) {
        const userId = parseInt(customer.metadata.userId);

        // Find existing subscription
        const existingSub = await this.subscriptionRepository.findOne({
          where: { userId }
        });

        if (existingSub) {
          // Update status based on Stripe subscription status
          existingSub.status = subscription.status === 'active' ? 'active' : 'cancelled';
          existingSub.autoRenew = subscription.cancel_at_period_end === false;

          if (subscription.current_period_end) {
            existingSub.endDate = new Date(subscription.current_period_end * 1000);
          }

          await this.subscriptionRepository.save(existingSub);
        }
      }
    }
  }

  private async handleFailedPayment(invoice: Stripe.Invoice) {
    if (typeof invoice.customer === 'string') {
      const customer = await this.stripe.customers.retrieve(invoice.customer);

      if (!customer.deleted && 'metadata' in customer) {
        const userId = parseInt(customer.metadata.userId);
        const subscription = await this.subscriptionRepository.findOne({
          where: { userId }
        });

        if (subscription) {
          // Mark subscription as expired if payment failed
          subscription.status = 'expired';
          subscription.autoRenew = false;
          await this.subscriptionRepository.save(subscription);

          // TODO: Implement notification system to alert user of payment failure
          // await this.notificationService.sendPaymentFailedNotification(userId);
        }
      }
    }
  }

  async getActiveSubscription(userId: number): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: {
        userId,
        status: 'active',
      },
    });
  }

  async cancelSubscription(userId: number): Promise<void> {
    const subscription = await this.getActiveSubscription(userId);
    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    subscription.status = 'cancelled';
    subscription.autoRenew = false;
    await this.subscriptionRepository.save(subscription);
  }

  async isUserSubscribed(userId: number): Promise<boolean> {
    const subscription = await this.getActiveSubscription(userId);
    return !!subscription && subscription.endDate > new Date();
  }
}