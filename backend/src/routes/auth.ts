import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken } from "../security";

const router = Router();

const OWNER_EMAIL = "komassystems@gmail.com";

// One-time secure owner account setup
router.post("/setup-owner", async (req, res) => {
  try {
    const setupSecret = process.env.OWNER_SETUP_SECRET;
    const suppliedSecret = req.headers["x-owner-setup-secret"];

    if (
      !setupSecret ||
      typeof suppliedSecret !== "string" ||
      suppliedSecret !== setupSecret
    ) {
      return res.status(401).json({
        error: "Unauthorized setup request.",
      });
    }

    const ownerCount = await prisma.adminUser.count({
      where: { role: "OWNER" },
    });

    if (ownerCount > 0) {
      return res.status(403).json({
        error: "Owner account already exists.",
      });
    }

    const parsed = z.object({
      password: z.string().min(12).max(128),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Password must be at least 12 characters.",
      });
    }

    const existingUser = await prisma.adminUser.findUnique({
      where: { email: OWNER_EMAIL },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Owner email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(
      parsed.data.password,
      12
    );

    const user = await prisma.adminUser.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash,
        role: "OWNER",
      },
    });

    return res.status(201).json({
      message: "GENZ WIFI owner account created successfully.",
      email: user.email,
    });
  } catch (error) {
    console.error("Owner setup error:", error);

    return res.status(500).json({
      error: "Owner account setup failed.",
    });
  }
});

// Owner and staff login
router.post("/login", async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Enter a valid email and password.",
    });
  }

  try {
    const user = await prisma.adminUser.findUnique({
      where: {
        email: parsed.data.email.toLowerCase(),
      },
    });

    if (
      !user ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        error: "Incorrect email or password.",
      });
    }

    return res.json({
      token: signToken({
        id: user.id,
        email: user.email,
        role: user.role,
      }),
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      error: "Login failed. Please try again.",
    });
  }
});

export default router;
