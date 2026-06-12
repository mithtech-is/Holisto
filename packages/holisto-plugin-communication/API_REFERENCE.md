# API Reference

All admin routes are prefixed with `/admin/communication`.
Store routes are prefixed with `/store/otp`.

---

## Admin Routes

### Brand Configuration

#### `GET /admin/communication/brand`
Returns the current brand configuration.

```json
{
  "id": "commbrand_xxx",
  "brand_name": "My Store",
  "company_name": "My Store Inc.",
  "storefront_url": "https://mystore.com",
  "tagline": "Your one-stop shop",
  "support_email": "support@mystore.com",
  "support_phone": "+1234567890",
  "address": "123 Main St",
  "whatsapp_bot_label": "Initiate Bot",
  "whatsapp_bot_categories": ["UTILITY", "MARKETING"]
}
```

#### `PUT /admin/communication/brand`
Upsert brand configuration.

**Body:**
```json
{
  "brand_name": "My Store",
  "company_name": "My Store Inc.",
  "storefront_url": "https://mystore.com",
  "tagline": "Your one-stop shop",
  "support_email": "support@mystore.com",
  "support_phone": "+1234567890",
  "address": "123 Main St",
  "whatsapp_bot_label": "Initiate Bot",
  "whatsapp_bot_categories": ["UTILITY", "MARKETING"]
}
```

---

### Email Provider

#### `GET /admin/communication/email/config`
Returns email provider config (secrets masked).

#### `PUT /admin/communication/email/config`
Update email provider config.

**Body:**
```json
{
  "provider": "smtp",
  "enabled": true,
  "host": "smtp.example.com",
  "port": "587",
  "username": "user@example.com",
  "password": "***",
  "encryption": "tls",
  "from_email": "noreply@example.com",
  "from_name": "My Store",
  "reply_to": "support@example.com"
}
```

#### `POST /admin/communication/email/test`
Send a test email to verify provider configuration.

**Body:** `{ "to": "test@example.com", "provider": "smtp" }`

---

### SMS Provider (MSG91)

#### `GET /admin/communication/msg91/config`
Returns MSG91 config (auth_key masked).

#### `PUT /admin/communication/msg91/config`
Update MSG91 config.

**Body:**
```json
{
  "auth_key": "your-msg91-key",
  "sender_id": "COMM",
  "default_template_id": "dlt_template_id",
  "otp_template_id": "dlt_otp_template_id",
  "enabled": true
}
```

#### `POST /admin/communication/msg91/test`
Send test SMS.

**Body:** `{ "to": "+1234567890" }`

---

### WhatsApp Provider (Polygin)

#### `GET /admin/communication/polygin/config`
Returns Polygin config (tokens masked).

#### `PUT /admin/communication/polygin/config`
Update Polygin config.

**Body:**
```json
{
  "token": "polygin-api-token",
  "dashboard_token": "polygin-dashboard-jwt",
  "sender_phone": "+919999999999",
  "test_phone": "+919999999998",
  "enabled": true
}
```

#### `POST /admin/communication/polygin/test`
Send test WhatsApp message.

**Body:** `{ "to": "+1234567890", "text": "Test message" }`

---

### Templates

#### `GET /admin/communication/email-templates`
List email templates. Supports `?limit=&search=&status=` filters.

#### `POST /admin/communication/email-templates`
Create or update an email template.

**Body:**
```json
{
  "slug": "order.placed",
  "label": "Order placed",
  "subject": "Order confirmed",
  "html": "<h1>Order confirmed</h1>",
  "body": "Your order has been placed.",
  "category": "transactional",
  "language": "en_US"
}
```

#### `GET /admin/communication/email-templates/:slug`
Get email template by slug.

#### `PUT /admin/communication/email-templates/:slug`
Update email template by slug.

#### `DELETE /admin/communication/email-templates/:slug`
Delete email template (system templates cannot be deleted).

#### `POST /admin/communication/email-templates/refresh-system`
Re-seed system email templates.

#### `GET /admin/communication/sms-templates`
List SMS templates.

