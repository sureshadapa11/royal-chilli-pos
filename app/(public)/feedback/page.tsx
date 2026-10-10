import type { Metadata } from "next";
import { headers } from "next/headers";
import { websiteBusinessId, getBusiness } from "@/lib/business";
import { getBusinessSetting } from "@/lib/business-settings";
import FeedbackForm from "@/components/site/FeedbackForm";

// "How was your meal?" — from the table QR, the receipt QR or a link. Every
// guest is offered the Google review link afterwards, whatever they rated.
export const metadata: Metadata = {
  title: "How was your meal?",
  robots: { index: false },
};

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ b?: string; table?: string; src?: string }> }) {
  const { b, table, src } = await searchParams;
  const businessId = await websiteBusinessId((await headers()).get("host"), b);
  const [business, review] = await Promise.all([
    getBusiness(businessId).catch(() => null),
    getBusinessSetting<string>(businessId, "google_review_url"),
  ]);
  const reviewUrl = typeof review === "string" && /^https:\/\//.test(review.trim()) ? review.trim() : null;
  const source = src === "receipt" || src === "email" ? src : table ? "table" : "web";
  return (
    <FeedbackForm
      businessName={business?.name ?? "The Royal Chilli"}
      reviewUrl={reviewUrl}
      table={table ?? null}
      source={source}
      businessParam={b ?? null}
    />
  );
}
