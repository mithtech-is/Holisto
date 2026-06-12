# Configuration Guide

## Plugin Options

All options are passed to `medusa-config.js`:

```js
{
  resolve: "@holisto/holisto-plugin-communication",
  options: {
    encryptionSecret: "...",
    brand: { ... },
    otp: { ... },
  }
}
```

### encryptionSecret (Required)

Used to encrypt provider credentials at rest. Must be at least 16 characters.

```js
encryptionSecret: process.env.COMMUNICATION_ENCRYPTION_SECRET
```

### brand (Optional)

Default brand values that can be overridden in the admin UI.

| Field | Type | Default | Description |
|---|---|---|---|
| `brand_name` | string | "Communication Hub" | Store/brand name |
| `company_name` | string | null | Legal company name |
| `storefront_url` | string | "https://example.com" | Store URL |
| `tagline` | string | null | Short tagline |
| `support_email` | string | null | Support email address |
| `support_phone` | string | null | Support phone number |
| `address` | string | null | Registered business address |

### otp (Optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `ttlSeconds` | number | 300 | OTP lifetime in seconds |
| `maxAttempts` | number | 5 | Max failed verification attempts |
| `resendCooldownSeconds` | number | 60 | Cooldown before OTP can be resent |

---

## Provider Configuration

### Email (SMTP)

Configured via the **Email** tab in the admin UI.

| Field | Description |
|---|---|
| Provider | smtp, sendgrid, resend, or aws_ses |
| Host | SMTP server hostname |
| Port | SMTP port (587 for TLS, 465 for SSL) |
| Username | SMTP authentication username |
| Password | SMTP authentication password |
| Encryption | tls, ssl, or none |
| From email | Sender email address |
| From name | Sender display name |
| Reply to | Reply-to address |

**Test**: Click "Test Email" after entering a recipient email.

### SMS (MSG91)

Configured via the **SMS** tab in the admin UI.

| Field | Description |
|---|---|
| Auth key | MSG91 API authentication key |
| Sender ID | MSG91 approved sender ID (max 6 chars) |
| Default template ID | DLT template ID for transactional SMS |
| OTP template ID | DLT template ID for OTP SMS |

**Test**: Enter a phone number and click "Send test SMS".

### WhatsApp (Polygin)

Configured via the **WhatsApp** tab in the admin UI.

| Field | Description |
|---|---|
| REST API token | Polygin API token for sending messages |
| Dashboard JWT | Polygin dashboard JWT for template management |
| Sender phone | WhatsApp sender phone number (E.164) |
| Test phone | Phone number for testing |

**Test**: Enter a message and click "Send test message".

---

## System Templates

The plugin auto-seeds system templates on first access. These include:

### Email Templates
- `order.placed` — Order confirmation
- `order.completed` — Order completed
- `order.cancelled` — Order cancelled
- `customer.created` — Welcome email
- `customer.approved` — Account approved
- `customer.rejected` — Account rejected
- `kyc.approved` — KYC approved
- `kyc.rejected` — KYC rejected
- `password.reset` — Password reset

### SMS Templates
- `auth.phone_otp_login` — Phone login OTP
- `order.placed` — Order placed notification
- `order.completed` — Order completed notification
- `order.cancelled` — Order cancelled notification
- `customer.created` — Welcome SMS
- `customer.approved` — Account approved SMS
- `customer.rejected` — Account rejected SMS
- `kyc.approved` — KYC approved SMS
- `kyc.rejected` — KYC rejected SMS
- `password.reset` — Password reset SMS

### WhatsApp Templates
- `auth.phone_otp_login` — Phone login OTP (AUTHENTICATION category)
- `order.placed` — Order placed (UTILITY category)
- `order.completed` — Order completed (UTILITY category)
- `order.cancelled` — Order cancelled (UTILITY category)
- `customer.created` — Welcome (UTILITY category)
- `kyc.approved` — KYC approved (UTILITY category)
- `kyc.rejected` — KYC rejected (UTILITY category)

---

## Event Bindings

Default event-to-template mappings:

| Event | Email | SMS | WhatsApp |
|---|---|---|---|
| `order.placed` | order.placed | order.placed | order.placed |
| `order.completed` | order.completed | order.completed | order.completed |
| `order.cancelled` | order.cancelled | order.cancelled | order.cancelled |
| `customer.created` | customer.created | customer.created | customer.created |
| `customer.approved` | customer.approved | — | — |
| `customer.rejected` | customer.rejected | — | — |
| `kyc.approved` | kyc.approved | — | kyc.approved |
| `kyc.rejected` | kyc.rejected | — | kyc.rejected |
| `customer.login` | — | auth.phone_otp_login | — |
