import { NextResponse } from "next/server";
import { fetchAnalyticsData } from "@/lib/analytics";

export async function GET() {
  try {
    const data = await fetchAnalyticsData();
    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=60",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error: unknown) {
    console.error("[api/analytics] Error generating analytics:", error);
    const msg = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: "Failed to fetch analytics from RPC nodes", details: msg },
      { status: 500 }
    );
  }
}
