import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Text,
} from "@medusajs/ui"
import { adminFetch, formatDate } from "../helpers"

type Props = { customerId: string }

type FileEntry = {
  url: string
  kind: string
  source: {
    entity: "customer_metadata" | "bank_account" | "demat_account" | "deposit_proof"
    id: string
  }
  label?: string
  created_at?: string | null
}

/** Attachment slots ops can pick from when uploading / replacing. */
type AttachSlot = {
  label: string
  entity: "customer_metadata" | "bank_account" | "demat_account"
  id: string
  field: string
}

/* Map of FileEntry.kind → metadata field name. Shared by detach,
 * deleteFromDisk and re-attach so the three stay in lockstep. */
const METADATA_FIELD_BY_KIND: Record<string, string> = {
  "PAN card": "kyc_pan_file_url",
  "Aadhaar card": "kyc_aadhaar_card_file_url",
  // Pre-multi-demat single-CMR slot. Surfaced for visibility but no
  // longer offered as an upload destination — new CMRs go to
  // demat_account.cmr_file_url per demat.
  "CMR copy (pre-multi-demat)": "kyc_cmr_file_url",
  "PAN card (legacy)": "pan_card_file_url",
  "Aadhaar card (legacy)": "aadhaar_card_file_url",
}

/* Return the field name that currently holds this file's URL on its
 * source entity, or null if we can't figure it out (stops re-attach /
 * detach from silently corrupting metadata). */
function fieldForFile(f: FileEntry): string | null {
  if (f.source.entity === "customer_metadata") {
    return METADATA_FIELD_BY_KIND[f.kind] ?? null
  }
  if (f.source.entity === "bank_account") return "bank_proof_file_url"
  if (f.source.entity === "demat_account") return "cmr_file_url"
  return null
}

