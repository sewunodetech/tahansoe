import { NextResponse } from "next/server";
import { db, linkNonces } from "@tahansoe/db";
import { getSession } from "@/lib/session";
import crypto from "crypto";

export async function POST() {
  const session = await getSession();

  if (!session.userId) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const code = crypto.randomBytes(3).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.insert(linkNonces).values({
    userId: session.userId,
    code,
    expiresAt,
  });

  return NextResponse.json({ code });
}