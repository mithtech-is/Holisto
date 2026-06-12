// @ts-nocheck
import nodemailer from "nodemailer"

export interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name?: string
  reply_to?: string
  security_type?: "tls" | "ssl" | "none"
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  reply_to?: string
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>
}

export interface SendEmailResult {
  ok: boolean
  message_id?: string
  provider_message_id?: string
  error?: string
}

export function createTransport(config: SmtpConfig): nodemailer.Transporter {
  const secure = config.security_type === "ssl"
  const ignoreTls = config.security_type === "none"

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    ignoreTLS: ignoreTls,
    auth: config.username
      ? { user: config.username, pass: config.password }
      : undefined,
  })
}

export async function sendEmailWithSmtp(
  config: SmtpConfig,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  try {
    const transporter = createTransport(config)
    const recipients = Array.isArray(input.to) ? input.to.join(", ") : input.to

    const mailOptions: nodemailer.SendMailOptions = {
      from: config.from_name
        ? `"${config.from_name}" <${config.from_email}>`
        : config.from_email,
      replyTo: input.reply_to || config.reply_to,
      to: recipients,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }

    if (input.cc) {
      mailOptions.cc = Array.isArray(input.cc) ? input.cc.join(", ") : input.cc
    }
    if (input.bcc) {
      mailOptions.bcc = Array.isArray(input.bcc) ? input.bcc.join(", ") : input.bcc
    }
    if (input.attachments && input.attachments.length > 0) {
      mailOptions.attachments = input.attachments
    }

    const info = await transporter.sendMail(mailOptions)

    return {
      ok: true,
      message_id: info.messageId,
      provider_message_id: info.messageId,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Unknown SMTP error",
    }
  }
}

export async function testSmtpConnection(config: SmtpConfig): Promise<SendEmailResult> {
  try {
    const transporter = createTransport(config)
    await transporter.verify()
    return { ok: true }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "SMTP connection test failed",
    }
  }
}
