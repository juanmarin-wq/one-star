-- Repite el respaldo de rol comparando correos sin distinguir mayúsculas ni
-- espacios: la primera migración usaba igualdad exacta y podía dejar sin rol
-- (tratado como SUPER_ADMIN) a un operador cuyo correo difería solo en formato.
UPDATE "ba_users" AS u
SET "adminRole" = a."role"::text
FROM "AdminUser" AS a
WHERE u."userType" = 'admin'
  AND LOWER(TRIM(u."email")) = LOWER(TRIM(a."email"))
  AND u."adminRole" IS DISTINCT FROM a."role"::text;
