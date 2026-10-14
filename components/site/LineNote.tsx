"use client";

import { useState } from "react";

// "+ Add note" on a basket line (agreed 2026-10-14): hidden until tapped, so
// the basket stays tidy; the note goes under that dish on the kitchen ticket.
export default function LineNote({ note, onSave, small = false }: { note?: string; onSave: (note: string) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const size = small ? "text-xs" : "text-sm";
  if (!open) {
    return note
      ? <button type="button" onClick={() => { setText(note); setOpen(true); }} className={`mt-1 block text-left ${size} text-muted-foreground`}>📝 {note} <span className="underline">Edit</span></button>
      : <button type="button" onClick={() => { setText(""); setOpen(true); }} className={`mt-1 block ${size} text-primary underline`}>+ Add note</button>;
  }
  const save = () => { onSave(text.trim().slice(0, 200)); setOpen(false); };
  return (
    <div className="mt-1.5 flex gap-2">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} maxLength={200}
        placeholder="e.g. no onion, extra gravy" className={`min-w-0 flex-1 border border-border bg-background px-2 py-1 ${size} outline-none focus:border-primary`} />
      <button type="button" onClick={save} className={`border border-primary bg-primary px-2.5 py-1 ${size} text-primary-foreground`}>Save</button>
    </div>
  );
}
