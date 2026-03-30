// convex/payments.ts
import { v } from 'convex/values';
import { action } from './_generated/server';
import { checkout, customerPortal } from './dodo';

/**
 * Creates a Dodo Payments checkout session and returns the checkout_url.
 * Pre-fills the customer email from the authenticated user and passes
 * the Convex userId as metadata for reliable credit attribution in the webhook.
 */
export const createCheckout = action({
  args: {
    product_cart: v.array(
      v.object({
        product_id: v.string(),
        quantity: v.number(),
      }),
    ),
    returnUrl: v.optional(v.string()),
    user: v.object({
      userId: v.id('users'),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      dodoCustomerId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const session = await checkout(ctx, {
        payload: {
          product_cart: args.product_cart,
          return_url: args.returnUrl,
          billing_currency: 'USD',
          // billing_address: {
          //   country: 'US',
          //   city: 'San Francisco',
          //   state: 'CA',
          //   street: '123 Main St',
          //   postal_code: '94105',
          // },

          // custom_fields: [
          //   {
          //     field_type: 'text',
          //     key: 'gender',
          //     label: 'Gender',
          //   },
          // ],

          // Pre-fill the checkout form with the user's email
          ...(args.user.dodoCustomerId
            ? { customer: { customer_id: args.user.dodoCustomerId } }
            : {
                customer: {
                  email: args.user.email,
                  name: args.user.name || args.user.email?.split('@')[0], // Dodo requires a name, so we use the part of the email before the @
                },
              }),

          // customization: {
          //   theme_config: {
          //     radius: '999px',
          //   },
          // },

          metadata: {
            convex_user_id: args.user.userId,
          },
          feature_flags: {
            allow_discount_code: true,
          },
        },
      });

      if (!session?.checkout_url) {
        throw new Error('Checkout session did not return a checkout_url');
      }

      return session;
    } catch (error) {
      console.error('Failed to create checkout session', error);
      throw new Error('Unable to create checkout session. Please try again.');
    }
  },
});

/**
 * Generates a Dodo Payments customer portal link so users can manage
 * their billing details and view past transactions.
 */
export const getCustomerPortal = action({
  args: {
    send_email: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const portal = await customerPortal(ctx, args);
      if (!portal?.portal_url) {
        throw new Error('Customer portal did not return a portal_url');
      }
      return portal;
    } catch (error) {
      console.error('Failed to generate customer portal link', error);
      throw new Error('Unable to generate customer portal link. Please try again.');
    }
  },
});
