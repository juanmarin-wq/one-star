import { randomBytes } from "crypto"
import { PrismaClient, AdminRole } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

/**
 * Crea o actualiza el usuario administrador.
 *
 * Credenciales vía variables de entorno (nunca hardcodeadas):
 *   ADMIN_EMAIL    — requerido
 *   ADMIN_PASSWORD — opcional; si falta se genera una aleatoria y se muestra una vez
 *   ADMIN_NAME     — opcional (default: "Admin One Star")
 *   ADMIN_ROLE     — opcional: "SUPER_ADMIN" (default) | "INVENTORY_OPERATOR"
 */
async function main() {
  const email = process.env.ADMIN_EMAIL
  if (!email) {
    console.error("ADMIN_EMAIL es requerida. Uso: ADMIN_EMAIL=tu@correo.com npx tsx scripts/create-admin.ts")
    process.exitCode = 1
    return
  }

  const roleInput = process.env.ADMIN_ROLE?.trim().toUpperCase() || undefined
  if (roleInput && roleInput !== "SUPER_ADMIN" && roleInput !== "INVENTORY_OPERATOR") {
    console.error('ADMIN_ROLE debe ser "SUPER_ADMIN" o "INVENTORY_OPERATOR".')
    process.exitCode = 1
    return
  }

  const generatedPassword = !process.env.ADMIN_PASSWORD
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url")
  const name = process.env.ADMIN_NAME ?? "Admin One Star"
  const passwordHash = bcrypt.hashSync(password, 10)

  // Sin ADMIN_ROLE explícito: si ya existe, se conserva su rol actual (nunca
  // se degrada/asciende un admin existente por accidente al re-ejecutar el
  // script); si es nuevo, nace SUPER_ADMIN.
  const existing = await prisma.adminUser.findUnique({ where: { email } })
  const role = (roleInput as AdminRole | undefined) ?? existing?.role ?? "SUPER_ADMIN"

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, name, role },
    create: { email, passwordHash, name, role },
  })

  if (existing && existing.role !== admin.role) {
    // El rol viaja copiado en la sesión: sin esto un admin degradado seguiría
    // con sus permisos anteriores hasta que expire su sesión.
    const { count } = await prisma.authSession.deleteMany({ where: { user: { email } } })
    console.log(`Rol cambiado: se cerraron ${count} sesión(es) activa(s) de ${email}.`)
  }

  console.log("Admin creado/actualizado:")
  console.log(`Email: ${admin.email}`)
  console.log(`Rol: ${admin.role}`)
  if (generatedPassword) {
    console.log(`Password generada (guárdala ahora, no se volverá a mostrar): ${password}`)
  } else {
    console.log("Password: la definida en ADMIN_PASSWORD")
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
