// @ts-nocheck
export interface PolyginConfig {
  token: string
  dashboard_token?: string
  sender_phone: string
  test_phone?: string
}

export interface SendWhatsappInput {
  to: string
  text?: string
  template_slug?: string
  template_components?: any[]
  variables?: Record<string, string>
}

export interface SendWhatsappResult {
  ok: boolean
  provider_message_id?: string
  error?: string
  raw?: any
}

export interface PolyginTemplate {
  id: string
  name: string
  category: string
  language: string
  status: string
  components: any[]
  rejection_reason?: string
}

const POLYGIN_BASE = "https://api.polygin.ai/api/v1"

async function polyginRequest(
  endpoint: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: any
    token: string
  },
): Promise<any> {
  const url = `${POLYGIN_BASE}${endpoint}`
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${options.token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Polygin API error: ${response.status}`)
  }
  return data
}

export async function sendWhatsappMessage(
  config: PolyginConfig,
  input: SendWhatsappInput,
): Promise<SendWhatsappResult> {
  try {
    const payload: any = {
      to: input.to.replace(/^\+/, ""),
      from: config.sender_phone.replace(/^\+/, ""),
    }

    if (input.template_slug) {
      payload.type = "template"
      payload.template = {
        name: input.template_slug,
        language: { code: "en_US" },
        components: input.template_components || [],
      }
    } else {
      payload.type = "text"
      payload.text = { body: input.text || "" }
    }

    const data = await polyginRequest("/messages", {
      method: "POST",
      token: config.token,
      body: payload,
    })

    return {
      ok: true,
      provider_message_id: data?.message_id || data?.id || null,
      raw: data,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Polygin API error",
    }
  }
}

export async function sendWhatsappTemplate(
  config: PolyginConfig,
  input: {
    to: string
    template_name: string
    language?: string
    components?: any[]
  },
): Promise<SendWhatsappResult> {
  try {
    const payload = {
      to: input.to.replace(/^\+/, ""),
      from: config.sender_phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: input.template_name,
        language: { code: input.language || "en_US" },
        components: input.components || [],
      },
    }

    const data = await polyginRequest("/messages", {
      method: "POST",
      token: config.token,
      body: payload,
    })

    return {
      ok: true,
      provider_message_id: data?.message_id || data?.id || null,
      raw: data,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Polygin template send error",
    }
  }
}

export async function pushTemplate(
  config: PolyginConfig,
  template: {
    name: string
    category: string
    language: string
    components: any[]
  },
): Promise<{ ok: boolean; provider_template_id?: string; error?: string; raw?: any }> {
  try {
    if (!config.dashboard_token) {
      return { ok: false, error: "Dashboard token required for template push" }
    }

    const data = await polyginRequest("/templates", {
      method: "POST",
      token: config.dashboard_token,
      body: {
        name: template.name,
        category: template.category,
        language: template.language,
        components: template.components,
      },
    })

    return {
      ok: true,
      provider_template_id: data?.id || data?.template_id || null,
      raw: data,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Polygin template push error",
    }
  }
}

export async function syncTemplates(
  config: PolyginConfig,
): Promise<{ ok: boolean; templates?: PolyginTemplate[]; error?: string }> {
  try {
    if (!config.dashboard_token) {
      return { ok: false, error: "Dashboard token required for template sync" }
    }

    const data = await polyginRequest("/templates", {
      method: "GET",
      token: config.dashboard_token,
    })

    const templates: PolyginTemplate[] = (data?.data || data?.templates || []).map(
      (t: any) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        language: t.language || "en_US",
        status: t.status,
        components: t.components || [],
        rejection_reason: t.rejection_reason,
      }),
    )

    return { ok: true, templates }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Polygin template sync error" }
  }
}

export async function testPolyginConnection(
  config: PolyginConfig,
): Promise<SendWhatsappResult> {
  try {
    const data = await polyginRequest("/account", {
      method: "GET",
      token: config.token,
    })
    return { ok: true, raw: data }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Polygin connection test failed" }
  }
}
