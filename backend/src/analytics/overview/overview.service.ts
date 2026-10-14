import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { DatabaseService } from '../../database/database.service';

export interface OverviewResponse {
  revenue: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    changePct: number | null;
  };
  orders: {
    total: number;
    completed: number;
    pending: number;
    cancelled: number;
  };
  customers: number;
  products: number;
  averageOrderValue: number;
  monthly: Array<{ month: string; revenue: number; orders: number }>;
  generatedAt: string;
}

const CACHE_MS = 30_000;

/**
 * Workspace KPIs. These are fixed, developer-written queries (Prisma ORM +
 * one parameter-free tagged template) — no AI involved. They run on the same
 * least-privilege connection as everything else.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);
  private cache: { at: number; data: OverviewResponse } | null = null;

  constructor(private readonly db: DatabaseService) {}

  async getOverview(): Promise<OverviewResponse> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return this.cache.data;
    const prisma = this.db.prisma;
    if (!prisma) {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'The analytics database is not configured.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const lastMonthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );

      const [
        completed,
        thisMonth,
        lastMonth,
        byStatus,
        customers,
        products,
        monthly,
      ] = await Promise.all([
        prisma.order.aggregate({
          where: { status: 'completed' },
          _sum: { amount: true },
          _avg: { amount: true },
        }),
        prisma.order.aggregate({
          where: { status: 'completed', createdAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        prisma.order.aggregate({
          where: {
            status: 'completed',
            createdAt: { gte: lastMonthStart, lt: monthStart },
          },
          _sum: { amount: true },
        }),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.user.count(),
        prisma.product.count(),
        prisma.$queryRaw<
          Array<{ month: Date; revenue: number; orders: number }>
        >`
          SELECT date_trunc('month', created_at) AS month,
                 COALESCE(SUM(amount), 0)::float8 AS revenue,
                 COUNT(*)::int AS orders
          FROM orders
          WHERE status = 'completed'
            AND created_at >= date_trunc('month', now()) - interval '5 months'
          GROUP BY 1
          ORDER BY 1`,
      ]);

      const count = (s: string) =>
        byStatus.find((g) => g.status === s)?._count._all ?? 0;
      const thisM = num(thisMonth._sum.amount);
      const lastM = num(lastMonth._sum.amount);

      const data: OverviewResponse = {
        revenue: {
          total: num(completed._sum.amount),
          thisMonth: thisM,
          lastMonth: lastM,
          changePct:
            lastM > 0
              ? Math.round(((thisM - lastM) / lastM) * 1000) / 10
              : null,
        },
        orders: {
          total: byStatus.reduce((s, g) => s + g._count._all, 0),
          completed: count('completed'),
          pending: count('pending'),
          cancelled: count('cancelled'),
        },
        customers,
        products,
        averageOrderValue: Math.round(num(completed._avg.amount) * 100) / 100,
        monthly: monthly.map((m) => ({
          month: new Date(m.month).toISOString(),
          revenue: Math.round(Number(m.revenue) * 100) / 100,
          orders: Number(m.orders),
        })),
        generatedAt: now.toISOString(),
      };
      this.cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      const reason =
        err instanceof Error ? err.message.split('\n').pop() : 'unknown';
      this.logger.warn(`Overview query failed: ${reason}`);
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'Workspace metrics are unavailable — check the database connection and migrations.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function num(v: { toNumber(): number } | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : v.toNumber();
}
