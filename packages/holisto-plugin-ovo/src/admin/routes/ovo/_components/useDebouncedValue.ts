import { useEffect, useState } from "react"

/**
 * Debounced state for filter inputs — exposes the consumer effect
 * value at most once per `delay` ms regardless of how fast the user
 * types.
 *
 * Usage in a tab:
 *
 *   const [search, setSearch] = useState("")
 *   const debouncedSearch = useDebouncedValue(search, 300)
 *
 *   useEffect(() => { refresh() }, [debouncedSearch])
 *
 *   <Input value={search} onChange={e => setSearch(e.target.value)} />
 *
 * Without this, fast typing on filter inputs trips the admin
 * rate-limiter (120 req / 60s) by firing the refresh effect on
 * every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState<T>(value)
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(id)
    }, [value, delay])
    return debounced
}
