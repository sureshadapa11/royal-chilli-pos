// Shown straight away when a website link is tapped, while the page loads.
export default function PublicLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-[#E34234]" />
    </div>
  );
}
