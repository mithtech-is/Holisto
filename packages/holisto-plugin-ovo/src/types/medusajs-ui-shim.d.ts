import type React from "react"

type AnyComponent = React.FC<any>
type CompoundComponent = AnyComponent & Record<string, AnyComponent>

export declare const Badge: AnyComponent
export declare const Button: AnyComponent
export declare const Container: AnyComponent
export declare const Drawer: CompoundComponent
export declare const Heading: AnyComponent
export declare const Input: AnyComponent
export declare const Label: AnyComponent
export declare const Select: CompoundComponent
export declare const Switch: AnyComponent
export declare const Tabs: CompoundComponent
export declare const Text: AnyComponent
export declare const Textarea: AnyComponent
export declare const Tooltip: CompoundComponent

export declare const toast: {
  success: (message: string, options?: any) => void
  error: (message: string, options?: any) => void
  warning: (message: string, options?: any) => void
  info: (message: string, options?: any) => void
}
