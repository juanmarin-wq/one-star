import { auth } from "@/lib/auth"
import { buildContentSecurityPolicy } from "@/lib/content-security-policy"
import { canAccessAdminPath, normalizeAdminRole } from "@/lib/admin-access"
import { NextResponse, type NextRequest } from "next/server"

interface CspContext {
  policy: string
  requestHeaders: Headers
}

function createCspContext(request: NextRequest): CspContext {
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    allowSameOriginFraming:
      request.nextUrl.pathname === "/" &&
      request.nextUrl.searchParams.get("preview") === "true",
  })
  const requestHeaders = new Headers(request.headers)

  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", policy)

  return { policy, requestHeaders }
}

function nextWithCsp({ policy, requestHeaders }: CspContext): NextResponse {
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("content-security-policy", policy)
  return response
}

function redirectWithCsp(url: URL, { policy }: CspContext): NextResponse {
  const response = NextResponse.redirect(url)
  response.headers.set("content-security-policy", policy)
  return response
}

export async function proxy(request: NextRequest) {
  const { nextUrl } = request
  const csp = createCspContext(request)

  const isAdminRoute =
    nextUrl.pathname === "/admin" || nextUrl.pathname.startsWith("/admin/")
  const isAdminLoginPage = nextUrl.pathname === "/admin/login"
  const isCuentaRoute =
    nextUrl.pathname === "/cuenta" || nextUrl.pathname.startsWith("/cuenta/")

  if (!isAdminRoute && !isCuentaRoute) {
    return nextWithCsp(csp)
  }

  // Skip session check on the login pages themselves to avoid redirect loops
  if (isAdminLoginPage || nextUrl.pathname === "/login") {
    return nextWithCsp(csp)
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    // If session check fails (e.g. misconfigured auth), treat as unauthenticated
  }
  const userType = (session?.user as { userType?: string } | undefined)?.userType

  if (isAdminRoute && !isAdminLoginPage) {
    if (!session || userType !== "admin") {
      const loginUrl = new URL("/admin/login", nextUrl.origin)
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname)
      return redirectWithCsp(loginUrl, csp)
    }
    // Los roles limitados solo entran a su lista blanca: ocultar el menú no
    // basta, la URL escrita a mano se corta aquí (cubre también páginas nuevas).
    const adminRole = normalizeAdminRole(
      (session?.user as { adminRole?: string | null } | undefined)?.adminRole
    )
    if (!canAccessAdminPath(adminRole, nextUrl.pathname)) {
      return redirectWithCsp(new URL("/admin", nextUrl.origin), csp)
    }
  }

  if (isCuentaRoute) {
    if (!session || userType !== "customer") {
      const loginUrl = new URL("/login", nextUrl.origin)
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname)
      return redirectWithCsp(loginUrl, csp)
    }
  }

  return nextWithCsp(csp)
}

export const config = {
  matcher: ["/((?!_next/static(?:/|$)|_next/image(?:/|$)).*)"],
}
