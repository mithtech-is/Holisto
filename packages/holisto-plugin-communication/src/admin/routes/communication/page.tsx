// @ts-nocheck
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight } from "@medusajs/icons"
import React, { useEffect, useState } from "react"
import { Container, Heading, Tabs, Text } from "@medusajs/ui"
import EmailSettingsTab from "./_components/EmailSettingsTab"
import EmailTemplatesTab from "./_components/EmailTemplatesTab"
import EmailEventsTab from "./_components/EmailEventsTab"
import EmailLogsTab from "./_components/EmailLogsTab"
// New comms tabs.
import BrandTab from "./_components/BrandTab"
import Msg91SettingsTab from "./_components/Msg91SettingsTab"
import PolyginSettingsTab from "./_components/PolyginSettingsTab"
import SmsLogsTab from "./_components/SmsLogsTab"
import SmsEventsTab from "./_components/SmsEventsTab"
import WhatsappLogsTab from "./_components/WhatsappLogsTab"
import OtpLogsTab from "./_components/OtpLogsTab"
import WhatsappTemplatesTab from "./_components/WhatsappTemplatesTab"
import SmsTemplatesTab from "./_components/SmsTemplatesTab"
import WhatsappEventsTab from "./_components/WhatsappEventsTab"

/**
 * /app/communication — single hub for all customer-facing communication.
 *
 * Replaces the narrower "Email" page. The email tabs are mounted as-is
 * from the email route's _components folder so we don't fork the code;
 * the SMS / WhatsApp / OTP tabs are net-new.
 *
 * Tab state is mirrored to the URL hash (`?tab=email`) so the old
 * /app/email route can `window.location.replace` to this page with the
 * Email tab pre-selected.
 */
type TabKey =
    | "brand"
    | "email"
    | "sms"
    | "whatsapp"
    | "otp"
    | "whatsapp-templates"
    | "sms-templates"
    | "templates"
    | "events"
    | "sms-events"
    | "whatsapp-events"
    | "email-logs"
    | "sms-logs"
    | "whatsapp-logs"

const VALID_TABS: TabKey[] = [
    "brand",
    "email",
    "sms",
    "whatsapp",
    "otp",
    "whatsapp-templates",
    "sms-templates",
    "templates",
    "events",
    "sms-events",
    "whatsapp-events",
    "email-logs",
    "sms-logs",
    "whatsapp-logs",
]

function readInitialTab(): TabKey {
    if (typeof window === "undefined") return "brand"
    const params = new URLSearchParams(window.location.search)
    const candidate = params.get("tab") as TabKey | null
    if (candidate && VALID_TABS.includes(candidate)) return candidate
    return "brand"
}

const CommunicationPage = () => {
    const [tab, setTab] = useState<TabKey>(readInitialTab)

    // Reflect the active tab into the URL so refreshing keeps you on
    // the same view + the email-page redirect can deep-link.
    useEffect(() => {
        if (typeof window === "undefined") return
        const params = new URLSearchParams(window.location.search)
        if (params.get("tab") !== tab) {
            params.set("tab", tab)
            const next =
                window.location.pathname + "?" + params.toString()
            window.history.replaceState(null, "", next)
        }
    }, [tab])

    return (
        <Container className="flex flex-col gap-6 p-6">
            <div>
                <Heading level="h1">Communication</Heading>
                <Text className="text-ui-fg-muted">
                    Email (SMTP), SMS (MSG91), and WhatsApp (Polygin) — connect
                    each provider, manage transactional templates, and watch
                    delivery logs in one place. Phone OTP for sign-in and
                    number verification is built on top of the WhatsApp →
                    SMS fallback router.
                </Text>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
                <Tabs.List>
                    <Tabs.Trigger value="brand">Brand</Tabs.Trigger>
                    <Tabs.Trigger value="email">Email</Tabs.Trigger>
                    <Tabs.Trigger value="sms">SMS</Tabs.Trigger>
                    <Tabs.Trigger value="whatsapp">WhatsApp</Tabs.Trigger>
                    <Tabs.Trigger value="otp">Phone OTP</Tabs.Trigger>
                    <Tabs.Trigger value="whatsapp-templates">
                        WhatsApp templates
                    </Tabs.Trigger>
                    <Tabs.Trigger value="sms-templates">
                        SMS templates
                    </Tabs.Trigger>
                    <Tabs.Trigger value="templates">
                        Email templates
                    </Tabs.Trigger>
                    <Tabs.Trigger value="events">Email events</Tabs.Trigger>
                    <Tabs.Trigger value="sms-events">SMS events</Tabs.Trigger>
                    <Tabs.Trigger value="whatsapp-events">
                        WhatsApp events
                    </Tabs.Trigger>
                    <Tabs.Trigger value="email-logs">Email log</Tabs.Trigger>
                    <Tabs.Trigger value="sms-logs">SMS log</Tabs.Trigger>
                    <Tabs.Trigger value="whatsapp-logs">
                        WhatsApp log
                    </Tabs.Trigger>
                </Tabs.List>
                <div className="mt-5">
                    <Tabs.Content value="brand">
                        <BrandTab />
                    </Tabs.Content>
                    <Tabs.Content value="email">
                        <EmailSettingsTab />
                    </Tabs.Content>
                    <Tabs.Content value="sms">
                        <Msg91SettingsTab />
                    </Tabs.Content>
                    <Tabs.Content value="whatsapp">
                        <PolyginSettingsTab />
                    </Tabs.Content>
                    <Tabs.Content value="otp">
                        <OtpLogsTab />
                    </Tabs.Content>
                    <Tabs.Content value="whatsapp-templates">
                        <WhatsappTemplatesTab />
                    </Tabs.Content>
                    <Tabs.Content value="sms-templates">
                        <SmsTemplatesTab />
                    </Tabs.Content>
                    <Tabs.Content value="templates">
                        <EmailTemplatesTab />
                    </Tabs.Content>
                    <Tabs.Content value="events">
                        <EmailEventsTab />
                    </Tabs.Content>
                    <Tabs.Content value="sms-events">
                        <SmsEventsTab />
                    </Tabs.Content>
                    <Tabs.Content value="whatsapp-events">
                        <WhatsappEventsTab />
                    </Tabs.Content>
                    <Tabs.Content value="email-logs">
                        <EmailLogsTab />
                    </Tabs.Content>
                    <Tabs.Content value="sms-logs">
                        <SmsLogsTab />
                    </Tabs.Content>
                    <Tabs.Content value="whatsapp-logs">
                        <WhatsappLogsTab />
                    </Tabs.Content>
                </div>
            </Tabs>
        </Container>
    )
}

export const config = defineRouteConfig({
    label: "Communication",
    icon: ChatBubbleLeftRight,
})

export default CommunicationPage
