import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireOwner } from "../security";

const router = Router();

// Owner: view all packages, including inactive ones, for dashboard management.
router.get("/manage", requireOwner, async (_req, res) => {
  const packages = await prisma.package.findMany({
    orderBy: { durationMinutes: "asc" },
  });

  res.json(packages);
});

// Public: customers can see active packages only.
router.get("/", async (_req, res) => {
  const packages = await prisma.package.findMany({
    where: { active: true },
    orderBy: { durationMinutes: "asc" },
  });

  res.json(packages);
});

// Owner: create a package.
router.post("/", requireOwner, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(60),
      durationMinutes: z.number().int().positive(),
      priceKes: z.number().int().positive(),
      active: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid package details." });
  }

  try {
    const created = await prisma.package.create({
      data: {
        ...parsed.data,
        active: parsed.data.active ?? true,
      },
    });

    return res.status(201).json(created);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "A package with that name already exists.",
      });
    }

    return res.status(500).json({ error: "Could not create package." });
  }
});

// Owner: edit package name, duration, price or active status.
router.patch("/:id", requireOwner, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(60).optional(),
      durationMinutes: z.number().int().positive().optional(),
      priceKes: z.number().int().positive().optional(),
      active: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "Provide at least one field to update.",
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid package update." });
  }

  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id) {
    return res.status(400).json({ error: "Invalid package ID." });
  }

  try {
    const updated = await prisma.package.update({
      where: { id },
      data: parsed.data,
    });

    return res.json(updated);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "A package with that name already exists.",
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ error: "Package not found." });
    }

    return res.status(500).json({ error: "Could not update package." });
  }
});

export default router;
