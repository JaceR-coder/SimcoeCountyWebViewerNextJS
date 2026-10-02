import { NextRequest, NextResponse } from "next/server";

// The real implementation (@/lib/secure/reports/powerbiEmbed) lives in the private
// SimcoeCountyWebViewerSecure repo and was never published here - importing it broke
// `next build`. Power BI property reports are County of Simcoe-only, so this build reports
// the feature as unavailable instead.
async function setReportParameters(_report: string, _params: unknown[]): Promise<string> {
  void _report;
  void _params;
  throw new ReportsEmbedUnavailableError();
}

class ReportsEmbedUnavailableError extends Error {}

/**
 * POST /api/public/reports/embed/:report
 * Store PowerBI report parameters and return a batchId (UUID).
 * The front-end uses the batchId to open the PowerBI report viewer.
 *
 * Body: { params: [{ name: string, value: string, type: string }] }
 * Returns: batchId string (UUID)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> }
): Promise<NextResponse> {
  try {
    const { report } = await params;

    const body = await request.json();
    const reportParams = body?.params;

    if (!Array.isArray(reportParams) || reportParams.length === 0) {
      return NextResponse.json({ error: "Missing or empty params array" }, { status: 400 });
    }

    const batchId = await setReportParameters(report, reportParams);

    // Return the batchId as a plain JSON string (matches old API response format)
    return NextResponse.json(batchId);
  } catch (error) {
    if (error instanceof ReportsEmbedUnavailableError) {
      return NextResponse.json({ error: "Power BI reports are not available in this build" }, { status: 501 });
    }
    console.error("Error in reports embed handler:", error);
    return NextResponse.json({ error: "Failed to set report parameters" }, { status: 500 });
  }
}
