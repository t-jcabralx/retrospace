// A stand-in for next/navigation in server-rendered component tests: always at "/", and the router does nothing.
export const usePathname = () => '/'
export const useSearchParams = () => new URLSearchParams()
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} })
