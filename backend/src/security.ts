import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.warn("WARNING: Set JWT_SECRET to a random value of at least 32 characters.");
}

export function signToken(user: { id: string; email: string; role: string }) {
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET is not configured securely.");
  return jwt.sign(user, secret, { expiresIn: "8h" });
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!secret || secret.length < 32 || !token) return res.status(401).json({ error: "Unauthorized" });
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.role !== "OWNER") return res.status(403).json({ error: "Owner access required" });
    res.locals.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
