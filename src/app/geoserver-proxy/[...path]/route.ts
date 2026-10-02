import { NextRequest, NextResponse } from "next/server";
import { GEOMATICS_URL, geomaticsCookieHeader, getImapToken } from "@/lib/geomatics";

/**
 * /geoserver-proxy/* -> py-Geomatics /imap/geoserver/* (-> GeoServer)
 *
 * Every GeoServer request (tiles, legends, GetFeatureInfo, WFS, capabilities, REST layer info)
 * goes through py-Geomatics' permission proxy, which 403s any request naming a layer the caller
 * isn't granted. The caller's i-Map token is attached here, server-side, from their py-Geomatics
 * session cookie - so layer URLs in config never carry a token and no client code has to add one.
 * Anonymous callers get py-Geomatics' public layer set.
 */

export const dynamic = "force-dynamic";

// Upstream response headers worth passing on (fetch() already decoded the body, so no
// content-encoding/length; hop-by-hop headers never apply)
const PASS_HEADERS = ["content-type", "cache-control", "content-disposition", "expires", "last-modified", "etag"];

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const cookieHeader = geomaticsCookieHeader(request.cookies);

  const search = new URLSearchParams(request.nextUrl.search);
  search.delete("imap_token");
  const query = search.toString();
  const target = `${GEOMATICS_URL}/imap/geoserver/${path.map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`;

  const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
  const contentType = request.headers.get("content-type");

  const send = async (forceRefresh: boolean) => {
    const token = await getImapToken(cookieHeader, { forceRefresh });
    const headers: Record<string, string> = { "X-IMap-Token": token };
    if (contentType) headers["Content-Type"] = contentType;
    return fetch(target, { method: request.method, headers, body, cache: "no-store" });
  };

  let upstream: Response;
  try {
    upstream = await send(false);
    // A cached token can go stale early (py-Geomatics restart, secret rotation, or a grant
    // change we should pick up) - retry once with a fresh one before reporting a denial.
    if (upstream.status === 403) {
      upstream = await send(true);
    }
  } catch (error) {
    console.error("[geoserver-proxy] upstream request failed:", error);
    return NextResponse.json({ error: "GeoServer proxy request failed." }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  return forward(request, (await params).path);
}

export async function POST(request: NextRequest, { params }: Ctx) {
  return forward(request, (await params).path);
}
