import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import multer from "multer"
import { rateLimit } from "express-rate-limit"

/**
 * Plugin middleware config.
 *
 * Extracted from the host app's `src/api/middlewares.ts`, trimmed to the
 * wallet / KYC / VBA / webhook surface. Host-only concerns (helmet, static
 * file serving, password-lockout, auth-OTP, calcula/OVO/watchlist/etc.)
 * are intentionally left to the consuming app.
 *
 * Rate limiters here are scoped to the plugin's own matchers (not a blanket
 * `/admin/*` or `/store/*`) so they don't double-count against a host app
 * that already rate-limits globally.
 */

// Cast an Express-style middleware into the shape Medusa's middleware array
// accepts. multer + express-rate-limit are Express middlewares.
const xMw = <T>(h: T): any => h

const storeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ message: "Too many requests. Please slow down." }),
})

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res
      .status(429)
      .json({ message: "Too many upload attempts. Please wait a minute." }),
})

// KYC document uploads: in-memory, 2 MB cap, PDF/JPEG/PNG only. The route
// handler streams `req.file.buffer` to storage. (A magic-byte sniff can be
// layered on later; the mimetype filter is the v1 guard.)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Invalid file type. Only PDF, JPEG, and PNG are allowed.")),
})

const customer = authenticate("customer", ["session", "bearer"])
const admin = authenticate("user", ["session", "bearer"])

export default defineMiddlewares({
  routes: [
    // ── Webhooks: PUBLIC but signature-verified. Preserve the EXACT raw
    //    bytes so the HMAC-SHA256 check (over timestamp + rawBody) matches.
    //    JSON re-serialisation would break the digest. ───────────────────
    {
      matcher: "/webhooks/cashfree/*",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },

    // ── Store (authenticated customer) ──────────────────────────────────
    { matcher: "/store/wallet*", middlewares: [customer] },
    { matcher: "/store/bank-accounts*", middlewares: [customer] },
    { matcher: "/store/demat-accounts*", middlewares: [customer] },
    { matcher: "/store/kyc*", middlewares: [customer] },
    { matcher: "/store/checkout/precheck*", middlewares: [customer] },
    { matcher: "/store/company-requests*", middlewares: [customer] },
    { matcher: "/store/fees", middlewares: [customer, storeLimiter] },
    { matcher: "/store/ifsc/*", middlewares: [storeLimiter] },
    // Public forms — rate-limited, no auth.
    { matcher: "/store/contact", method: ["POST"], middlewares: [storeLimiter] },
    { matcher: "/store/newsletter", method: ["POST"], middlewares: [storeLimiter] },
    // KYC document upload (multer populates req.file).
    {
      matcher: "/store/upload",
      method: ["POST"],
      bodyParser: false,
      middlewares: [customer, uploadLimiter, xMw(upload.single("file"))],
    },
    { matcher: "/store/upload", method: ["DELETE"], middlewares: [customer, uploadLimiter] },

    // ── Admin (authenticated user) ──────────────────────────────────────
    { matcher: "/admin/wallets*", middlewares: [admin] },
    { matcher: "/admin/webhook-events*", middlewares: [admin] },
    { matcher: "/admin/secure-id-verifications*", middlewares: [admin] },
    { matcher: "/admin/held-orders*", middlewares: [admin] },
    { matcher: "/admin/cashfree-settings*", middlewares: [admin] },
    { matcher: "/admin/dev/cashfree-ping", middlewares: [admin] },
    { matcher: "/admin/manual-kyc-requests*", middlewares: [admin] },
    { matcher: "/admin/kyc-overview", middlewares: [admin] },
    { matcher: "/admin/deposit-proofs*", middlewares: [admin] },
    { matcher: "/admin/bank-accounts*", middlewares: [admin] },
    { matcher: "/admin/demat-accounts*", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/kyc*", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/pan-record", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/aadhaar-record", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/files", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/attach-file", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/audit-log", middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/provision-vba", method: ["POST"], middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/sync-vba", method: ["POST"], middlewares: [admin] },
    { matcher: "/admin/customers/:customer_id/sync-wallet", method: ["POST"], middlewares: [admin] },
    {
      matcher: "/admin/upload",
      method: ["POST"],
      bodyParser: false,
      middlewares: [admin, uploadLimiter, xMw(upload.single("file"))],
    },
    { matcher: "/admin/upload", method: ["DELETE"], middlewares: [admin, uploadLimiter] },
  ],
})
