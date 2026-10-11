export default function LinkExpired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fdf8ec] px-6 text-center">
      <div>
        <p className="text-lg font-semibold">This link isn&apos;t working any more</p>
        <p className="mt-1 text-sm text-muted-foreground">Ask a manager for the new one.</p>
      </div>
    </div>
  );
}
