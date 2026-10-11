"use client";

import { useState } from "react";
import { MONTHS, birthdayLabel } from "@/lib/birthday";
import { useRouter } from "next/navigation";
import { isValidUkMobile } from "@/lib/utils";
import LogoutButton from "@/components/site/LogoutButton";
import { siteContent } from "@/lib/site-content";
import { confirmDelete } from "@/components/ui/confirm";

type Address = { id: number; label: string; line: string; postcode: string | null; is_default: boolean };

export default function AccountView({
  initialFirstName,
  initialLastName,
  initialPhone,
  email,
  initialSubscribed,
  initialAddresses,
  initialBirthday = null,
}: {
  initialFirstName: string;
  initialLastName: string;
  initialPhone: string;
  email: string;
  initialSubscribed: boolean;
  initialAddresses: Address[];
  initialBirthday?: string | null;
}) {
  const router = useRouter();

  // Profile edit
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [phone, setPhone] = useState(initialPhone);
  const [profileErr, setProfileErr] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  async function saveProfile() {
    setProfileErr("");
    if (!firstName.trim()) { setProfileErr("First name is required"); return; }
    if (phone.trim() && !isValidUkMobile(phone)) { setProfileErr("Please enter a valid UK mobile number (starts with 07, 11 digits)"); return; }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${firstName.trim()} ${lastName.trim()}`.trim(), phone: phone.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setProfileErr(data.error || "Something went wrong"); return; }
      setEditing(false);
      router.refresh();
    } finally {
      setSavingProfile(false);
    }
  }

  // Birthday: day + month, set once (staff can change it)
  const [birthday, setBirthday] = useState(initialBirthday);
  const [bDay, setBDay] = useState("");
  const [bMonth, setBMonth] = useState("");
  const [bErr, setBErr] = useState("");
  const [bSaving, setBSaving] = useState(false);
  async function saveBirthday() {
    setBErr("");
    if (!bDay || !bMonth) { setBErr("Please choose a day and month"); return; }
    setBSaving(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthday: { day: Number(bDay), month: Number(bMonth) } }),
      });
      const data = await res.json();
      if (!res.ok) { setBErr(data.error || "Something went wrong"); return; }
      setBirthday(data.customer?.date_of_birth ?? `2000-${bMonth.padStart(2, "0")}-${bDay.padStart(2, "0")}`);
    } finally {
      setBSaving(false);
    }
  }

  // Addresses
  const [addresses, setAddresses] = useState(initialAddresses);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newLine, setNewLine] = useState("");
  const [newPostcode, setNewPostcode] = useState("");
  const [addrErr, setAddrErr] = useState("");
  const [addrBusy, setAddrBusy] = useState(false);

  async function refreshAddresses() {
    const res = await fetch("/api/account/addresses");
    if (res.ok) setAddresses((await res.json()).addresses || []);
  }
  async function saveAddress() {
    setAddrErr("");
    if (newLine.trim().length < 6) { setAddrErr("Please enter a full address"); return; }
    setAddrBusy(true);
    try {
      const res = await fetch("/api/account/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel || "Address", line: newLine, postcode: newPostcode }),
      });
      const data = await res.json();
      if (!res.ok) { setAddrErr(data.error || "Something went wrong"); return; }
      setAddOpen(false); setNewLabel(""); setNewLine(""); setNewPostcode("");
      await refreshAddresses();
    } finally {
      setAddrBusy(false);
    }
  }
  async function makeDefault(id: number) {
    await fetch(`/api/account/addresses/${id}`, { method: "PATCH" });
    await refreshAddresses();
  }
  async function removeAddress(id: number) {
    if (!(await confirmDelete("this address"))) return;
    await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
    await refreshAddresses();
  }

  // Unsubscribe
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [subBusy, setSubBusy] = useState(false);
  async function toggleSub() {
    setSubBusy(true);
    try {
      const next = !subscribed;
      await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketing_consent: next }),
      });
      setSubscribed(next);
    } finally {
      setSubBusy(false);
    }
  }

  const initial = (firstName[0] || "?").toUpperCase();

  return (
    <div>
      <h1 className="font-[family-name:var(--font-playfair)] text-2xl">Account</h1>

      <div className="mt-3.5 flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-gradient-to-br from-primary to-foreground font-[family-name:var(--font-playfair)] text-xl text-primary-foreground">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="break-words font-[family-name:var(--font-playfair)] text-lg">{`${firstName} ${lastName}`.trim() || "Your name"}</div>
          <div className="break-all text-sm text-muted-foreground">{email}</div>
        </div>
      </div>

      <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Profile</div>
      <div className="rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between px-4 pt-3.5">
          <span className="text-xs text-muted-foreground">Personal details</span>
          <button onClick={() => setEditing((v) => !v)} className="text-xs font-bold text-primary">
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>

        <div className="border-t border-border px-4 py-3">
          <label className="mb-1 block text-xs text-muted-foreground">First name</label>
          {editing ? (
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
          ) : (
            <div className="text-[15px]">{firstName || "—"}</div>
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <label className="mb-1 block text-xs text-muted-foreground">Last name</label>
          {editing ? (
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
          ) : (
            <div className="text-[15px]">{lastName || "—"}</div>
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <label className="mb-1 block text-xs text-muted-foreground">Mobile</label>
          {editing ? (
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Add mobile number" className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
          ) : (
            <div className={`text-[15px] ${phone ? "" : "text-muted-foreground"}`}>{phone || "Not added"}</div>
          )}
        </div>
        {editing && (
          <div className="border-t border-border px-4 py-3">
            {profileErr && <p className="mb-2 text-sm text-red-500">{profileErr}</p>}
            <button onClick={saveProfile} disabled={savingProfile} className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Delivery addresses</div>
      <div className="rounded-2xl border border-border bg-surface shadow-sm">
        {addresses.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <span className="mb-1.5 block text-2xl">📍</span>
            No saved addresses. Add one for faster delivery.
          </div>
        ) : (
          addresses.map((a) => (
            <div key={a.id} className="border-b border-border px-4 py-3.5 last:border-b-0">
              <div className="font-semibold">
                {a.label}
                {a.is_default && <span className="ml-2 text-[11px] font-bold text-emerald-600">Default</span>}
              </div>
              <div className="text-sm text-muted-foreground">{a.line}{a.postcode ? `, ${a.postcode}` : ""}</div>
              <div className="mt-2 flex gap-4">
                {!a.is_default && <button onClick={() => makeDefault(a.id)} className="text-xs font-bold text-primary">Set default</button>}
                <button onClick={() => removeAddress(a.id)} className="text-xs font-bold text-muted-foreground">Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
      <button onClick={() => setAddOpen(true)} className="mt-2.5 w-full rounded-xl border border-primary py-2.5 text-sm font-semibold text-primary">
        Add address
      </button>

      <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Birthday</div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        {birthday ? (
          <div className="text-sm">
            <span className="font-semibold">🎂 {birthdayLabel(birthday)}</span>
            <p className="mt-1 text-xs text-muted-foreground">A week before, a birthday treat will be waiting in your Rewards. Need to change it? Call us.</p>
          </div>
        ) : (
          <div>
            <p className="text-sm">Add your birthday and we&apos;ll send you a <b>free dessert</b> to celebrate.</p>
            <div className="mt-3 flex gap-2">
              <select aria-label="Birthday day" value={bDay} onChange={(e) => setBDay(e.target.value)} className="w-24 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <select aria-label="Birthday month" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <button onClick={saveBirthday} disabled={bSaving} className="rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{bSaving ? "Saving…" : "Save"}</button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">No year needed. Once saved, only we can change it.</p>
            {bErr && <p className="mt-1 text-xs text-red-600">{bErr}</p>}
          </div>
        )}
      </div>

      <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Support</div>
      <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-sm">
        <div className="text-sm text-muted-foreground">Call the restaurant</div>
        <div className="my-2 font-[family-name:var(--font-playfair)] text-2xl text-primary">{siteContent.contact.phone}</div>
        <a href={`tel:${siteContent.contact.phone.replace(/\s/g, "")}`} className="inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground">
          Call now
        </a>
      </div>

      <div className="mt-6">
        <LogoutButton />
      </div>

      <div className="mt-6 text-center">
        <button onClick={toggleSub} disabled={subBusy} className="text-xs font-medium text-muted-foreground underline">
          {subscribed ? "Unsubscribe from marketing emails" : "Resubscribe to marketing emails"}
        </button>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {subscribed ? "You're subscribed to offers and news." : "You've unsubscribed. You'll still get order and booking updates."}
        </div>
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-border" />
            <h3 className="text-xl font-semibold">Add delivery address</h3>
            <p className="mt-1 text-sm text-muted-foreground">Used when you choose delivery at checkout.</p>
            <div className="mt-4 space-y-3">
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label — Home, Work…" className="w-full rounded-lg border border-border bg-background px-2.5 py-2.5 text-sm outline-none focus:border-primary" />
              <textarea value={newLine} onChange={(e) => setNewLine(e.target.value)} rows={2} placeholder="Street, area" className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2.5 text-sm outline-none focus:border-primary" />
              <input value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} placeholder="Postcode" className="w-full rounded-lg border border-border bg-background px-2.5 py-2.5 text-sm outline-none focus:border-primary" />
              {addrErr && <p className="text-sm text-red-500">{addrErr}</p>}
              <button onClick={saveAddress} disabled={addrBusy} className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {addrBusy ? "Saving…" : "Save address"}
              </button>
              <button onClick={() => setAddOpen(false)} className="w-full rounded-xl bg-muted py-3 text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
