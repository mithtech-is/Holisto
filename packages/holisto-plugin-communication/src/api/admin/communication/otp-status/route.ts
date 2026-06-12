// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET /admin/communication/otp-status
 *
 * Aggregated health probe for the phone-OTP send cascade. The cascade
 * (defined in CommunicationModuleService.sendPhoneMessage) tries:
 *
 *   1. Polygin WhatsApp template (auth.phone_otp_login, must be `approved`)
 *   2. Polygin free-form WhatsApp text (requires Polygin token + active
 *      WhatsApp instance for the sender phone on Polygin's side)
 *   3. MSG91 SMS (requires MSG91 config row with auth_key + sender_id +
 *      otp_template_id)
 *
 * If all three bail, /store/auth/phone-otp/send returns 502 and the
 * customer never gets a code.
 *
 * This endpoint surfaces the state of every link in the chain so an
 * operator can answer "would OTP work right now?" without dropping into
 * psql. The verdict block at the top is the TL;DR; everything else is
 * supporting evidence.
 *
 * Returned shape is intentionally non-secret (auth keys / tokens are
 * never included). Provider rows expose presence flags + last_test
 * timestamps + last_test_error only.
 *
 * Admin auth — Medusa v2 gates `/admin/*` routes by default.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const mod = req.scope.resolve(
        COMMUNICATION_MODULE,
    ) as CommunicationModuleService

    // 1. Auth WhatsApp templates — the slugs the cascade looks up first.
    const authSlugs = ["auth.phone_otp_login", "auth.phone_verify_otp"]
    const wTemplates: any[] = await (mod as any).listWhatsappTemplates(
        { slug: authSlugs },
        { take: 10 },
    ).catch(() => [])
    const templates = authSlugs.map((slug) => {
        const row = wTemplates.find((r: any) => r.slug === slug)
        return {
            slug,
            present: Boolean(row),
            polygin_status: row?.polygin_status ?? null,
            has_polygin_template_id: Boolean(row?.polygin_template_id),
            language: row?.language ?? null,
            category: row?.category ?? null,
            polygin_last_error:
                typeof row?.polygin_last_error === "string"
                    ? row.polygin_last_error.slice(0, 200)
                    : null,
        }
    })

    // 2. Provider configs (presence + test status only — no secrets).
    const polygin = await mod.getPolyginConfigView().catch(() => null)
    const msg91 = await mod.getMsg91ConfigView().catch(() => null)

    // 3. Recent send activity — last 5 OTP requests with sent_via.
    const recentOtps: any[] = await (mod as any).listOtpRequests(
        {},
        { take: 5, order: { created_at: "DESC" } },
    ).catch(() => [])

    // 4. Last failure on each channel (a cheap "what broke?" hint).
    const lastWaFail: any[] = await (mod as any).listWhatsappLogs(
        { status: ["failed", "error"] },
        { take: 1, order: { created_at: "DESC" } },
    ).catch(() => [])
    const lastSmsFail: any[] = await (mod as any).listSmsLogs(
        { status: ["failed", "skipped", "error"] },
        { take: 1, order: { created_at: "DESC" } },
    ).catch(() => [])

    // 5. Verdict — boolean "would it work?" plus the chain of reasons.
    //    A channel is "working" if its config exists, its enabled flag is
    //    true, and its last_test_ok is not explicitly false. Templates
    //    only matter for the WhatsApp-template path; if approved with a
    //    polygin_template_id, that path is open.
    const reasons: string[] = []
    const loginTpl = templates.find((t) => t.slug === "auth.phone_otp_login")
    const loginTplReady =
        loginTpl?.polygin_status === "approved" &&
        loginTpl?.has_polygin_template_id
    if (!loginTplReady) {
        reasons.push(
            `WhatsApp template auth.phone_otp_login not ready (status=${
                loginTpl?.polygin_status ?? "missing"
            }, has_template_id=${loginTpl?.has_polygin_template_id ?? false})`,
        )
    }
    const polyginReady = polygin?.configured && polygin?.enabled
    if (!polyginReady) {
        reasons.push(
            `Polygin (WhatsApp): configured=${polygin?.configured ?? false}, enabled=${
                polygin?.enabled ?? false
            }`,
        )
    } else if (polygin?.last_test_ok === false) {
        reasons.push(
            `Polygin last test failed: ${polygin?.last_test_error?.slice(0, 120) ?? "(no message)"}`,
        )
    }
    const msg91Ready =
        msg91?.configured &&
        msg91?.enabled &&
        msg91?.auth_key_set &&
        msg91?.sender_id &&
        (msg91?.otp_template_id || msg91?.sms_template_id)
    if (!msg91Ready) {
        reasons.push(
            `MSG91 (SMS fallback): configured=${msg91?.configured ?? false}, enabled=${
                msg91?.enabled ?? false
            }, has_authkey=${msg91?.auth_key_set ?? false}, has_sender=${Boolean(
                msg91?.sender_id,
            )}, has_otp_template=${Boolean(msg91?.otp_template_id)}`,
        )
    } else if (msg91?.last_test_ok === false) {
        reasons.push(
            `MSG91 last test failed: ${msg91?.last_test_error?.slice(0, 120) ?? "(no message)"}`,
        )
    }

    // Cascade is "working" if AT LEAST ONE channel below the broken
    // template path is healthy. Even with the template not approved,
    // free-form WhatsApp + SMS together can carry the OTP. The verdict
    // is therefore:
    //   - cascade_works: at least one of (Polygin free-form, MSG91 SMS)
    //                    is ready.
    //   - all_paths_open: every link is ready (template + Polygin + MSG91).
    const cascade_works = Boolean(polyginReady || msg91Ready)
    const all_paths_open = Boolean(loginTplReady && polyginReady && msg91Ready)

    return res.json({
        verdict: {
            cascade_works,
            all_paths_open,
            reasons,
        },
        templates,
        polygin,
        msg91,
        recent_otp_requests: recentOtps.map((r: any) => ({
            id: r.id,
            created_at: r.created_at,
            purpose: r.purpose,
            sent_via: r.sent_via,
            consumed: Boolean(r.consumed_at),
            phone_e164_masked: maskPhone(r.phone_e164 as string),
        })),
        last_whatsapp_failure: lastWaFail[0]
            ? {
                  created_at: lastWaFail[0].created_at,
                  status: lastWaFail[0].status,
                  error:
                      typeof lastWaFail[0].error === "string"
                          ? lastWaFail[0].error.slice(0, 200)
                          : null,
              }
            : null,
        last_sms_failure: lastSmsFail[0]
            ? {
                  created_at: lastSmsFail[0].created_at,
                  status: lastSmsFail[0].status,
                  error:
                      typeof lastSmsFail[0].error === "string"
                          ? lastSmsFail[0].error.slice(0, 200)
                          : null,
              }
            : null,
    })
}

function maskPhone(phone: string | null | undefined): string {
    if (!phone) return ""
    if (phone.length <= 6) return phone
    return phone.slice(0, 3) + "*".repeat(phone.length - 5) + phone.slice(-2)
}
