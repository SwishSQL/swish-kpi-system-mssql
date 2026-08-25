/**
 * Idempotent seed: safe to run on every deploy.
 * - Ensures the permission catalogue exists
 * - Ensures each role has its default permissions (only when the role has none,
 *   so admin edits made in the UI are never overwritten)
 * - Creates the initial admin user when no admin exists
 * - Opens the current submission month when missing
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, SystemRole } from '../src/lib/permissions';

// The Prisma CLI and Next.js load .env themselves, but running this file
// directly (`npx tsx prisma/seed.ts`) does not - read it here so the seed
// works standalone without depending on the dotenv package or Node version.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

const db = new PrismaClient();

async function main() {
  // 1) Permission catalogue
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { name: p.name, description: p.description },
    });
  }
  const allPerms = await db.permission.findMany();
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  // 2) Role defaults.
  //
  // Defaults are applied once per permission code, never re-applied: an admin
  // who removes a permission in the UI must not have it handed back on the next
  // deploy. Codes introduced by a later release still get their defaults, which
  // is why the seeded set is remembered rather than inferred from row counts.
  const SEEDED_KEY = 'seeded_permission_codes';
  const seededRow = await db.systemSetting.findUnique({ where: { key: SEEDED_KEY } });
  const alreadySeeded = new Set<string>(seededRow ? JSON.parse(seededRow.value) : []);

  // A database seeded before this bookkeeping existed has no record of what was
  // applied. Treat a code as already handled only if some role actually holds
  // it; a code nobody holds is either new in this release or revoked everywhere,
  // and granting its defaults once is the safer of the two mistakes.
  if (!seededRow) {
    const held = await db.rolePermission.findMany({
      select: { permission: { select: { code: true } } },
      distinct: ['permissionId'],
    });
    for (const h of held) alreadySeeded.add(h.permission.code);
  }

  const newCodes = PERMISSIONS.map((p) => p.code).filter((c) => !alreadySeeded.has(c));
  if (newCodes.length > 0) {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as SystemRole[]) {
      const grant = DEFAULT_ROLE_PERMISSIONS[role].filter((c) => newCodes.includes(c));
      if (grant.length === 0) continue;
      // SQL Server's createMany cannot skip duplicates - check per row.
      for (const c of grant) {
        const permissionId = permByCode.get(c);
        if (!permissionId) continue;
        const exists = await db.rolePermission.findUnique({
          where: { role_permissionId: { role, permissionId } },
        });
        if (!exists) await db.rolePermission.create({ data: { role, permissionId } });
      }
      console.log(`Granted ${grant.length} new permission(s) to ${role}: ${grant.join(', ')}`);
    }
  }

  await db.systemSetting.upsert({
    where: { key: SEEDED_KEY },
    create: { key: SEEDED_KEY, value: JSON.stringify(PERMISSIONS.map((p) => p.code)) },
    update: { value: JSON.stringify(PERMISSIONS.map((p) => p.code)) },
  });

  // 3) Initial admin
  const adminCount = await db.user.count({
    where: { systemRole: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true },
  });
  if (adminCount === 0) {
    const employeeId = process.env.INITIAL_ADMIN_EMPLOYEE_ID || 'ADMIN-001';
    const email = (process.env.INITIAL_ADMIN_EMAIL || 'admin@swish.local').toLowerCase().trim();
    const fullName = process.env.INITIAL_ADMIN_NAME || 'System Administrator';
    const password = process.env.INITIAL_ADMIN_PASSWORD || employeeId;
    const user = await db.user.create({
      data: {
        employeeId,
        fullName,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        systemRole: 'SUPER_ADMIN',
        mustChangePassword: true,
      },
    });
    await db.employeeProfile.create({
      data: { userId: user.id, employeeId, fullName, position: 'System Administrator' },
    });
    console.log(`Created initial admin ${email} (temporary password = ${process.env.INITIAL_ADMIN_PASSWORD ? 'INITIAL_ADMIN_PASSWORD' : 'the Employee ID'})`);
  }

  // 4) Current month period
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  await db.submissionPeriod.upsert({
    where: { year_month: { year, month } },
    create: { year, month, status: 'OPEN', opensAt: now },
    update: {},
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
