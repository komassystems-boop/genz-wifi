import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

const router = Router();

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  throw new Error("Use a valid Kenyan Safaricom number.");
}

async function darajaToken() {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const base = process.env.DARAJA_BASE_URL;
  if (!key || !secret || !base) throw new Error("Daraja credentials are not configured.");
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const response = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await response.json() as { access_token?: string; errorMessage?: string };
  if (!response.ok || !data.access_token) throw new Error(data.errorMessage || "Could not authenticate with Daraja.");
  return data.access_token;
}

router.post("/stk-push", async (req, res) => {
  const parsed = z.object({ packageId: z.string().min(1), phone: z.string().min(9).max(15) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a package and enter your M-Pesa number." });

  const pkg = await prisma.package.findFirst({ where: { id: parsed.data.packageId, active: true } });
  if (!pkg) return res.status(404).json({ error: "Package not found." });

  const required = ["DARAJA_SHORTCODE", "DARAJA_PASSKEY", "DARAJA_CALLBACK_URL"];
  if (required.some(k => !process.env[k])) return res.status(503).json({ error: "M-Pesa is not configured yet. No payment was requested." });

  try {
    const phone = normalizePhone(parsed.data.phone);
    const token = await darajaToken();
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const shortcode = process.env.DARAJA_SHORTCODE!;
    const password = Buffer.from(`${shortcode}${process.env.DARAJA_PASSKEY}${timestamp}`).toString("base64");
    const payment = await prisma.payment.create({
      data: { phone, amountKes: pkg.priceKes, packageId: pkg.id }
    });

    const base = process.env.DARAJA_BASE_URL!;
    const response = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode, Password: password, Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline", Amount: pkg.priceKes,
        PartyA: phone, PartyB: shortcode, PhoneNumber: phone,
        CallBackURL: process.env.DARAJA_CALLBACK_URL, AccountReference: "GENZWIFI",
        TransactionDesc: `GENZ WIFI ${pkg.name}`
      })
    });
    const data = await response.json() as any;
    if (!response.ok || data.ResponseCode !== "0") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", resultDescription: data.errorMessage || data.ResponseDescription || "STK request failed" } });
      return res.status(502).json({ error: data.errorMessage || data.ResponseDescription || "M-Pesa request failed." });
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { merchantRequestId: data.MerchantRequestID, checkoutRequestId: data.CheckoutRequestID }
    });
    return res.json({ message: "STK push sent. Complete the prompt on your phone.", paymentId: payment.id });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Payment service unavailable." });
  }
});

// Safaricom sends callbacks here. Treat the callback as untrusted input and verify
// the CheckoutRequestID against a pending payment before marking it paid.
router.post("/mpesa/callback", async (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) return res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid callback" });

  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: callback.CheckoutRequestID } });
  if (!payment || payment.status !== "PENDING") return res.json({ ResultCode: 0, ResultDesc: "Callback received" });

  if (Number(callback.ResultCode) !== 0) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", resultDescription: String(callback.ResultDesc || "Payment failed").slice(0, 500) } });
    return res.json({ ResultCode: 0, ResultDesc: "Callback processed" });
  }

  const items = callback.CallbackMetadata?.Item || [];
  const receipt = items.find((x: any) => x.Name === "MpesaReceiptNumber")?.Value;
  const amount = Number(items.find((x: any) => x.Name === "Amount")?.Value);
  const phone = String(items.find((x: any) => x.Name === "PhoneNumber")?.Value || "");
  if (!receipt || amount !== payment.amountKes || phone !== payment.phone) {
    return res.status(400).json({ ResultCode: 1, ResultDesc: "Payment details did not match" });
  }

  await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", mpesaReceiptNumber: String(receipt) } });
    const pkg = await tx.package.findUniqueOrThrow({ where: { id: payment.packageId } });
    const code = `GZ${cryptoRandomCode()}`;
    await tx.voucher.create({
      data: { code, paymentId: payment.id, expiresAt: new Date(Date.now() + pkg.durationMinutes * 60_000) }
    });
  });
  return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

function cryptoRandomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(5))).map(x => (x % 36).toString(36)).join("").toUpperCase();
}
export default router;
