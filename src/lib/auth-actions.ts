"use server"

import { isIP } from "node:net"
import { compareSync } from "bcryptjs"
import { headers } from "next/headers"
import { prisma } from "@/server/db/prisma"
import {
  consumeAdminLoginAttempt,
  resetAdminLoginAttempts,
} from "@/server/services/admin-login-rate-limit.service"
import { alertAdminLoginWithoutTrustedIp } from "@/server/services/admin-login-security-alert.service"

export type AuthActionResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Validates admin credentials against the AdminUser table, then upserts the
 * corresponding better-auth records so the BA sign-in endpoint can create a
 * session with the existing bcrypt hash.
 */
export async function prepareAdminSignIn(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const headerList = await headers()
  // Production ingress must overwrite X-Real-IP. X-Forwarded-For is ignored
  // because its leftmost entries can be supplied directly by the client.
  const rawTrustedIp = headerList.get("x-real-ip")
  const trustedIp = rawTrustedIp?.trim()
  const ip = trustedIp && isIP(trustedIp) ? trustedIp : "unknown"

  if (ip === "unknown") {
    const reason = !trustedIp ? "missing" : "invalid"
    alertAdminLoginWithoutTrustedIp(reason)
  }

  const attempt = consumeAdminLoginAttempt(ip, email)
  if (!attempt.allowed) {
    return {
      success: false,
      error: "Demasiados intentos. Intenta de nuevo en 15 minutos.",
    }
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } })
  if (!admin || !compareSync(password, admin.passwordHash)) {
    return { success: false, error: "Credenciales incorrectas." }
  }

  await upsertAuthRecords({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    passwordHash: admin.passwordHash,
    userType: "admin",
    adminRole: admin.role,
  })

  resetAdminLoginAttempts(ip, email)

  return { success: true }
}

/**
 * Validates customer credentials against the User table, then upserts the
 * corresponding better-auth records so the BA sign-in endpoint can create a
 * session with the existing bcrypt hash.
 */
export async function prepareCustomerSignIn(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !compareSync(password, user.passwordHash)) {
    return { success: false, error: "Email o contraseña incorrectos." }
  }

  await upsertAuthRecords({
    id: user.id,
    email: user.email,
    name: user.name ?? user.email.split("@")[0],
    passwordHash: user.passwordHash,
    userType: "customer",
  })

  return { success: true }
}

type AuthRecordInput = {
  id: string
  email: string
  name: string
  passwordHash: string
  userType: "admin" | "customer"
  /** Solo para userType "admin" — copia de AdminUser.role. */
  adminRole?: string
}

async function upsertAuthRecords({
  id,
  email,
  name,
  passwordHash,
  userType,
  adminRole,
}: AuthRecordInput): Promise<void> {
  const now = new Date()

  // 1. Upsert the better-auth user record
  const authUser = await prisma.authUser.upsert({
    where: { email },
    create: {
      id,
      email,
      name,
      emailVerified: true,
      userType,
      adminRole: adminRole ?? null,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      name,
      userType,
      adminRole: adminRole ?? null,
      updatedAt: now,
    },
  })

  // 2. Upsert the credential account (stores the bcrypt hash BA will verify)
  const existingAccount = await prisma.authAccount.findFirst({
    where: { userId: authUser.id, providerId: "credential" },
  })

  if (!existingAccount) {
    await prisma.authAccount.create({
      data: {
        id: crypto.randomUUID(),
        accountId: email,
        providerId: "credential",
        userId: authUser.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    })
  } else if (existingAccount.password !== passwordHash) {
    // Keep in sync if the password was changed outside BA
    await prisma.authAccount.update({
      where: { id: existingAccount.id },
      data: { password: passwordHash, updatedAt: now },
    })
  }
}
