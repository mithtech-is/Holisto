# Installation Guide

## Prerequisites

- **Medusa v2** (`@medusajs/framework` >= 2.0.0)
- **Node.js** >= 20.x
- **PostgreSQL** database
- **Medusa Admin** configured with React support

## Step 1: Install the Package

```bash
npm install @holisto/holisto-plugin-communication
```

## Step 2: Configure medusa-config.js

```js
const plugins = [
  // ... other plugins
  {
    resolve: "@holisto/holisto-plugin-communication",
    options: {
      // Required: encryption key for provider credentials (min 16 chars)
      encryptionSecret: process.env.COMMUNICATION_ENCRYPTION_SECRET,

      // Optional: default brand values
      brand: {
        brand_name: "My Store",
        company_name: "My Store Inc.",
        storefront_url: "https://mystore.com",
        tagline: "Your one-stop shop",
        support_email: "support@mystore.com",
        support_phone: "+1234567890",
      },

      // Optional: OTP configuration
      otp: {
        ttlSeconds: 300,            // OTP valid for 5 minutes
        maxAttempts: 5,              // Max failed attempts
        resendCooldownSeconds: 60,   // Must wait 60s before resend
      },
    },
  },
]
```

## Step 3: Set Environment Variables

Create a `.env` file:

```env
COMMUNICATION_ENCRYPTION_SECRET=your-32-char-random-string-here
```

## Step 4: Run Migrations

```bash
npx medusa db:migrate
```

This creates the following tables in your database:
- `communication_brand_config`
- `communication_provider_config`
- `communication_template`
- `communication_event_rule`
- `communication_message_log`
- `communication_otp_request`
- `communication_webhook_event`
- `communication_audit_log`

## Step 5: Start the Server

```bash
npx medusa develop
```

## Step 6: Access the Admin Panel

Navigate to **Settings → Communication** in your Medusa Admin.

The admin page is available at: `/app/communication`

## Verify Installation

1. Open the admin panel
2. Go to **Communication**
3. You should see 15 tabs: Brand, Email, SMS, WhatsApp, Phone OTP, WhatsApp Templates, SMS Templates, Email Templates, Email Events, SMS Events, WhatsApp Events, Email Log, SMS Log, WhatsApp Log
4. Configure providers under each tab
5. System templates are auto-seeded on first access

## Troubleshooting

| Issue | Solution |
|---|---|
| "Module not found" errors | Ensure `@medusajs/framework` is installed and at version ^2.0.0 |
| Migration fails | Check PostgreSQL connection and run `npx medusa db:migrate` manually |
| Admin page not showing | Clear browser cache and restart the server |
| Email sending fails | Verify SMTP credentials and test connection in the Email tab |
| SMS sending fails | Verify MSG91 auth key and sender ID in the SMS tab |
| WhatsApp sending fails | Verify Polygin API token in the WhatsApp tab |
