// @ts-nocheck
import React, { useEffect, useState } from "react"
import { Badge, Heading, Table } from "@medusajs/ui"

export default function EmailLogsTab() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    fetch("/admin/communication/email-logs", { credentials: "include" })
      .then((r) => r.json())
      .then((r) => setRows(r.logs || []))
  }, [])
  return (
    <div>
      <Heading level="h2">Email logs</Heading>
      <Table className="mt-3">
        <Table.Header><Table.Row><Table.HeaderCell>Recipient</Table.HeaderCell><Table.HeaderCell>Subject</Table.HeaderCell><Table.HeaderCell>Provider</Table.HeaderCell><Table.HeaderCell>Status</Table.HeaderCell></Table.Row></Table.Header>
        <Table.Body>{rows.map((row) => <Table.Row key={row.id}><Table.Cell>{row.to_email || row.recipient}</Table.Cell><Table.Cell>{row.subject}</Table.Cell><Table.Cell>{row.provider}</Table.Cell><Table.Cell><Badge>{row.status}</Badge></Table.Cell></Table.Row>)}</Table.Body>
      </Table>
    </div>
  )
}
