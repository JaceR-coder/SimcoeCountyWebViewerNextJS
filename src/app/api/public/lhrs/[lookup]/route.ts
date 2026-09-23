import { NextRequest, NextResponse } from "next/server";
import { LOOKUPS, LHRSInputError, type LHRSLookup } from "@/lib/services/lhrs";

/**
 * POST /api/public/lhrs/{by_xy_multi|by_basepoint|by_m_distance|linear_by_m_distance}
 * Replaces the legacy WebApi's postGetLHRS* routes: same request bodies
 * ({version, snappingDistance, ...}) and the same {result} response envelope.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ lookup: string }> }): Promise<NextResponse> {
  const { lookup } = await params;
  if (!Object.hasOwn(LOOKUPS, lookup)) {
    return NextResponse.json({ error: `Unknown LHRS lookup "${lookup}".` }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await LOOKUPS[lookup as LHRSLookup](body as Record<string, unknown>);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof LHRSInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`LHRS ${lookup} failed:`, error);
    return NextResponse.json({ error: "LHRS lookup failed." }, { status: 500 });
  }
}
