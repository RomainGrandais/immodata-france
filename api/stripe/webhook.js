'use strict';

const Stripe = require('stripe');
const { getClient } = require('../../lib/supabase');

// Map des plans Stripe → plans internes
// Les price IDs sont configurés en env vars
function getPlanFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  return 'free';
}

/**
 * POST /api/stripe/webhook
 * Header : stripe-signature (validé par Stripe)
 *
 * Reçoit les événements Stripe et met à jour la DB.
 * Événements gérés :
 *   - checkout.session.completed → activation abonnement après paiement
 *   - customer.subscription.updated → changement de plan / statut
 *   - customer.subscription.deleted → annulation → retour au plan free
 *
 * Variables d'environnement requises :
 *   STRIPE_SECRET_KEY       sk_live_...
 *   STRIPE_WEBHOOK_SECRET   whsec_... (depuis Stripe dashboard → Webhooks)
 *
 * Pour créer le webhook dans Stripe :
 *   URL : https://immodata-france.vercel.app/api/stripe/webhook
 *   Événements : checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
 */
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook non configuré.' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // Le body doit être brut (raw buffer) pour la validation de signature
    const rawBody = req.body;
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature invalide :', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supabase = getClient();

  try {
    switch (event.type) {
      // ── Paiement initial réussi ─────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const userId = session.metadata?.user_id;
        const plan   = session.metadata?.plan ?? 'starter';
        if (!userId) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        await supabase.from('subscriptions').upsert({
          user_id:                userId,
          stripe_customer_id:     session.customer,
          stripe_subscription_id: session.subscription,
          plan,
          status: 'active',
          current_period_end: periodEnd,
        }, { onConflict: 'user_id' });

        // Mettre à jour le plan de toutes les clés actives de l'utilisateur
        await supabase
          .from('api_keys')
          .update({ plan })
          .eq('user_id', userId)
          .eq('is_active', true);

        console.log(`✅ Subscription activée : user=${userId} plan=${plan}`);
        break;
      }

      // ── Mise à jour d'abonnement (renouvellement, changement de plan) ───
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = getPlanFromPriceId(priceId);
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

        // Trouver l'utilisateur via stripe_customer_id
        const { data: existing } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (existing?.user_id) {
          await supabase.from('subscriptions').update({
            plan,
            status: sub.status,
            stripe_subscription_id: sub.id,
            current_period_end: periodEnd,
          }).eq('user_id', existing.user_id);

          await supabase
            .from('api_keys')
            .update({ plan })
            .eq('user_id', existing.user_id)
            .eq('is_active', true);

          console.log(`🔄 Subscription mise à jour : user=${existing.user_id} plan=${plan} status=${sub.status}`);
        }
        break;
      }

      // ── Annulation / expiration ──────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;

        const { data: existing } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (existing?.user_id) {
          await supabase.from('subscriptions').update({
            plan: 'free',
            status: 'cancelled',
            stripe_subscription_id: null,
            current_period_end: null,
          }).eq('user_id', existing.user_id);

          await supabase
            .from('api_keys')
            .update({ plan: 'free' })
            .eq('user_id', existing.user_id)
            .eq('is_active', true);

          console.log(`❌ Subscription annulée : user=${existing.user_id} → retour free`);
        }
        break;
      }

      default:
        // Événement non géré — on répond 200 quand même pour que Stripe ne ré-essaie pas
        break;
    }
  } catch (err) {
    console.error('Erreur traitement webhook :', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }

  return res.status(200).json({ received: true });
};
