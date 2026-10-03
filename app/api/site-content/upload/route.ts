import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_FOLDERS = new Set(["hero", "dishes", "menu", "gallery"]);

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  // Website photos (Website → Menu & photos) and homepage photos (Settings).
  if (!session || !(canAccess(session.role, "website") || canAccess(session.role, "settings"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG or WEBP images are allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 10MB or smaller" }, { status: 400 });
  }

  const folderInput = form.get("folder");
  const folder = typeof folderInput === "string" && ALLOWED_FOLDERS.has(folderInput) ? folderInput : "hero";
  const ext = file.name.split(".").pop() || "jpg";
  const path = `b${session.businessId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from("site-content")
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) {
    console.error("Site content upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: publicUrl } = supabase.storage.from("site-content").getPublicUrl(path);
  return NextResponse.json({ url: publicUrl.publicUrl });
}
