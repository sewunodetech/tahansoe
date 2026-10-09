import { NextResponse } from "next/server";
import { db, siweNonces } from "@tahansoe/db";
import crypto from "crypto";

export async function GET() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await db.insert(siweNonces).values({
    nonce,
    expiresAt,
  });

  return NextResponse.json({ nonce });
}