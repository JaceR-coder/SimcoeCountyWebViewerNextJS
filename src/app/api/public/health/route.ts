import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/health
 * Whether the server can reach ner_master (DATABASE_URL) - search, LHRS and My Maps share links
 * depend on it. Reports only the Prisma error code (e.g. P1000 bad credentials, P1001 host
 * unreachable, P1013 malformed URL), never the message, which can echo connection details.
 */
export async function GET(): Promise<NextResponse> {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ database: "error", code: "DATABASE_URL not set" }, { status: 503 });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ database: "ok" });
  } catch (error) {
    console.error("Health check: database unreachable:", error);
    const code =
      error instanceof Prisma.PrismaClientInitializationError
        ? (error.errorCode ?? "unknown")
        : error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : "unknown";
    return NextResponse.json({ database: "error", code }, { status: 503 });
  }
}
