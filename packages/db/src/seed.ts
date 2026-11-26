import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { ROLE_PERMISSIONS } from '@ddinvoice/contracts';

/** argon2id; the server's login verifies with the same format. */
export function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id });
}

type AT = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
const COA: [string, string, string, AT, boolean?][] = [
  ['1000', 'Cash', 'نقد', 'ASSET'], ['1100', 'Bank', 'البنك', 'ASSET'], ['1200', 'Accounts Receivable', 'الذمم المدينة', 'ASSET', true],
  ['1300', 'VAT Input', 'ضريبة المدخلات', 'ASSET'], ['1310', 'VAT RC Input', 'ضريبة المدخلات - الاحتساب العكسي', 'ASSET'],
  ['1400', 'Inventory', 'المخزون', 'ASSET'], ['1450', 'GRNI', 'بضاعة مستلمة غير مفوترة', 'LIABILITY'],
  ['2000', 'Accounts Payable', 'الذمم الدائنة', 'LIABILITY', true], ['2100', 'VAT Output', 'ضريبة المخرجات', 'LIABILITY'],
  ['2110', 'VAT RC Output', 'ضريبة المخرجات - الاحتساب العكسي', 'LIABILITY'], ['2200', 'Salaries Payable', 'رواتب مستحقة', 'LIABILITY'],
  ['3000', 'Capital', 'رأس المال', 'EQUITY'], ['3100', 'Retained Earnings', 'الأرباح المحتجزة', 'EQUITY'],
  ['4000', 'Sales', 'المبيعات', 'INCOME'], ['4100', 'Services', 'الخدمات', 'INCOME'], ['5000', 'Cost of Goods Sold', 'تكلفة البضاعة المباعة', 'EXPENSE'],
  ['6000', 'Salaries', 'الرواتب', 'EXPENSE'], ['6100', 'Rent', 'الإيجار', 'EXPENSE'], ['6200', 'Utilities', 'المرافق', 'EXPENSE'],
  ['6300', 'Marketing', 'التسويق', 'EXPENSE'], ['6400', 'Office Supplies', 'مستلزمات المكتب', 'EXPENSE'], ['6500', 'Professional Fees', 'أتعاب مهنية', 'EXPENSE'],
  ['6600', 'Travel', 'السفر', 'EXPENSE'], ['6700', 'Insurance', 'التأمين', 'EXPENSE'], ['6800', 'Bank Charges', 'رسوم بنكية', 'EXPENSE'],
  ['6900', 'Miscellaneous', 'مصروفات متنوعة', 'EXPENSE'],
];

export async function seedDemo(
  prisma: PrismaClient,
  adminPassword = randomBytes(12).toString('base64url'),
  opts: { trn?: string } = {},
) {
  const company = await prisma.company.create({
    data: {
      legalNameEn: 'Demo Trading LLC', legalNameAr: 'ديمو للتجارة ذ.م.م', trn: opts.trn ?? '100000000000003', tradeLicenseNo: 'DEMO-0001',
      emirate: 'DUBAI', addressEn: 'Demo Street, Dubai, UAE', addressAr: 'شارع ديمو، دبي، الإمارات',
    },
  });
  const companyId = company.id;
  await prisma.branch.create({
    data: { companyId, code: 'HQ', nameEn: 'Head Office', nameAr: 'المكتب الرئيسي', address: 'Demo Street, Dubai', emirate: 'DUBAI' },
  });

  const acc: Record<string, string> = {};
  for (const [code, nameEn, nameAr, type, isControl] of COA) {
    const a = await prisma.account.create({ data: { companyId, code, nameEn, nameAr, type, isControl: !!isControl } });
    acc[code] = a.id;
  }
  const from = new Date('2018-01-01');
  const tax = (code: string, rate: string, labelEn: string, labelAr: string, out: string, inp?: string) =>
    prisma.taxCode.create({
      data: { companyId, code, rate, labelEn, labelAr, outputAccountId: acc[out]!, inputAccountId: inp ? acc[inp] : null, effectiveFrom: from },
    });
  await tax('SR', '0.05', 'Standard Rate 5%', 'نسبة قياسية 5٪', '2100', '1300');
  await tax('ZR', '0', 'Zero Rated', 'صفرية', '2100', '1300');
  await tax('EX', '0', 'Exempt', 'معفاة', '2100');
  await tax('RC', '0.05', 'Reverse Charge', 'الاحتساب العكسي', '2110', '1310');
  await tax('OOS', '0', 'Out of Scope', 'خارج النطاق', '2100');

  const year = new Date().getUTCFullYear();
  for (const docType of ['INV', 'CN', 'RCT', 'JV', 'QT']) {
    await prisma.numberSequence.create({ data: { companyId, docType, pattern: `${docType}-{YYYY}-{SEQ:5}`, year } });
  }
  await prisma.syncState.create({ data: { companyId } });

  const roles: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    roles[name] = (await prisma.role.create({ data: { companyId, name, permissions } })).id;
  }
  const admin = await prisma.user.create({
    data: { companyId, email: 'admin@demo.local', nameEn: 'Demo Admin', passwordHash: await hashPassword(adminPassword) },
  });
  await prisma.userRole.create({ data: { companyId, userId: admin.id, roleId: roles.owner! } });
  return { companyId, adminEmail: admin.email, adminPassword };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedDemo(prisma)
    .then((r) => console.log(`Seeded Demo Trading LLC. Admin: ${r.adminEmail} / ${r.adminPassword} (shown once)`))
    .finally(() => prisma.$disconnect());
}
