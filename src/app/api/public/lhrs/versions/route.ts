import { NextResponse } from "next/server";
import { getVersions } from "@/lib/services/lhrs";

/**
 * GET /api/public/lhrs/versions
 * LHRS versions, current first (replaces the legacy WebApi's getLHRSVersion)
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getVersions());
  } catch (error) {
    console.error("LHRS version lookup failed:", error);
    return NextResponse.json({ error: "LHRS version lookup failed." }, { status: 500 });
  }
}
