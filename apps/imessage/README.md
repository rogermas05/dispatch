# Dispatch over iMessage

Text the bot "call my pharmacy and ask if my refill is ready"; it quotes the
call, takes the price from your prepaid balance, hires the Dispatch agent
through Masumi escrow, and texts back what happened.

If you have no balance (or not enough), it texts you a Stripe payment link
instead. Pay it — Apple Pay works there — and you get "You're funded", then ask
again.

## Run it on a Mac

Everything runs in test mode: a Stripe sandbox and Masumi Preprod.

1. Install the two tools the launcher uses:

   ```sh
   brew install stripe/stripe-cli/stripe cloudflared
   ```

   Nobody has to `stripe login`; the launcher uses the key below.

2. In `.env.local` at the repo root, alongside the Masumi and Anthropic settings
   the rest of the repo already needs (`AGENT_API_PUBLIC_URL`,
   `PAYMENT_SERVICE_URL`, `MPS_BUY_KEY`, `ANTHROPIC_API_KEY`,
   `DISPATCH_ALLOWED_NUMBERS`), add a Stripe sandbox secret key:

   ```sh
   STRIPE_SECRET_KEY=sk_test_...
   ```

   Leave `STRIPE_WEBHOOK_SECRET` and `PAYMENTS_PUBLIC_URL` unset; the launcher
   provides fresh ones each run. It refuses live keys.

3. Start it:

   ```sh
   npm run imessage:sim   # chat with the bot in this terminal — no BlueBubbles needed
   npm run imessage:dev   # real iMessage, through BlueBubbles Server on this Mac
   ```

   For `imessage:dev`, BlueBubbles Server must be running and signed in to
   iMessage, with `BLUEBUBBLES_URL` (default `http://localhost:1234`) and
   `BLUEBUBBLES_PASSWORD` set in `.env.local`.

The launcher opens a Cloudflare quick tunnel (the page Stripe sends the payer
back to), runs `stripe listen` to deliver the "paid" webhook, and starts the
bot. Ctrl-C stops all three.

## Try it

1. Text: "call +1… and ask if they're open today, you can say you're calling
   for me" (the number must be in `DISPATCH_ALLOWED_NUMBERS`).
2. With no balance you get a payment link. Open it and pay with card
   `4242 4242 4242 4242`, any future expiry, any CVC.
3. You get "You're funded". Say "go ahead": the quote comes off your balance,
   escrow locks, and the call is placed. A call that fails is refunded.

To fund the simulator without a browser:

```sh
stripe trigger checkout.session.completed --api-key "$STRIPE_SECRET_KEY" \
  --add "checkout_session:client_reference_id=+15550000000" \
  --add "checkout_session:metadata[chatGuid]=iMessage;-;+15550000000"
```

## Where things are

- Balances: `.local/imessage-ledger.jsonl`, append-only. It is the only record
  of what people paid; back it up.
- Logs from the launcher: `.local/imessage-bot.log` (simulator only) and
  `.local/imessage-stripe.log`.
- Pricing: the agent quotes each call in tUSDM; the sender pays $1 per tUSDM.
  Top-ups are `IMESSAGE_TOPUP_CENTS` (default $5), raised to cover the call when
  that is not enough.
