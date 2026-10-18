// Shown the moment a Staff Hub link is tapped, while the page's figures load
// on the server — without it the old page just sits there until they're ready.
export default function StaffLoading() {
  return <div className="text-muted-foreground text-center py-20 animate-pulse">Loading…</div>;
}
