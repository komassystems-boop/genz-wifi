import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireOwner } from "../security";

const router = Router();
router.get("/", async (_req, res) => {
  const packages = await prisma.package.findMany({ where: { active: true }, orderBy: { durationMinutes: "asc" } });
  res.json(packages);
});
router.patch("/:id", requireOwner, async (req, res) => {
  const parsed = z.object({ priceKes: z.number().int().positive().optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid package update." });
  const updated = await prisma.package.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(updated);
});
export default router;
