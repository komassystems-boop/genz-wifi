import { Router } from "express";
import { prisma } from "../db";
import { requireOwner } from "../security";

const router = Router();
router.get("/", requireOwner, async (_req, res) => {
  const vouchers = await prisma.voucher.findMany({ include: { payment: { select: { phone: true, amountKes: true, status: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json(vouchers);
});
export default router;
