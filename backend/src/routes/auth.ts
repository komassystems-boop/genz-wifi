import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken } from "../security";

const router = Router();
router.post("/login", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });

  const user = await prisma.adminUser.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  return res.json({ token: signToken({ id: user.id, email: user.email, role: user.role }), user: { email: user.email, role: user.role } });
});
export default router;
