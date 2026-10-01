import { NextRequest, NextResponse } from "next/server";
import { SiweMessage } from "siwe";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { siweNonces, users } from "@/lib/schema";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { message, signature } = await req.json();

    const siweMessage = new SiweMessage(message);
    const { data: fields } = await siweMessage.verify({ signature });

    const toHost = (value: string) =>
      value.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    const allowedHosts = [
      req.headers.get("x-forwarded-host"),
      req.headers.get("host"),
      process.env.NEXT_PUBLIC_APP_DOMAIN,
    ]
      .filter((v): v is string => !!v)
      .map(toHost);
    if (!allowedHosts.includes(toHost(fields.domain))) {
      return NextResponse.json(
        { error: "Domain mismatch" },
        { status: 400 }
      );
    }

    const [stored] = await db
      .select()
      .from(siweNonces)
      .where(
        and(
          eq(siweNonces.nonce, fields.nonce),
          isNull(siweNonces.usedAt)
        )
      );

    if (!stored) {
      return NextResponse.json(
        { error: "Invalid or already used nonce" },
        { status: 400 }
      );
    }

    if (new Date(stored.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Nonce expired" },
        { status: 400 }
      );
    }

    await db
      .update(siweNonces)
      .set({ usedAt: new Date() })
      .where(eq(siweNonces.id, stored.id));

    const walletAddress = fields.address.toLowerCase();
    const chainId = fields.chainId;

    await db
      .insert(users)
      .values({
        walletAddress,
        chainId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [users.walletAddress, users.chainId],
        set: {
          updatedAt: new Date(),
          isActive: true,
        },
      });

    const [user] = await db
      .select({ id: users.id, walletAddress: users.walletAddress })
      .from(users)
      .where(
        and(
          eq(users.walletAddress, walletAddress),
          eq(users.chainId, chainId)
        )
      );

    const session = await getSession();
    session.userId = user.id;
    session.walletAddress = user.walletAddress;
    await session.save();

    return NextResponse.json({ userId: user.id, walletAddress: user.walletAddress });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}