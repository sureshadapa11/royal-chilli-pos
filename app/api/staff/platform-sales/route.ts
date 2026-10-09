import { NextResponse } from "next/server";

// Delivery-platform values are now entered and reported through Daily Accounts.
// Keep a clear response for stale clients and bookmarks; do not write legacy
// platform_sales rows after the source-of-truth migration.
function retired() {
  return NextResponse.json({ error: "Delivery platform entry moved to Daily Accounts." }, { status: 410 });
}

export async function GET() { return retired(); }
export async function POST() { return retired(); }
export async function PUT() { return retired(); }
export async function DELETE() { return retired(); }
