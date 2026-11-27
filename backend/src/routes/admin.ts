import { Router } from "express";
import { prisma } from "../db";
import { requireOwner } from "../security";

const router = Router();

// Owner-only dashboard overview. Never expose this endpoint publicly.
router.get("/overview", requireOwner, async (_req, res) => {
  try {
    const [packageCount, activePackageCount, paymentCounts, paidPayments, voucherCount, recentPayments] =
      await Promise.all([
        prisma.package.count(),
        prisma.package.count({ where: { active: true } }),
        prisma.payment.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        prisma.payment.aggregate({
          where: { status: "PAID" },
          _sum: { amountKes: true },
          _count: { _all: true },
        }),
        prisma.voucher.count(),
        prisma.payment.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            phone: true,
            amountKes: true,
            status: true,
            mpesaReceiptNumber: true,
            resultDescription: true,
            createdAt: true,
            package: { select: { name: true } },
            voucher: {
              select: {
                code: true,
                status: true,
                expiresAt: true,
              },
            },
          },
        }),
      ]);

    const paymentStatusCounts = {
      PENDING: 0,
      PAID: 0,
      FAILED: 0,
    };

    for (const item of paymentCounts) {
      paymentStatusCounts[item.status] = item._count._all;
    }

    return res.json({
      packages: {
        total: packageCount,
        active: activePackageCount,
      },
      payments: {
        ...paymentStatusCounts,
        total: paymentStatusCounts.PENDING + paymentStatusCounts.PAID + paymentStatusCounts.FAILED,
        paidAmountKes: paidPayments._sum.amountKes ?? 0,
      },
      vouchers: {
        total: voucherCount,
      },
      recentPayments,
    });
  } catch (error) {
    console.error("Owner overview error:", error);
    return res.status(500).json({ error: "Could not load owner dashboard." });
  }
});

export default router;
