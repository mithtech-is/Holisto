// Global type augmentation.
//
// The copied admin UI pages use `<Table.Cell colSpan={n}>` (valid HTML),
// but @medusajs/ui@4.0.4 types Table.Cell props as React.HTMLAttributes
// (which omits the table-cell-specific colSpan/rowSpan). Rather than
// sprinkle @ts-nocheck across every page, we widen React.HTMLAttributes
// here so colSpan/rowSpan type-check everywhere. Runtime is unaffected
// (swc strips types; the DOM accepts these attributes).
//
// TODO: remove once the plugin's @medusajs/ui is bumped to a version that
// types Table.Cell with TdHTMLAttributes.
import "react"

declare module "react" {
  interface HTMLAttributes<T> {
    colSpan?: number
    rowSpan?: number
  }
}

export {}
