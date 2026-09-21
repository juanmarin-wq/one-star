-- AlterTable
ALTER TABLE "ba_users" ADD COLUMN     "adminRole" TEXT;

-- Backfill: copia el rol real desde AdminUser para que las sesiones de admin
-- ya activas queden correctas sin esperar al próximo login.
UPDATE "ba_users" u
SET "adminRole" = a."role"::text
FROM "AdminUser" a
WHERE u.email = a.email AND u."userType" = 'admin';
