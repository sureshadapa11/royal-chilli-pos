import { NextRequest, NextResponse } from "next/server";
import { getBusiness, websiteBusinessId } from "@/lib/business";

// GET — the name and tagline of the business whose site this is, for the
// "something went wrong" page (a client page, so it can't look it up itself).
export async function GET(req: NextRequest) {
  try {
    const b = await getBusiness(await websiteBusinessId(req.headers.get("host")));
    return NextResponse.json({ name: b?.name ?? null, tagline: b?.tagline ?? null }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ name: null, tagline: null });
  }
}
