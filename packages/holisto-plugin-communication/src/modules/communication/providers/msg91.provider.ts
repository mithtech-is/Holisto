// @ts-nocheck
export interface Msg91Config {
  auth_key: string
  sender_id: string
  default_template_id?: string
  otp_template_id?: string
}

export interface SendSmsInput {
  to: string
  body: string
  template_id?: string
  dlt_template_id?: string
}

export interface SendSmsResult {
  ok: boolean
  provider_message_id?: string
  error?: string
  raw?: any
}

const MSG91_BASE = "https://api.msg91.com/api/v5"

async function msg91Request(
  endpoint: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: any
    authKey: string
  },
): Promise<any> {
  const url = `${MSG91_BASE}${endpoint}`
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "authkey": options.authKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.message || `MSG91 API error: ${response.status}`)
  }
  return data
}

export async function sendSms(
  config: Msg91Config,
  input: SendSmsInput,
): Promise<SendSmsResult> {
  try {
    const payload: any = {
      sender: config.sender_id,
      mobile: input.to.replace(/^\+/, ""),
      message: input.body,
    }

    if (input.dlt_template_id || config.default_template_id) {
      payload.template_id = input.dlt_template_id || config.default_template_id
    }

    const data = await msg91Request("/flow/", {
      method: "POST",
      authKey: config.auth_key,
      body: payload,
    })

    return {
      ok: true,
      provider_message_id: data?.type || data?.request_id || null,
      raw: data,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "MSG91 API error",
    }
  }
}

export async function sendOtpSms(
  config: Msg91Config,
  phone: string,
  otp: string,
): Promise<SendSmsResult> {
  try {
    const mobile = phone.replace(/^\+/, "")

    if (config.otp_template_id) {
      const data = await msg91Request("/otp", {
        method: "POST",
        authKey: config.auth_key,
        body: {
          template_id: config.otp_template_id,
          mobile,
          otp,
        },
      })
      return { ok: true, provider_message_id: data?.type || null, raw: data }
    }

    const data = await msg91Request("/otp", {
      method: "GET",
      authKey: config.auth_key,
      body: undefined,
      headers: {
        "Content-Type": "application/json",
      },
    })
    return { ok: true, provider_message_id: null, raw: data }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "MSG91 OTP error",
    }
  }
}

export async function verifyOtpSms(
  config: Msg91Config,
  phone: string,
  otp: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const mobile = phone.replace(/^\+/, "")
    const data = await msg91Request(`/otp/verify?mobile=${mobile}&otp=${otp}`, {
      method: "POST",
      authKey: config.auth_key,
    })
    return { ok: data?.type === "success" }
  } catch (err: any) {
    return { ok: false, error: err?.message || "MSG91 OTP verify error" }
  }
}

export async function testMsg91Connection(config: Msg91Config): Promise<SendSmsResult> {
  try {
    const data = await msg91Request("/wallet", {
      method: "GET",
      authKey: config.auth_key,
    })
    return { ok: true, raw: data }
  } catch (err: any) {
    return { ok: false, error: err?.message || "MSG91 connection test failed" }
  }
}
