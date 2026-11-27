import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../db";

const router = Router();

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  throw new Error("Use a valid Kenyan mobile number, e.g. 0712345678.");
}

function darajaTimestamp(): string {
  // Daraja expects yyyyMMddHHmmss. Use Kenya local time (EAT).
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}${value("second")}`;
}

async function darajaToken(): Promise<string> {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const base = process.env.DARAJA_BASE_URL;

  if (!key || !secret || !base) {
    throw new Error("Daraja credentials are not configured in the backend.");
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const response = await fetch(
    `${base.replace(/\/$/, "")}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    errorMessage?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.errorMessage || "Could not authenticate with Daraja.");
  }

  return data.access_token;
}

router.post("/stk-push", async (req, res) => {
  const parsed = z
    .object({
      packageId: z.string().min(1),
      phone: z.string().min(9).max(15),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Select a package and enter your M-Pesa number.",
    });
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid phone number.",
    });
  }

  const pkg = await prisma.package.findFirst({
    where: { id: parsed.data.packageId, active: true },
  });

  if (!pkg) {
    return res.status(404).json({ error: "Package not found or unavailable." });
  }

  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callbackUrl = process.env.DARAJA_CALLBACK_URL;
  const base = process.env.DARAJA_BASE_URL;

  if (!shortcode || !passkey || !callbackUrl || !base) {
    return res.status(503).json({
      error: "M-Pesa is not configured yet. No payment was requested.",
    });
  }

  let payment;
  try {
    const token = await darajaToken();
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    payment = await prisma.payment.create({
      data: {
        phone,
        amountKes: pkg.priceKes,
        packageId: pkg.id,
      },
    });

    const response = await fetch(
      `${base.replace(/\/$/, "")}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: pkg.priceKes,
          PartyA: phone,
          PartyB: shortcode,
          PhoneNumber: phone,
          CallBackURL: callbackUrl,
          AccountReference: "GENZWIFI",
          TransactionDesc: `GENZ WIFI ${pkg.name}`,
        }),
      }
    );

    const data = (await response.json().catch(() => ({}))) as {
      ResponseCode?: string;
      ResponseDescription?: string;
      CustomerMessage?: string;
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      errorMessage?: string;
    };

    if (!response.ok || data.ResponseCode !== "0" || !data.CheckoutRequestID) {
      const message =
        data.errorMessage ||
        data.ResponseDescription ||
        "Daraja did not accept the STK Push request.";

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", resultDescription: message.slice(0, 500) },
      });

      return res.status(502).json({ error: message });
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        merchantRequestId: data.MerchantRequestID,
        checkoutRequestId: data.CheckoutRequestID,
      },
    });

    return res.json({
      message:
        data.CustomerMessage ||
        "STK Push sent. Complete the prompt on your phone.",
      paymentId: payment.id,
    });
  } catch (error) {
    if (payment?.id) {
      await prisma.payment
        .update({
          where: { id: payment.id },
          data: {
            status: "FAILED",
            resultDescription:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Payment request failed.",
          },
        })
        .catch(() => undefined);
    }

    return res.status(503).json({
      error:
        error instanceof Error
          ? error.message
          : "Payment service unavailable. No voucher was issued.",
    });
  }
});

// Customer status polling. The payment ID is a random CUID returned only to the
// checkout page; never include phone numbers or M-Pesa credentials in this response.
router.get("/status/:paymentId", async (req, res) => {
  const paymentId = req.params.paymentId;
  if (!paymentId || paymentId.length > 64) {
    return res.status(400).json({ error: "Invalid payment ID." });
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      resultDescription: true,
      voucher: { select: { code: true, expiresAt: true } },
    },
  });

  if (!payment) return res.status(404).json({ error: "Payment not found." });

  return res.json({
    status: payment.status,
    message:
      payment.status === "PAID"
        ? "Payment confirmed."
        : payment.status === "FAILED"
          ? payment.resultDescription || "Payment was not completed."
          : "Waiting for M-Pesa confirmation.",
    voucher: payment.voucher
      ? { code: payment.voucher.code, expiresAt: payment.voucher.expiresAt }
      : null,
  });
});

// Safaricom callback endpoint:
// https://genz-wifi-api.onrender.com/api/payments/mpesa/callback
router.post("/mpesa/callback", async (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;

  if (!checkoutRequestId || typeof checkoutRequestId !== "string") {
    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Invalid callback",
    });
  }

  const payment = await prisma.payment.findUnique({
    where: { checkoutRequestId },
  });

  // Acknowledge unknown or already-processed callbacks to prevent repeated retries.
  if (!payment || payment.status !== "PENDING") {
    return res.json({ ResultCode: 0, ResultDesc: "Callback received" });
  }

  if (Number(callback.ResultCode) !== 0) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        resultDescription: String(
          callback.ResultDesc || "M-Pesa payment was not completed."
        ).slice(0, 500),
      },
    });

    return res.json({ ResultCode: 0, ResultDesc: "Callback processed" });
  }

  const items = Array.isArray(callback.CallbackMetadata?.Item)
    ? callback.CallbackMetadata.Item
    : [];

  const findValue = (name: string) =>
    items.find((item: { Name?: string }) => item.Name === name)?.Value;

  const receipt = findValue("MpesaReceiptNumber");
  const amount = Number(findValue("Amount"));
  const phone = String(findValue("PhoneNumber") ?? "");

  if (
    !receipt ||
    !Number.isFinite(amount) ||
    amount !== payment.amountKes ||
    phone !== payment.phone
  ) {
    // Do not mark a mismatched callback as paid or issue a voucher.
    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Payment details did not match the pending payment.",
    });
  }

  const packageRecord = await prisma.package.findUnique({
    where: { id: payment.packageId },
  });

  if (!packageRecord) {
    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Package record not found.",
    });
  }

  const code = `GZ${randomBytes(5).toString("hex").toUpperCase()}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          mpesaReceiptNumber: String(receipt).slice(0, 50),
          resultDescription: "Payment confirmed by Daraja callback.",
        },
      });

      await tx.voucher.create({
        data: {
          code,
          paymentId: payment.id,
          expiresAt: new Date(Date.now() + packageRecord.durationMinutes * 60_000),
        },
      });
    });
  } catch (error) {
    // A duplicate callback or database conflict must not create another voucher.
    console.error("Could not process successful M-Pesa callback:", error);
    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Callback could not be processed.",
    });
  }

  return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

export default router;