#### `POST /admin/communication/sms-templates`
Create/update SMS template.

#### `GET /admin/communication/sms-templates/:slug`
Get SMS template.

#### `PUT /admin/communication/sms-templates/:slug`
Update SMS template.

#### `DELETE /admin/communication/sms-templates/:slug`
Delete SMS template.

#### `POST /admin/communication/sms-templates/refresh-system`
Re-seed system SMS templates.

#### `GET /admin/communication/whatsapp-templates`
List WhatsApp templates.

#### `POST /admin/communication/whatsapp-templates`
Create/update WhatsApp template.

#### `GET /admin/communication/whatsapp-templates/:slug`
Get WhatsApp template with preview.

#### `PUT /admin/communication/whatsapp-templates/:slug`
Update WhatsApp template.

#### `DELETE /admin/communication/whatsapp-templates/:slug`
Delete WhatsApp template.

#### `POST /admin/communication/whatsapp-templates/:slug/push`
Push template to Polygin for Meta approval.

#### `POST /admin/communication/whatsapp-templates/:slug/preview`
Preview template with resolved brand placeholders.

#### `POST /admin/communication/whatsapp-templates/sync`
Sync template status from Polygin.

#### `POST /admin/communication/whatsapp-templates/refresh-system`
Re-seed system WhatsApp templates.

---

### Event Bindings

#### `GET /admin/communication/events`
List event rules. Supports `?channel=email|sms|whatsapp` filter.

#### `PUT /admin/communication/events`
Create or update an event rule.

**Body:**
```json
{
  "event_name": "order.placed",
  "channel": "email",
  "template_slug": "order.placed",
  "recipient_resolver": "customer",
  "static_recipient": null,
  "enabled": true,
  "delay_seconds": 0
}
```

#### `GET /admin/communication/whatsapp-events`
List WhatsApp event mappings.

#### `PUT /admin/communication/whatsapp-events`
Upsert WhatsApp event mapping.

---

### OTP

#### `GET /admin/communication/otp-requests`
List OTP requests with status.

#### `GET /admin/communication/otp-status`
OTP health check — checks provider configs and template approval.

---

### Logs

#### `GET /admin/communication/email-logs`
List email logs. Supports `?limit=&status=` filters.

#### `GET /admin/communication/sms-logs`
List SMS logs. Supports `?limit=&status=` filters.

#### `GET /admin/communication/whatsapp-logs`
List WhatsApp logs. Supports `?limit=&status=` filters.

---

## Store Routes

### OTP

#### `POST /store/otp/send`
Send OTP to phone.

**Body:** `{ "phone": "+1234567890", "purpose": "login", "channel": "whatsapp" }`

**Response:** `{ "ok": true, "request_id": "xxx", "expires_at": "...", "sent_via": "whatsapp" }`

#### `POST /store/otp/verify`
Verify OTP code.

**Body:** `{ "phone": "+1234567890", "code": "123456", "purpose": "login" }`

**Response:** `{ "ok": true, "request_id": "xxx" }`

#### `POST /store/otp/resend`
Resend OTP.

**Body:** `{ "phone": "+1234567890", "purpose": "login", "channel": "whatsapp" }`

---

## Recipient Resolvers

| Resolver | Description |
|---|---|
| `customer` | Auto-detect from event data (email > phone) |
| `customer_email` | Customer email from event data |
| `customer_phone` | Customer phone from event data |
| `admin_email` | Admin email (configured in system) |
| `admin_phone` | Admin phone (configured in system) |
| `static_email` | Use static_recipient as email |
| `static_phone` | Use static_recipient as phone |

---

## Status Codes

| Code | Description |
|---|---|
| 200 | Success |
| 400 | Validation error |
| 404 | Resource not found |
| 409 | Conflict (e.g., system template deletion) |
| 500 | Internal server error |
| 502 | Provider error |

## Error Response Format

```json
{
  "message": "Error description",
  "errors": {
    "fieldErrors": { "field": ["error1"] }
  }
}
```
