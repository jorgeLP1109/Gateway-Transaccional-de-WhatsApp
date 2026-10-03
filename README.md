# WA Gateway SaaS

Modular Express/Mongoose gateway with per-user WhatsApp sessions, subscriptions,
manual payment review, Binance Pay/PayPal orders, and durable welcome-message
notifications. The existing Baileys implementation in `sessionManager.js`
remains the session engine; stream restart code 515 reconnects without deleting
the auth state.

## Requirements and startup

- Node.js 20.19 or later (or Node.js 22+).
- MongoDB configured as a replica set (MongoDB Atlas works). Subscription
  provisioning uses a transaction so payment approval, renewal, and notification
  enqueue are committed atomically.
- Copy `.env.example` to `.env`; set independent random values of at least 32
  bytes for `JWT_SECRET` and `API_KEY_ENCRYPTION_SECRET`.
- Set `MONGODB_URI`, `PUBLIC_BASE_URL`, plan prices, and only the payment provider
  credentials/methods you intend to enable.
- `API_SECRET_KEY` is retained for the existing administrative API routes.
- Run `npm install`, then `npm start`; under PM2, use
  `pm2 start server.js --name wa-gateway --time`.

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_PHONE` together to create the
initial administrator at first startup. Public account registration creates
client accounts only. Passwords are bcrypt-hashed; API keys are stored encrypted
for welcome delivery and additionally stored as SHA-256 digests for lookup.
The plaintext key is returned only on registration or key rotation.

## WhatsApp sessions

Each user's `clientId` is assigned after payment approval and maps to the
existing Baileys auth directory under `sessions/<clientId>`. Connect using
`/connect/<clientId>` and an API key with an active subscription. Configure and
pair one separate WhatsApp sender session as `SYSTEM_WHATSAPP_CLIENT_ID` for
automatic welcome notifications. The worker will initialize this sender when
it has a welcome message to send; open `/connect/<SYSTEM_WHATSAPP_CLIENT_ID>`
with the administrative API key once to pair it. Notifications are persisted and retried; an
administrator can retry exhausted jobs with the payment admin route.

Baileys keeps `syncFullHistory: false` and does not add application listeners
that retain history/chats/messages. Its default history-message sync predicate
is intentionally left intact so initial LID mappings remain available.

## Payments

- `GET /api/v1/payments/pago-movil/info?plan=basic|pro` returns configured bank
  details, the amount calculated from `PAYMENT_VES_PER_USD`, and a QR DataURL.
  Unless `PAGO_MOVIL_QR_PAYLOAD` is configured with a bank-supported payload,
  the QR contains gateway JSON for display/scan convenience and is not an
  interoperable bank payment QR.
- Pago Móvil reports are submitted to
  `POST /api/v1/payments/pago-movil/report`.
- `GET /api/v1/payments/facebank/info` and
  `POST /api/v1/payments/facebank/report` provide the Facebank/Pipol Pay flow.
- Binance Pay uses RSA request signing and verifies webhook signatures with the
  configured Binance public key and its webhook certificate serial (separate
  from the merchant certificate serial used to sign requests).
- PayPal order creation/capture uses the Orders API; webhooks are verified with
  PayPal's webhook verification API.
- Pago Móvil and Facebank reports are approved/rejected by an administrator
  through `POST /api/v1/payments/admin/:paymentId/review`.

Authenticated user endpoints use `Authorization: Bearer <JWT>`. WhatsApp
message/session endpoints retain API-key compatibility and restrict SaaS users
to their own active subscription. Subscription/payment status is available from
`GET /api/v1/payments/subscription` and `GET /api/v1/payments/history`. Payment webhook URLs must be publicly
reachable over HTTPS. Use sandbox credentials and provider test webhooks before
production.

The welcome WhatsApp message necessarily carries the newly generated client ID
and API key as requested. Treat the recipient phone as trusted, protect the
system sender account, and avoid sharing those messages.
