# Medusa Plugin Communication

Multi-channel communication hub for **Medusa v2** — Email (SMTP), SMS (MSG91), WhatsApp (Polygin), Phone OTP, transactional templates, event-driven notifications, and delivery logs — all managed from a single admin panel.

## Features

- **Brand Management** — Centralized brand info (name, logo, support details) with automatic placeholder substitution across all channels
- **Email (SMTP)** — Configure any SMTP provider, test connection, send transactional emails with Nodemailer
- **SMS (MSG91)** — MSG91 integration with DLT template IDs, OTP SMS, and delivery tracking
- **WhatsApp (Polygin)** — Polygin integration with template push/sync, approval status, and message sending
- **Phone OTP** — 6-digit OTP with bcrypt hashing, rate limiting, attempt tracking, expiration, and WhatsApp → SMS fallback
- **Templates** — Channel-specific templates (Email/SMS/WhatsApp) with Handlebars-style variables (`{{customer_name}}`, `{{order_id}}`, etc.)
- **Event Bindings** — Map Medusa events (order.placed, customer.created, kyc.approved, etc.) to templates with recipient resolvers
- **Delivery Logs** — Per-channel delivery logs with status tracking, filtering, and search
- **AES-256 Encryption** — All provider credentials encrypted at rest
- **Admin UI** — Full Medusa Admin v2 integration with 15 dedicated tabs

## Quick Start

```bash
npm install @holisto/holisto-plugin-communication
```

Add to `medusa-config.js`:

```js
plugins: [
  {
    resolve: "@holisto/holisto-plugin-communication",
    options: {
      encryptionSecret: process.env.COMMUNICATION_ENCRYPTION_SECRET,
    }
  }
]
```

Run migrations:

```bash
npx medusa db:migrate
```

Start your Medusa app and navigate to **Settings → Communication** in the admin panel.

## Documentation

| Document | Description |
|---|---|
| [INSTALLATION.md](./INSTALLATION.md) | Full installation guide with examples |
| [CONFIGURATION.md](./CONFIGURATION.md) | Provider setup and plugin options |
| [API_REFERENCE.md](./API_REFERENCE.md) | Complete API route documentation |
| [.env.example](./.env.example) | Environment variables reference |

## Supported Events

- `customer.created`, `customer.updated`, `customer.approved`, `customer.rejected`
- `order.placed`, `order.completed`, `order.cancelled`
- `kyc.approved`, `kyc.rejected`
- `password.reset`
- `otp.sent`, `otp.verified`

## Template Variables

| Variable | Source | Description |
|---|---|---|
| `{{brand}}` | Brand config | Brand name |
| `{{company_name}}` | Brand config | Company name |
| `{{storefront_url}}` | Brand config | Store URL |
| `{{support_email}}` | Brand config | Support email |
| `{{support_phone}}` | Brand config | Support phone |
| `{{customer.first_name}}` | Event data | Customer first name |
| `{{customer.email}}` | Event data | Customer email |
| `{{customer.phone}}` | Event data | Customer phone |
| `{{order.display_id}}` | Event data | Order display ID |
| `{{amount}}` | Event data | Order amount |
| `{{otp}}` | System | OTP code |
| `{{expiry_minutes}}` | System | OTP expiry in minutes |

## Providers

| Channel | Provider | Purpose |
|---|---|---|
| Email | SMTP (Nodemailer) | Transactional emails |
| SMS | MSG91 | SMS notifications & OTP |
| WhatsApp | Polygin | WhatsApp notifications & OTP |

## License

MIT
