/**
 * Seed realistic analytics data (12 customers, 8 products, 48 orders).
 *
 *   npx prisma db seed      (or: npm run db:seed)
 *
 * Runs with the OWNER connection (SUPABASE_DIRECT_URL). Order dates are
 * relative to "now" (spread across the last 6 months, growing month over
 * month) so questions like "completed orders from this month" always return
 * data. A seeded PRNG keeps the dataset identical between runs within a month.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { buildPoolConfig, SslMode } from '../src/database/pg-connection';

export const CUSTOMERS = [
  { name: 'Olivia Bennett', email: 'olivia.bennett@northwind.io', country: 'United States' },
  { name: 'Liam Carter', email: 'liam.carter@acmeretail.com', country: 'United States' },
  { name: 'Sophia Nguyen', email: 'sophia.nguyen@brightlabs.co', country: 'United States' },
  { name: 'Lukas Schneider', email: 'lukas.schneider@techwerk.de', country: 'Germany' },
  { name: 'Hannah Müller', email: 'hannah.mueller@datenhaus.de', country: 'Germany' },
  { name: 'Oliver Hughes', email: 'oliver.hughes@thamesgroup.co.uk', country: 'United Kingdom' },
  { name: 'Amelia Clarke', email: 'amelia.clarke@cityanalytics.co.uk', country: 'United Kingdom' },
  { name: 'Haruto Tanaka', email: 'haruto.tanaka@sakura-digital.jp', country: 'Japan' },
  { name: 'Emma Tremblay', email: 'emma.tremblay@maplecloud.ca', country: 'Canada' },
  { name: 'Louis Martin', email: 'louis.martin@lumiere-data.fr', country: 'France' },
  { name: 'Aarav Sharma', email: 'aarav.sharma@indusinsights.in', country: 'India' },
  { name: 'Chloe Wilson', email: 'chloe.wilson@harbourbi.com.au', country: 'Australia' },
];

export const PRODUCTS = [
  { title: 'Pulse Analytics Pro', category: 'Software', price: '499.00' },
  { title: 'Pulse Analytics Starter', category: 'Software', price: '149.00' },
  { title: 'Data Warehouse Connector', category: 'Software', price: '299.00' },
  { title: 'Edge Sensor Kit', category: 'Hardware', price: '899.00' },
  { title: 'Smart Display Hub', category: 'Hardware', price: '349.00' },
  { title: 'Implementation Package', category: 'Services', price: '2500.00' },
  { title: 'Premium Support Plan', category: 'Services', price: '1200.00' },
  { title: 'BI Certification Course', category: 'Training', price: '399.00' },
];

/** Orders per month, oldest (5 months ago) → current month. Sums to 48. */
const ORDERS_PER_MONTH = [5, 6, 7, 8, 10, 12];

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOrder {
  customerIndex: number;
  productIndex: number;
  amount: string;
  status: 'completed' | 'pending' | 'cancelled';
  createdAt: Date;
}

export function buildOrders(now = new Date()): SeedOrder[] {
  const rand = prng(20261014);
  const pick = <T>(weights: Array<[T, number]>): T => {
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of weights) {
      if ((r -= w) < 0) return v;
    }
    return weights[weights.length - 1][0];
  };

  // Some customers and products sell more — makes rankings meaningful.
  const customerWeights = CUSTOMERS.map((_, i) => [i, [6, 3, 4, 5, 2, 4, 2, 3, 2, 2, 3, 1][i]] as [number, number]);
  const productWeights = PRODUCTS.map((_, i) => [i, [7, 6, 4, 3, 4, 2, 3, 4][i]] as [number, number]);

  const orders: SeedOrder[] = [];
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  ORDERS_PER_MONTH.forEach((count, i) => {
    const monthsAgo = ORDERS_PER_MONTH.length - 1 - i;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const end =
      monthsAgo === 0
        ? now
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));

    for (let k = 0; k < count; k++) {
      const customerIndex = pick(customerWeights);
      const productIndex = pick(productWeights);
      const price = Number(PRODUCTS[productIndex].price);
      const quantity = PRODUCTS[productIndex].category === 'Services' ? 1 : pick([[1, 6], [2, 3], [3, 1]]);
      const discount = pick([[0, 6], [0.1, 3], [0.15, 1]]);
      const amount = (price * quantity * (1 - discount)).toFixed(2);

      // Recent orders are more often still pending.
      const status =
        monthsAgo === 0
          ? pick<SeedOrder['status']>([['completed', 6], ['pending', 4], ['cancelled', 1]])
          : pick<SeedOrder['status']>([['completed', 8], ['pending', 1], ['cancelled', 1]]);

      const span = end.getTime() - start.getTime();
      let createdAt = new Date(start.getTime() + Math.floor(((k + rand()) / count) * span));
      if (createdAt > now) createdAt = new Date(now.getTime() - 60_000);
      if (monthsAgo === 0 && createdAt < monthStart) createdAt = new Date(monthStart.getTime() + 60_000);

      orders.push({ customerIndex, productIndex, amount, status, createdAt });
    }
  });

  // Every product (and so every category) gets at least one completed order,
  // so category comparisons are meaningful. Reassign from the best seller.
  for (let p = 0; p < PRODUCTS.length; p++) {
    if (orders.some((o) => o.productIndex === p && o.status === 'completed')) continue;
    const counts = PRODUCTS.map((_, i) => orders.filter((o) => o.productIndex === i && o.status === 'completed').length);
    const donorProduct = counts.indexOf(Math.max(...counts));
    const donor = orders.find((o) => o.productIndex === donorProduct && o.status === 'completed');
    if (!donor) continue;
    donor.productIndex = p;
    donor.amount = Number(PRODUCTS[p].price).toFixed(2);
  }

  // Guarantee every requirement-driven question has data this month.
  const current = orders.filter((o) => o.createdAt >= monthStart);
  if (!current.some((o) => o.status === 'completed') && current[0]) current[0].status = 'completed';
  return orders;
}

async function main() {
  const url = process.env.SUPABASE_DIRECT_URL;
  if (!url) throw new Error('SUPABASE_DIRECT_URL is not set.');

  const adapter = new PrismaPg(
    buildPoolConfig(url, (process.env.DATABASE_SSL as SslMode) ?? 'require', process.env.DATABASE_CA_CERT),
  );
  const prisma = new PrismaClient({ adapter });
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('TRUNCATE TABLE "orders", "products", "users" RESTART IDENTITY CASCADE');

      const users = await Promise.all(
        CUSTOMERS.map((c, i) =>
          tx.user.create({
            data: { ...c, createdAt: new Date(now.getTime() - (210 - i * 9) * 86_400_000) },
          }),
        ),
      );
      const products = await Promise.all(PRODUCTS.map((p) => tx.product.create({ data: p })));

      const orders = buildOrders(now);
      await tx.order.createMany({
        data: orders.map((o) => ({
          userId: users[o.customerIndex].id,
          productId: products[o.productIndex].id,
          amount: o.amount,
          status: o.status,
          createdAt: o.createdAt,
        })),
      });
    });

    const [users, products, orders] = await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.order.count(),
    ]);
    console.log(`✔ Seeded ${users} customers, ${products} products and ${orders} orders.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('✖ Seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