export default function DocumentsTab({ customerId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [slots, setSlots] = useState<AttachSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Upload form. The password input lets ops upload an encrypted PDF
  // on behalf of the customer — the backend strips the password
  // server-side via qpdf, then compresses to ≤2 MB. Empty password is
  // fine for unprotected files.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [slotKey, setSlotKey] = useState<string>("")
  const [uploading, setUploading] = useState(false)
  const [pdfPassword, setPdfPassword] = useState("")
  // After a 422 pdf.password_required / pdf.bad_password we surface
  // an inline retry button so ops doesn't lose the picked file.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [passwordHint, setPasswordHint] = useState<string | null>(null)

  // Re-attach dialog
  const [reattachFile, setReattachFile] = useState<FileEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [filesRes, banks, demats] = await Promise.all([
        adminFetch<{ files: FileEntry[] }>(
          `/admin/customers/${customerId}/files`
        ),
        adminFetch<{ bank_accounts: any[] }>(
          `/admin/bank-accounts?customer_id=${customerId}`
        ).catch(() => ({ bank_accounts: [] })),
        adminFetch<{ demat_accounts: any[] }>(
          `/admin/demat-accounts?customer_id=${customerId}`
        ).catch(() => ({ demat_accounts: [] })),
      ])
      setFiles(filesRes.files ?? [])

      // Build the pickable attachment slots. We DON'T include
      // `kyc_cmr_file_url` — CMRs belong on the per-demat slot
      // (`demat_account.cmr_file_url`); offering the legacy single-
      // CMR metadata slot here would lure ops into uploading new
      // CMRs to a pre-multi-demat key. Existing data on that key is
      // still surfaced in the file list below for visibility.
      const s: AttachSlot[] = [
        {
          label: "KYC · PAN card",
          entity: "customer_metadata",
          id: customerId,
          field: "kyc_pan_file_url",
        },
        {
          label: "KYC · Aadhaar card",
          entity: "customer_metadata",
          id: customerId,
          field: "kyc_aadhaar_card_file_url",
        },
      ]
      for (const b of banks.bank_accounts ?? []) {
        s.push({
          label: `Bank · ${b.bank_name ?? "?"} · …${b.account_number_last4 ?? ""} proof`,
          entity: "bank_account",
          id: b.id,
          field: "bank_proof_file_url",
        })
      }
      for (const d of demats.demat_accounts ?? []) {
        s.push({
          label: `Demat · ${d.depository ?? "?"} · ${d.dp_name ?? "?"} CMR`,
          entity: "demat_account",
          id: d.id,
          field: "cmr_file_url",
        })
      }
      setSlots(s)
      if (!slotKey && s.length > 0) setSlotKey(serializeSlot(s[0]))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  useEffect(() => {
    load()
  }, [load])

  /** Attempt the upload + attach. On a 422 password error, hold the
   *  picked file in `pendingFile`, surface a hint, and let ops type
   *  the password and click "Unlock & upload" to retry. */
  const tryUpload = async (file: File, password: string | null) => {
    if (!slotKey) {
      alert("Select where to attach this file.")
      return
    }
    const slot = slots.find((s) => serializeSlot(s) === slotKey)
    if (!slot) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      if (password) fd.append("password", password)
      // Don't use adminFetch — FormData needs no Content-Type header.
      const upRes = await fetch("/admin/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      })
      const upBody = await upRes.json().catch(() => ({}))
      if (!upRes.ok) {
        const code = (upBody as any)?.code
        if (code === "pdf.password_required") {
          setPendingFile(file)
          setPasswordHint(
            "This PDF is password-protected. Enter the password and click Unlock & upload.",
          )
          return
        }
        if (code === "pdf.bad_password") {
          setPendingFile(file)
          setPasswordHint("Wrong password. Try again.")
          return
        }
        throw new Error((upBody as any)?.message || "Upload failed")
      }
      const url = upBody.url as string

      // Attach to the picked entity/field.
      await adminFetch(`/admin/customers/${customerId}/attach-file`, {
        method: "POST",
        body: JSON.stringify({
          url,
          target: { entity: slot.entity, id: slot.id, field: slot.field },
          reason: `Admin upload via Customer 360 → ${slot.label}${password ? " (password decrypted)" : ""}`,
        }),
      })

      if (fileInputRef.current) fileInputRef.current.value = ""
      setPdfPassword("")
      setPendingFile(null)
      setPasswordHint(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const upload = async () => {
    const file = fileInputRef.current?.files?.[0] ?? pendingFile
    if (!file) {
      alert("Pick a file to upload first.")
      return
    }
    await tryUpload(file, pdfPassword || null)
  }

  const detach = async (f: FileEntry) => {
    if (f.source.entity === "deposit_proof") {
      alert(
        "Deposit proof files can't be detached — approve/reject the proof from the Deposits tab."
      )
      return
    }
    if (!confirm(`Remove reference to this file from ${f.kind}?\n\n(The file itself stays on disk until you delete it.)`)) {
      return
    }
    const field = fieldForFile(f)
    if (!field) {
      alert("Unknown field — can't detach.")
      return
    }

    setBusy(f.url)
    try {
      const qs = new URLSearchParams({
        entity: f.source.entity,
        id: f.source.id,
        field,
      })
      await adminFetch(
        `/admin/customers/${customerId}/attach-file?${qs.toString()}`,
        { method: "DELETE" }
      )
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Detach failed")
    } finally {
      setBusy(null)
    }
  }

  const deleteFromDisk = async (f: FileEntry) => {
    if (!confirm(`Permanently delete this file from disk?\n${f.url}\n\nThis also removes any references — irreversible.`)) {
      return
    }
    setBusy(f.url)
    try {
      // Detach first (clears the reference), then delete from disk.
      const field = fieldForFile(f)
      if (field && f.source.entity !== "deposit_proof") {
        const qs = new URLSearchParams({
          entity: f.source.entity,
          id: f.source.id,
          field,
        })
        await adminFetch(
          `/admin/customers/${customerId}/attach-file?${qs.toString()}`,
          { method: "DELETE" }
        )
      }

      const delQs = new URLSearchParams({ url: f.url })
      await adminFetch(`/admin/upload?${delQs.toString()}`, {
        method: "DELETE",
      })

      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setBusy(null)
    }
  }

  /* Point an already-uploaded file at a different bank/demat/KYC slot
   * without re-uploading. We POST to the new slot (overwriting whatever
   * was there) and DELETE the reference on the old slot — the file on
   * disk is untouched. */
  const reattach = async (f: FileEntry, newSlot: AttachSlot) => {
    const oldField = fieldForFile(f)
    if (!oldField) {
      alert("Unknown current field — can't re-attach safely.")
      return
    }
    // Refuse no-ops silently — drawer handles its own messaging.
    if (
      newSlot.entity === f.source.entity &&
      newSlot.id === f.source.id &&
      newSlot.field === oldField
    ) {
      throw new Error("That's the slot this file is already attached to.")
    }
    setBusy(f.url)
    try {
      // 1) Attach to new target (overwrites newSlot.field on that entity).
      await adminFetch(`/admin/customers/${customerId}/attach-file`, {
        method: "POST",
        body: JSON.stringify({
          url: f.url,
          target: {
            entity: newSlot.entity,
            id: newSlot.id,
            field: newSlot.field,
          },
          reason: `Admin re-attach: moved from ${f.source.entity}.${oldField} → ${newSlot.entity}.${newSlot.field}`,
        }),
      })
      // 2) Clear old reference.
      const qs = new URLSearchParams({
        entity: f.source.entity,
        id: f.source.id,
        field: oldField,
      })
      await adminFetch(
        `/admin/customers/${customerId}/attach-file?${qs.toString()}`,
        { method: "DELETE" }
      )
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Text>Loading…</Text>

  const hasBankSlots = slots.some((s) => s.entity === "bank_account")
  const hasDematSlots = slots.some((s) => s.entity === "demat_account")
  const missingLabels: string[] = []
  if (!hasBankSlots) missingLabels.push("bank proofs")
  if (!hasDematSlots) missingLabels.push("demat CMR copies")

  return (
    <div className="flex flex-col gap-4">
      {/* Info banner when bank/demat accounts don't exist yet —
        * explains why the Attach dropdown doesn't show those slots. */}
      {missingLabels.length > 0 && (
        <Container className="p-4 bg-ui-bg-subtle border border-ui-border-base">
          <Text size="small" className="text-ui-fg-muted">
            <strong>Heads up:</strong> To attach {missingLabels.join(" or ")},
            first add a bank or demat account in the{" "}
            <button
              type="button"
              onClick={() => {
                const url = new URL(window.location.href)
                window.history.pushState({}, "", url.toString())
                // Signal parent tabs to switch — use a hash trick since
                // the parent owns the Tabs state.
                const tabsTrigger = document.querySelector<HTMLButtonElement>(
                  '[role="tab"][value="accounts"]'
                )
                tabsTrigger?.click()
              }}
              className="text-ui-fg-interactive underline font-medium"
            >
              Bank &amp; Demat tab
            </button>
            . Once an account exists, its proof / CMR slot will appear in the
            dropdown below.
          </Text>
        </Container>
      )}

      {/* Upload form */}
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Upload a new document
        </Heading>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label size="small">File (PDF, JPG, PNG, ≤2 MB)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="block w-full text-sm"
              onChange={() => {
                // New file picked — clear any stale password-error
                // state from a previous attempt.
                setPendingFile(null)
                setPasswordHint(null)
              }}
            />
          </div>
          <div>
            <Label size="small">PDF password (if protected)</Label>
            <Input
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              placeholder="Leave blank if unprotected"
            />
          </div>
          <div>
            <Label size="small">Attach to</Label>
            <Select value={slotKey} onValueChange={setSlotKey}>
              <Select.Trigger>
                <Select.Value placeholder="Pick a destination" />
              </Select.Trigger>
              <Select.Content>
                {slots.map((s) => (
                  <Select.Item key={serializeSlot(s)} value={serializeSlot(s)}>
                    {s.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={upload} isLoading={uploading} disabled={uploading || slots.length === 0}>
            {pendingFile ? "Unlock & upload" : "Upload & attach"}
          </Button>
          {passwordHint && (
            <Text size="small" className="text-ui-fg-error">
              {passwordHint}
            </Text>
          )}
          {!passwordHint && (
            <Text size="small" className="text-ui-fg-subtle">
              Auto-compresses to ≤2 MB; PDF passwords are stripped
              server-side via qpdf — the stored file is never encrypted.
            </Text>
          )}
        </div>
      </Container>

      {/* Existing documents */}
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Existing documents ({files.length})
        </Heading>
        {error && (
          <Text className="text-ui-fg-error mb-2">{error}</Text>
        )}
        {files.length === 0 ? (
          <Text className="text-ui-fg-muted">No files uploaded yet.</Text>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {files.map((f, i) => (
              <div
                key={`${f.url}-${i}`}
                className="flex flex-col gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
              >
                <div>
                  <Text className="font-medium truncate">{f.kind}</Text>
                  {f.label && (
                    <Text size="small" className="text-ui-fg-muted truncate">
                      {f.label}
                    </Text>
                  )}
                  <Text size="small" className="text-ui-fg-subtle">
                    {f.source.entity} · {formatDate(f.created_at)}
                  </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ui-fg-interactive underline text-sm"
                  >
                    View
                  </a>
                  {f.source.entity !== "deposit_proof" && (
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={busy === f.url}
                      onClick={() => setReattachFile(f)}
                    >
                      Re-attach
                    </Button>
                  )}
                  {f.source.entity !== "deposit_proof" && (
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={busy === f.url}
                      onClick={() => detach(f)}
                    >
                      Detach
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="danger"
                    disabled={busy === f.url || f.source.entity === "deposit_proof"}
                    onClick={() => deleteFromDisk(f)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>

      <ReattachDrawer
        file={reattachFile}
        slots={slots}
        fieldForFile={fieldForFile}
        onClose={() => setReattachFile(null)}
        onConfirm={async (slot) => {
          if (!reattachFile) return
          await reattach(reattachFile, slot)
          setReattachFile(null)
        }}
      />
    </div>
  )
}

function serializeSlot(s: AttachSlot): string {
  return `${s.entity}:${s.id}:${s.field}`
}

/* ------------------------------------------------------------------ */
/* Re-attach drawer                                                   */
/*                                                                    */
/* Lets ops move an already-uploaded file from one slot to another    */
/* without touching disk. The current slot is excluded from the       */
/* picker (selecting it would be a no-op). If the target slot already */
/* has a file, we warn before overwriting.                            */
/* ------------------------------------------------------------------ */

function ReattachDrawer({
  file,
  slots,
  fieldForFile,
  onClose,
  onConfirm,
}: {
  file: FileEntry | null
  slots: AttachSlot[]
  fieldForFile: (f: FileEntry) => string | null
  onClose: () => void
  onConfirm: (slot: AttachSlot) => Promise<void>
}) {
  const [slotKey, setSlotKey] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const currentField = file ? fieldForFile(file) : null

  // Slots that aren't the one this file is already attached to.
  const pickable = useMemo(() => {
    if (!file) return slots
    return slots.filter(
      (s) =>
        !(
          s.entity === file.source.entity &&
          s.id === file.source.id &&
          s.field === currentField
        )
    )
  }, [file, slots, currentField])

  useEffect(() => {
    // Reset selection whenever the file changes.
    if (!file) return
    setErr(null)
    setSlotKey(pickable[0] ? `${pickable[0].entity}:${pickable[0].id}:${pickable[0].field}` : "")
  }, [file?.url])

  const save = async () => {
    if (!file) return
    if (!slotKey) {
      setErr("Pick a destination.")
      return
    }
    const slot = pickable.find(
      (s) => `${s.entity}:${s.id}:${s.field}` === slotKey
    )
    if (!slot) {
      setErr("Invalid selection.")
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onConfirm(slot)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Re-attach failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={!!file} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Re-attach document</Drawer.Title>
          {file && (
            <Drawer.Description>
              {file.kind}
              {file.label ? ` · ${file.label}` : ""}
            </Drawer.Description>
          )}
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4">
          {file && (
            <>
              <div>
                <Label size="small">Currently attached to</Label>
                <Text size="small" className="text-ui-fg-muted">
                  {file.source.entity}
                  {currentField ? ` · ${currentField}` : ""}
                </Text>
              </div>
              <div>
                <Label size="small">Move to</Label>
                <Select value={slotKey} onValueChange={setSlotKey}>
                  <Select.Trigger>
                    <Select.Value placeholder="Pick a destination" />
                  </Select.Trigger>
                  <Select.Content>
                    {pickable.map((s) => (
                      <Select.Item
                        key={`${s.entity}:${s.id}:${s.field}`}
                        value={`${s.entity}:${s.id}:${s.field}`}
                      >
                        {s.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <Text size="small" className="text-ui-fg-muted">
                This overwrites the destination slot&apos;s current file
                reference (the old file on disk is not deleted). The
                reference on the current slot is cleared.
              </Text>
              {err && <Text className="text-ui-fg-error">{err}</Text>}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving || !slotKey}>
            Re-attach
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
