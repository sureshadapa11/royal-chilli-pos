"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import type { Staff } from "@/lib/types";
import { DEPARTMENTS, JOB_TITLES_BY_DEPARTMENT } from "@/lib/org-chart";
import { DOC_TYPE_LABEL } from "@/lib/employee-documents";
import EmployeePayslipsPanel from "@/components/staff/EmployeePayslipsPanel";
import { londonDateStr } from "@/lib/london-date";
import { confirmDelete } from "@/components/ui/confirm";

type HrDetails = {
  preferred_name: string | null; job_title: string | null; department: string | null;
  employment_status: string | null; contract_type: string | null; working_pattern: string | null;
  fixed_term_end_date: string | null; contracted_hours_per_week: string | null;
  rtw_evidence_method: string | null; rtw_share_code: string | null; rtw_time_limited: string | null;
  rtw_permission_expiry_date: string | null; rtw_has_restrictions: string | null; rtw_restrictions_details: string | null;
  rtw_is_student: string | null; rtw_student_dates_provided: boolean; rtw_sponsorship_now: string | null; rtw_sponsorship_future: string | null;
  ni_number: string | null; p45_available: string | null; hmrc_starter_checklist: string | null;
  bank_account_name: string | null; bank_name: string | null; sort_code: string | null; account_number: string | null;
  emergency_contact_relationship: string | null; emergency_contact_email: string | null;
  reasonable_adjustment_needed: string | null; reasonable_adjustment_details: string | null;
  doc_id_rtw_supplied: boolean; doc_p45_or_starter_supplied: boolean; doc_quals_supplied: boolean; doc_bank_supplied: boolean; doc_other: string | null;
  declaration_confirmed_accurate: boolean; declaration_will_report_changes: boolean; declaration_read_privacy: boolean;
  declaration_signature: string | null; declaration_date: string | null;
};

const emptyDetails: HrDetails = {
  preferred_name: "", job_title: "", department: "", employment_status: "", contract_type: "", working_pattern: "",
  fixed_term_end_date: "", contracted_hours_per_week: "",
  rtw_evidence_method: "", rtw_share_code: "", rtw_time_limited: "", rtw_permission_expiry_date: "",
  rtw_has_restrictions: "", rtw_restrictions_details: "", rtw_is_student: "", rtw_student_dates_provided: false,
  rtw_sponsorship_now: "", rtw_sponsorship_future: "",
  ni_number: "", p45_available: "", hmrc_starter_checklist: "",
  bank_account_name: "", bank_name: "", sort_code: "", account_number: "",
  emergency_contact_relationship: "", emergency_contact_email: "",
  reasonable_adjustment_needed: "", reasonable_adjustment_details: "",
  doc_id_rtw_supplied: false, doc_p45_or_starter_supplied: false, doc_quals_supplied: false, doc_bank_supplied: false, doc_other: "",
  declaration_confirmed_accurate: false, declaration_will_report_changes: false, declaration_read_privacy: false,
  declaration_signature: "", declaration_date: "",
};

// ── Small field helpers ─────────────────────────────────────────────────────
function Text({ label, value, onChange, placeholder }: { label: string; value: string | null; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-xs font-semibold">{label}</span>
      <input value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-xs font-semibold">{label}</span>
      <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string | null; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-xs font-semibold">{label}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-foreground font-bold text-sm uppercase tracking-wide mt-6 mb-3 first:mt-0">{children}</h3>;
}

// Masked bank/NI field: shows only the last 4 characters by default, with an
// explicit audit-logged reveal, and a separate edit mode so entering/changing
// the value doesn't require seeing the previous one unmasked first.
function MaskedField({ label, masked, value, onChange, staffId, field }: {
  label: string; masked: string | null; value: string | null; onChange: (v: string) => void; staffId: number; field: string;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/${staffId}/reveal`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }),
      });
      const data = await res.json();
      if (res.ok) {
        setRevealed(data.value || "—");
        setTimeout(() => setRevealed(null), 30000); // auto re-mask after 30s
      }
    } finally {
      setLoading(false);
    }
  }

  if (editing) {
    return (
      <label className="block">
        <span className="text-muted-foreground text-xs font-semibold">{label}</span>
        <div className="mt-1 flex items-center gap-2">
          <input autoFocus value={value || ""} onChange={(e) => onChange(e.target.value)}
            className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono" />
          <button onClick={() => setEditing(false)}
            className="px-3 py-2 bg-elevated hover:bg-elevated-hover text-foreground text-xs font-semibold rounded-lg border border-elevated">
            Done
          </button>
        </div>
      </label>
    );
  }

  return (
    <div>
      <span className="text-muted-foreground text-xs font-semibold">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <span className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono">
          {revealed ?? (masked || "—")}
        </span>
        {masked && (
          <button onClick={revealed ? () => setRevealed(null) : reveal} disabled={loading}
            className="px-3 py-2 bg-elevated hover:bg-elevated-hover text-foreground text-xs font-semibold rounded-lg border border-elevated disabled:opacity-50">
            {loading ? "…" : revealed ? "Hide" : "Reveal"}
          </button>
        )}
        <button onClick={() => { onChange(""); setEditing(true); }}
          className="px-3 py-2 bg-elevated hover:bg-elevated-hover text-foreground text-xs font-semibold rounded-lg border border-elevated">
          {masked ? "Change" : "Set"}
        </button>
      </div>
    </div>
  );
}

// ── Onboarding tab ───────────────────────────────────────────────────────────
function OnboardingTab({ staffId }: { staffId: number }) {
  const [staffInfo, setStaffInfo] = useState<Partial<Staff> | null>(null);
  const [rawDetails, setRawDetails] = useState<HrDetails>(emptyDetails);
  const [form, setForm] = useState<HrDetails>(emptyDetails);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof HrDetails>(key: K, value: HrDetails[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/hr/${staffId}`);
    const data = await res.json();
    setStaffInfo(data.staff || null);
    const details = { ...emptyDetails, ...(data.details || {}) };
    setRawDetails(details);
    setForm(details);
    setLoading(false);
  }, [staffId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/hr/${staffId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setSaved(true);
      load();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-muted-foreground text-center py-10 animate-pulse">Loading…</div>;

  const selectedDept = DEPARTMENTS.find((d) => d.label === form.department);
  const jobTitleOptions = selectedDept ? JOB_TITLES_BY_DEPARTMENT[selectedDept.value] : [];

  return (
    <div className="space-y-5">
      {staffInfo && (
        <div className="rounded-xl border border-border bg-surface-hover px-4 py-3 text-sm text-muted-foreground">
          Basic contact details (name, DOB, phone, email, address, emergency contact name/phone) are managed on the <strong className="text-foreground">Info</strong> tab. This screen covers what that one doesn&apos;t.
        </div>
      )}

      <SectionHeading>Employment Details</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select label="Department / work area" value={form.department} onChange={(v) => set("department", v)}
          options={DEPARTMENTS.map((d) => ({ value: d.label, label: d.label }))} />
        <Select label="Job title" value={form.job_title} onChange={(v) => set("job_title", v)}
          options={jobTitleOptions.map((t) => ({ value: t, label: t }))} />
        <Select label="Employment status" value={form.employment_status} onChange={(v) => set("employment_status", v)}
          options={[{ value: "employee", label: "Employee" }, { value: "worker", label: "Worker" }]} />
        <Select label="Contract type" value={form.contract_type} onChange={(v) => set("contract_type", v)}
          options={[{ value: "permanent", label: "Permanent" }, { value: "fixed_term", label: "Fixed-term" }, { value: "zero_hours", label: "Zero-hours / casual" }, { value: "temporary", label: "Temporary" }]} />
        <Select label="Working pattern" value={form.working_pattern} onChange={(v) => set("working_pattern", v)}
          options={[{ value: "full_time", label: "Full-time" }, { value: "part_time", label: "Part-time" }, { value: "variable", label: "Variable hours" }]} />
        <DateField label="Fixed-term end date (if applicable)" value={form.fixed_term_end_date} onChange={(v) => set("fixed_term_end_date", v)} />
        <Text label="Contracted hours per week" value={form.contracted_hours_per_week} onChange={(v) => set("contracted_hours_per_week", v)} placeholder="Enter a number or 'variable'" />
      </div>

      <SectionHeading>Right to Work — Self-Declared</SectionHeading>
      <p className="text-muted-foreground text-xs -mt-2">Employee&apos;s own onboarding-form answers. The employer&apos;s signed-off check is on the RTW Verification tab.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="How will they evidence right to work?" value={form.rtw_evidence_method} onChange={(v) => set("rtw_evidence_method", v)} />
        <Text label="Right-to-work share code (if applicable)" value={form.rtw_share_code} onChange={(v) => set("rtw_share_code", v)} />
        <Select label="Is permission to work time-limited?" value={form.rtw_time_limited} onChange={(v) => set("rtw_time_limited", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Unsure" }]} />
        <DateField label="Permission expiry date (if time-limited)" value={form.rtw_permission_expiry_date} onChange={(v) => set("rtw_permission_expiry_date", v)} />
        <Select label="Restrictions on hours or type of work?" value={form.rtw_has_restrictions} onChange={(v) => set("rtw_has_restrictions", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Unsure" }]} />
        <Text label="Details of restrictions" value={form.rtw_restrictions_details} onChange={(v) => set("rtw_restrictions_details", v)} />
        <Select label="Currently studying in the UK?" value={form.rtw_is_student} onChange={(v) => set("rtw_is_student", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
        <div className="flex items-end pb-2"><Check label="Academic term/vacation dates provided" checked={form.rtw_student_dates_provided} onChange={(v) => set("rtw_student_dates_provided", v)} /></div>
        <Select label="Requires employer sponsorship now?" value={form.rtw_sponsorship_now} onChange={(v) => set("rtw_sponsorship_now", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Unsure" }]} />
        <Select label="May require sponsorship when permission ends?" value={form.rtw_sponsorship_future} onChange={(v) => set("rtw_sponsorship_future", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Unsure" }]} />
      </div>

      <SectionHeading>Payroll &amp; Bank Details</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MaskedField label="National Insurance number" masked={rawDetails.ni_number} value={form.ni_number} onChange={(v) => set("ni_number", v)} staffId={staffId} field="ni_number" />
        <div />
        <Select label="P45 available?" value={form.p45_available} onChange={(v) => set("p45_available", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_applicable", label: "Not applicable" }]} />
        <Select label="HMRC starter checklist completed?" value={form.hmrc_starter_checklist} onChange={(v) => set("hmrc_starter_checklist", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_applicable", label: "Not applicable" }]} />
        <Text label="Bank account holder name" value={form.bank_account_name} onChange={(v) => set("bank_account_name", v)} />
        <Text label="Bank / building society name" value={form.bank_name} onChange={(v) => set("bank_name", v)} />
        <MaskedField label="Sort code" masked={rawDetails.sort_code} value={form.sort_code} onChange={(v) => set("sort_code", v)} staffId={staffId} field="sort_code" />
        <MaskedField label="Account number" masked={rawDetails.account_number} value={form.account_number} onChange={(v) => set("account_number", v)} staffId={staffId} field="account_number" />
      </div>

      <SectionHeading>Emergency Contact — Extra Detail</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="Relationship to employee" value={form.emergency_contact_relationship} onChange={(v) => set("emergency_contact_relationship", v)} placeholder="Parent, spouse, partner, friend…" />
        <Text label="Emergency contact email" value={form.emergency_contact_email} onChange={(v) => set("emergency_contact_email", v)} />
      </div>

      <SectionHeading>Reasonable Adjustments</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select label="Needs a reasonable adjustment or workplace support?" value={form.reasonable_adjustment_needed} onChange={(v) => set("reasonable_adjustment_needed", v)}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "prefer_to_discuss", label: "Prefer to discuss" }]} />
        <Text label="Adjustment / support requested" value={form.reasonable_adjustment_details} onChange={(v) => set("reasonable_adjustment_details", v)} />
      </div>
      <p className="text-amber-600 text-xs">Keep to what&apos;s needed to arrange support — detailed health information should be handled confidentially and separately from this record.</p>

      <SectionHeading>Document Checklist</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Check label="ID / right-to-work evidence supplied securely" checked={form.doc_id_rtw_supplied} onChange={(v) => set("doc_id_rtw_supplied", v)} />
        <Check label="P45 or HMRC starter checklist supplied" checked={form.doc_p45_or_starter_supplied} onChange={(v) => set("doc_p45_or_starter_supplied", v)} />
        <Check label="Required qualifications/certificates supplied" checked={form.doc_quals_supplied} onChange={(v) => set("doc_quals_supplied", v)} />
        <Check label="Bank details supplied securely" checked={form.doc_bank_supplied} onChange={(v) => set("doc_bank_supplied", v)} />
        <Text label="Other onboarding documents" value={form.doc_other} onChange={(v) => set("doc_other", v)} />
      </div>

      <SectionHeading>Employee Declaration</SectionHeading>
      <div className="space-y-2">
        <Check label="Confirms the information provided is accurate and complete" checked={form.declaration_confirmed_accurate} onChange={(v) => set("declaration_confirmed_accurate", v)} />
        <Check label="Will promptly report changes affecting contact, payroll or right-to-work details" checked={form.declaration_will_report_changes} onChange={(v) => set("declaration_will_report_changes", v)} />
        <Check label="Has read the privacy and retention information" checked={form.declaration_read_privacy} onChange={(v) => set("declaration_read_privacy", v)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="Full name / electronic signature" value={form.declaration_signature} onChange={(v) => set("declaration_signature", v)} />
        <DateField label="Declaration date" value={form.declaration_date} onChange={(v) => set("declaration_date", v)} />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-emerald-600 text-sm font-semibold">✓ Saved</span>}
      </div>
    </div>
  );
}

// ── References tab ──────────────────────────────────────────────────────────
type Reference = { id: number; employer_name: string | null; job_title: string | null; employment_dates: string | null; referee_name: string | null; referee_contact: string | null; may_contact: boolean | null; qualification: string | null };
const emptyRef = { employer_name: "", job_title: "", employment_dates: "", referee_name: "", referee_contact: "", may_contact: false, qualification: "" };

function ReferencesTab({ staffId }: { staffId: number }) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [form, setForm] = useState(emptyRef);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/${staffId}/references`);
    const data = await res.json();
    setRefs(data.references || []);
  }, [staffId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.employer_name && !form.referee_name) return;
    setSaving(true);
    try {
      await fetch(`/api/hr/${staffId}/references`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setForm(emptyRef);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!(await confirmDelete("this reference"))) return;
    await fetch(`/api/hr/${staffId}/references?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4 space-y-3">
        <h3 className="text-foreground font-bold text-sm">Add Reference / Qualification</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Text label="Most recent employer" value={form.employer_name} onChange={(v) => setForm({ ...form, employer_name: v })} />
          <Text label="Previous job title" value={form.job_title} onChange={(v) => setForm({ ...form, job_title: v })} />
          <Text label="Employment dates" value={form.employment_dates} onChange={(v) => setForm({ ...form, employment_dates: v })} placeholder="MM/YYYY to MM/YYYY" />
          <Text label="Reference contact name" value={form.referee_name} onChange={(v) => setForm({ ...form, referee_name: v })} />
          <Text label="Reference email / telephone" value={form.referee_contact} onChange={(v) => setForm({ ...form, referee_contact: v })} />
          <Text label="Relevant qualification / certificate" value={form.qualification} onChange={(v) => setForm({ ...form, qualification: v })} />
        </div>
        <Check label="May the employer contact this referee?" checked={form.may_contact} onChange={(v) => setForm({ ...form, may_contact: v })} />
        <button onClick={add} disabled={saving} className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">+ Add</button>
      </div>

      <div className="space-y-2">
        {refs.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 flex items-start justify-between gap-3">
            <div className="text-sm">
              <p className="text-foreground font-semibold">{r.employer_name || "—"} {r.job_title && `· ${r.job_title}`}</p>
              <p className="text-muted-foreground">{r.employment_dates}</p>
              {r.referee_name && <p className="text-muted-foreground">Referee: {r.referee_name} {r.referee_contact && `(${r.referee_contact})`} {r.may_contact ? "· may contact" : "· do not contact"}</p>}
              {r.qualification && <p className="text-muted-foreground">Qualification: {r.qualification}</p>}
            </div>
            <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-red-600 text-xs font-semibold flex-shrink-0">Remove</button>
          </div>
        ))}
        {refs.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No references recorded yet.</p>}
      </div>
    </div>
  );
}

// ── Documents tab ────────────────────────────────────────────────────────────
// Actual files (the checklist on the Onboarding tab only ever recorded that
// a document was *shown*, never stored it). Bucket is private — every view
// goes through a fresh short-lived signed URL, never a permanent link.
type EmployeeDoc = { id: number; doc_type: string; file_name: string; expiry_date: string | null; created_at: string };

function DocumentsTab({ staffId }: { staffId: number }) {
  const [docs, setDocs] = useState<EmployeeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState("passport");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/hr/${staffId}/documents`);
    const data = await res.json();
    setDocs(data.documents || []);
    setLoading(false);
  }, [staffId]);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("doc_type", docType);
      if (expiryDate) form.append("expiry_date", expiryDate);
      const res = await fetch(`/api/hr/${staffId}/documents`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); return; }
      setExpiryDate("");
      load();
    } finally {
      setUploading(false);
    }
  }

  async function view(id: number) {
    const res = await fetch(`/api/hr/${staffId}/documents/${id}/url`);
    const data = await res.json();
    if (!res.ok || !data.url) { toast({ variant: "destructive", title: "Couldn't open document" }); return; }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function remove(id: number) {
    if (!(await confirmDelete("this document"))) return;
    await fetch(`/api/hr/${staffId}/documents/${id}`, { method: "DELETE" });
    load();
  }

  function expiryTone(date: string | null) {
    if (!date) return "";
    const days = (new Date(date).getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "text-red-600 font-semibold";
    if (days <= 30) return "text-amber-600 font-semibold";
    return "text-muted-foreground";
  }

  if (loading) return <div className="text-muted-foreground text-sm py-6">Loading documents…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4 space-y-3">
        <h3 className="text-foreground font-bold text-sm">Upload a document</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={docType} onChange={(e) => setDocType(e.target.value)}
            className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
            {Object.entries(DOC_TYPE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <DateField label="Expiry date (if applicable)" value={expiryDate || null} onChange={setExpiryDate} />
        </div>
        <label className={`flex w-fit items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs ${uploading ? "cursor-not-allowed text-muted-foreground/50" : "cursor-pointer text-muted-foreground hover:border-red-400 hover:text-red-600"}`}>
          {uploading ? "Uploading…" : "+ Choose file & upload"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </label>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <p className="text-muted-foreground text-xs">JPEG, PNG, WEBP or PDF, up to 10MB. Only staff who can manage HR records can view or download these.</p>
      </div>

      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm min-w-0">
              <p className="text-foreground font-semibold">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</p>
              <p className="text-muted-foreground truncate">{d.file_name}</p>
              {d.expiry_date && <p className={expiryTone(d.expiry_date)}>Expires {new Date(d.expiry_date).toLocaleDateString("en-GB")}</p>}
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <button onClick={() => view(d.id)} className="text-muted-foreground hover:text-foreground text-xs font-semibold">View</button>
              <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-red-600 text-xs font-semibold">Remove</button>
            </div>
          </div>
        ))}
        {docs.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No documents uploaded yet.</p>}
      </div>
    </div>
  );
}

// ── RTW Verification tab ────────────────────────────────────────────────────
type RtwCheck = {
  id: number; check_date: string; check_method: string; identity_matched: boolean | null; documents_genuine_valid: boolean | null;
  work_permitted: boolean | null; time_limited: boolean | null; permission_expiry_date: string | null; follow_up_due_date: string | null;
  checked_by_name: string | null; checked_by_position: string | null; employer_declaration_confirmed: boolean; signed_by: string | null; signed_date: string | null;
};
const emptyCheck = {
  check_date: londonDateStr(), check_method: "manual",
  identity_matched: false, documents_genuine_valid: false, work_permitted: false,
  time_limited: false, permission_expiry_date: "", follow_up_due_date: "",
  student_dates_retained: "not_applicable", ecs_expiry_date: "", evidence_stored_securely: false,
  storage_location: "", retention_reminder_recorded: false, restrictions_communicated: "not_applicable",
  document_reference: "", checked_by_position: "", employer_declaration_confirmed: false, signed_by: "", signed_date: londonDateStr(),
};

function RtwVerificationTab({ staffId }: { staffId: number }) {
  const [checks, setChecks] = useState<RtwCheck[]>([]);
  const [form, setForm] = useState(emptyCheck);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/${staffId}/rtw-verification`);
    const data = await res.json();
    setChecks(data.checks || []);
  }, [staffId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/hr/${staffId}/rtw-verification`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setForm(emptyCheck);
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  const latest = checks[0];

  return (
    <div className="space-y-4">
      {latest ? (
        <div className={`rounded-xl border p-4 ${latest.work_permitted ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
          <p className="text-foreground font-bold text-sm">Latest check: {new Date(latest.check_date).toLocaleDateString("en-GB")}</p>
          <p className="text-muted-foreground text-sm mt-1">Method: {latest.check_method.replace(/_/g, " ")} · Checked by {latest.checked_by_name || "—"}</p>
          <p className={`text-sm font-semibold mt-1 ${latest.work_permitted ? "text-emerald-600" : "text-red-600"}`}>
            {latest.work_permitted ? "✓ Work permitted" : "⚠ Not confirmed as permitted"}
          </p>
          {latest.time_limited && latest.permission_expiry_date && (
            <p className="text-amber-600 text-sm font-semibold mt-1">⏳ Time-limited — expires {new Date(latest.permission_expiry_date).toLocaleDateString("en-GB")}{latest.follow_up_due_date && `, follow-up check due ${new Date(latest.follow_up_due_date).toLocaleDateString("en-GB")}`}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-amber-700 text-sm font-semibold">⚠ No right-to-work check recorded for this employee yet.</div>
      )}

      <button onClick={() => setShowForm((v) => !v)} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">
        {showForm ? "Cancel" : "+ Record a Check"}
      </button>

      {showForm && (
        <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DateField label="Check date" value={form.check_date} onChange={(v) => setForm({ ...form, check_date: v })} />
            <Select label="Check method" value={form.check_method} onChange={(v) => setForm({ ...form, check_method: v })}
              options={[{ value: "manual", label: "Manual" }, { value: "home_office_online", label: "Home Office online" }, { value: "idvt", label: "IDVT" }, { value: "employer_checking_service", label: "Employer Checking Service" }]} />
            <Text label="Document / status reference" value={form.document_reference} onChange={(v) => setForm({ ...form, document_reference: v })} />
            <Text label="Checker position" value={form.checked_by_position} onChange={(v) => setForm({ ...form, checked_by_position: v })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Check label="Identity matched" checked={form.identity_matched} onChange={(v) => setForm({ ...form, identity_matched: v })} />
            <Check label="Docs genuine & valid" checked={form.documents_genuine_valid} onChange={(v) => setForm({ ...form, documents_genuine_valid: v })} />
            <Check label="Work permitted" checked={form.work_permitted} onChange={(v) => setForm({ ...form, work_permitted: v })} />
            <Check label="Time-limited permission" checked={form.time_limited} onChange={(v) => setForm({ ...form, time_limited: v })} />
          </div>
          {form.time_limited && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DateField label="Permission expiry date" value={form.permission_expiry_date} onChange={(v) => setForm({ ...form, permission_expiry_date: v })} />
              <DateField label="Follow-up check due date" value={form.follow_up_due_date} onChange={(v) => setForm({ ...form, follow_up_due_date: v })} />
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Check label="Evidence stored securely (non-editable format)" checked={form.evidence_stored_securely} onChange={(v) => setForm({ ...form, evidence_stored_securely: v })} />
            <Check label="Retention reminder recorded (2 years post-employment)" checked={form.retention_reminder_recorded} onChange={(v) => setForm({ ...form, retention_reminder_recorded: v })} />
            <Check label="Employer declaration confirmed" checked={form.employer_declaration_confirmed} onChange={(v) => setForm({ ...form, employer_declaration_confirmed: v })} />
          </div>
          <Text label="Secure storage location" value={form.storage_location} onChange={(v) => setForm({ ...form, storage_location: v })} placeholder="Restricted HR folder/system" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="Signed by" value={form.signed_by} onChange={(v) => setForm({ ...form, signed_by: v })} />
            <DateField label="Date" value={form.signed_date} onChange={(v) => setForm({ ...form, signed_date: v })} />
          </div>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
            {saving ? "Saving…" : "Save Check"}
          </button>
        </div>
      )}

      {checks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-foreground font-bold text-sm">History</h3>
          {checks.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 text-sm">
              <p className="text-foreground font-medium">{new Date(c.check_date).toLocaleDateString("en-GB")} · {c.check_method.replace(/_/g, " ")} · by {c.checked_by_name || "—"}</p>
              <p className="text-muted-foreground">{c.work_permitted ? "Work permitted" : "Not confirmed permitted"} {c.time_limited && c.permission_expiry_date && `· expires ${new Date(c.permission_expiry_date).toLocaleDateString("en-GB")}`}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── New Starter Checklist tab ───────────────────────────────────────────────
type Task = { key: string; label: string; owner: string; status: string; notes: string | null };

function ChecklistTab({ staffId }: { staffId: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/${staffId}/tasks`);
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }, [staffId]);
  useEffect(() => { load(); }, [load]);

  async function toggle(task: Task) {
    const newStatus = task.status === "done" ? "not_started" : "done";
    setTasks((prev) => prev.map((t) => t.key === task.key ? { ...t, status: newStatus } : t));
    await fetch(`/api/hr/${staffId}/tasks`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_key: task.key, status: newStatus, notes: task.notes }) });
  }

  if (loading) return <div className="text-muted-foreground text-center py-10 animate-pulse">Loading…</div>;

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-surface-hover px-4 py-3 flex items-center justify-between">
        <span className="text-foreground font-semibold text-sm">{doneCount} of {tasks.length} complete</span>
        <div className="w-32 h-2 bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }} />
        </div>
      </div>
      {tasks.map((t) => (
        <label key={t.key} className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${t.status === "done" ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)]"}`}>
          <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} className="mt-0.5" />
          <div>
            <p className={`text-sm font-medium ${t.status === "done" ? "text-emerald-700 line-through" : "text-foreground"}`}>{t.label}</p>
            <p className="text-muted-foreground text-xs">{t.owner}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

// ── Employee picker + main ──────────────────────────────────────────────────
function locationLabel(ids: number[] | undefined, locationNames: Map<number, string>): string | null {
  const names = (ids ?? []).map((id) => locationNames.get(id)).filter((n): n is string => !!n);
  return names.length > 0 ? `(Locations: ${names.join(", ")})` : null;
}

function EmployeePicker({
  employees, locationNames, selected, onSelect, onAddNew, search, setSearch, roleFilter, setRoleFilter, activeFilter, setActiveFilter,
}: {
  employees: Staff[]; locationNames: Map<number, string>; selected: Staff | null; onSelect: (s: Staff) => void; onAddNew: () => void;
  search: string; setSearch: (v: string) => void;
  roleFilter: string; setRoleFilter: (v: string) => void;
  activeFilter: string; setActiveFilter: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] overflow-hidden">
      <div className="p-2 border-b border-border space-y-2">
        <input placeholder="Search name, ID, email…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <div className="flex gap-2">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="flex-1 min-w-0 bg-surface-hover border border-border rounded-lg px-2 py-2 text-foreground text-xs">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}
            className="flex-1 min-w-0 bg-surface-hover border border-border rounded-lg px-2 py-2 text-foreground text-xs">
            <option value="1">Active</option>
            <option value="0">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <button onClick={onAddNew} className="w-full px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">
          + New Employee
        </button>
      </div>
      <div className="lg:max-h-[420px] lg:overflow-y-auto">
        {employees.map((e) => (
          <button key={e.id} onClick={() => onSelect(e)}
            className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 transition-colors ${selected?.id === e.id ? "bg-red-500/10" : "hover:bg-surface-hover"}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-foreground font-medium text-sm truncate">{e.name}</p>
              {!e.active && <span className="flex-shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-surface-hover text-muted-foreground">Inactive</span>}
            </div>
            <p className="text-muted-foreground text-xs capitalize">{e.employee_number} · {e.role.replace("_", " ")}</p>
            {locationLabel(e.location_ids, locationNames) && (
              <p className="text-muted-foreground text-xs truncate">{locationLabel(e.location_ids, locationNames)}</p>
            )}
          </button>
        ))}
        {employees.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No employees found.</p>}
      </div>
    </div>
  );
}

// ── New Employee modal ──────────────────────────────────────────────────────
const ROLES: { value: string; label: string }[] = [
  { value: "employee", label: "Employee — POS + kitchen only" },
  { value: "manager", label: "Manager — operations, no HR/Settings" },
  { value: "hr", label: "HR — attendance, HR, payroll, finance, reports" },
  { value: "admin", label: "Admin — full access" },
];

function NewEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (staff: Staff) => void }) {
  const [form, setForm] = useState({
    name: "", username: "", password: "", role: "employee", email: "", phone: "",
    employment_type: "hourly" as "hourly" | "salaried", pay_rate: "0", pay_frequency: "weekly" as "weekly" | "monthly",
    hire_date: londonDateStr(),
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function save() {
    if (!form.name.trim() || !form.username.trim() || form.password.length < 6) {
      toast({ variant: "destructive", title: "Name and username are required, and the password needs at least 6 characters" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(), username: form.username.trim().toLowerCase(), password: form.password, role: form.role,
          email: form.email.trim() || null, phone: form.phone.trim() || null,
          employment_type: form.employment_type, pay_rate: Number(form.pay_rate) || 0,
          pay_frequency: form.pay_frequency, hire_date: form.hire_date || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create employee");
      toast({ variant: "success", title: "Employee created", description: `${form.name.trim()} can now log in.` });
      onCreated(data.employee);
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't create employee", description: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-foreground font-bold text-lg">New Employee</h2>
          <p className="text-muted-foreground text-xs mt-1">Creates their login account. You&apos;ll land on their HR record next to fill in onboarding, RTW and the checklist.</p>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="sm:col-span-2 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <input placeholder="Password (6+ characters)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value as "hourly" | "salaried" })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
              <option value="hourly">Hourly</option>
              <option value="salaried">Salaried</option>
            </select>
            <select value={form.pay_frequency} onChange={(e) => setForm({ ...form, pay_frequency: e.target.value as "weekly" | "monthly" })}
              className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <div className="sm:col-span-2 flex items-center gap-2">
              <span className="text-muted-foreground text-sm">£</span>
              <input type="number" step="0.01" placeholder="Pay rate" value={form.pay_rate} onChange={(e) => setForm({ ...form, pay_rate: e.target.value })}
                className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              <span className="text-muted-foreground text-xs">{form.employment_type === "hourly" ? "per hour" : `per ${form.pay_frequency === "weekly" ? "week" : "month"}`}</span>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 h-11 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Info tab — the employee's core profile (name, login, role, pay, contact
// details, emergency contact) plus deactivate/reactivate. This is the only
// place any of that is editable — it used to be a separate "Employees"
// directory page with its own copy of this form, which had already started
// drifting from this one (different role-dropdown ordering). ──────────────
type InfoForm = {
  name: string; username: string; password: string; role: string; email: string; phone: string;
  address: string; date_of_birth: string; hire_date: string;
  employment_type: "hourly" | "salaried"; pay_rate: string; pay_frequency: "weekly" | "monthly";
  emergency_contact_name: string; emergency_contact_phone: string;
};

function formFromStaff(s: Staff): InfoForm {
  return {
    name: s.name, username: s.username || "", password: "", role: s.role, email: s.email || "", phone: s.phone || "",
    address: s.address || "", date_of_birth: s.date_of_birth || "", hire_date: s.hire_date || "",
    employment_type: s.employment_type, pay_rate: String(s.pay_rate), pay_frequency: s.pay_frequency,
    emergency_contact_name: s.emergency_contact_name || "", emergency_contact_phone: s.emergency_contact_phone || "",
  };
}

// The staff member's 4-digit till PIN (app/pin): staff sign in at a paired
// till with it; a manager's PIN also approves refunds.
function TillPinField({ staffId }: { staffId: number }) {
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  async function send(value: string | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/staff-pin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staff_id: staffId, pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast({ variant: "destructive", title: "Couldn't save the PIN", description: data.error });
      toast({ variant: "success", title: value ? "Till PIN set" : "Till PIN removed", description: value ? "Tell them their PIN — it isn't shown again." : undefined });
      setPin("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-hover p-3">
      <span className="text-muted-foreground text-xs font-semibold">Till PIN (4 digits)</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="w-28 bg-background border border-border rounded-lg px-3 py-2 text-foreground text-center tracking-[0.4em]"
        />
        <button onClick={() => send(pin)} disabled={saving || pin.length !== 4} className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg">
          Set PIN
        </button>
        <button onClick={() => send(null)} disabled={saving} className="px-3 py-2 bg-surface border border-border text-muted-foreground text-xs font-semibold rounded-lg">
          Remove PIN
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Used to unlock the till. Each person needs a different PIN; a manager&apos;s PIN also approves refunds.</p>
    </div>
  );
}

function EmployeeInfoTab({ staff, onUpdated }: { staff: Staff; onUpdated: (s: Staff) => void }) {
  const [form, setForm] = useState<InfoForm>(formFromStaff(staff));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setForm(formFromStaff(staff)); }, [staff]);

  async function save() {
    if (!form.name.trim() || !form.username.trim()) {
      toast({ variant: "destructive", title: "Name and username are required" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(), username: form.username.trim().toLowerCase(), role: form.role,
        email: form.email.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, date_of_birth: form.date_of_birth || null, hire_date: form.hire_date || null,
        employment_type: form.employment_type, pay_rate: Number(form.pay_rate) || 0, pay_frequency: form.pay_frequency,
        emergency_contact_name: form.emergency_contact_name.trim() || null, emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      };
      if (form.password) payload.password = form.password;

      const res = await fetch(`/api/employees/${staff.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setForm((f) => ({ ...f, password: "" }));
      toast({ variant: "success", title: "Saved", description: `${form.name.trim()}'s record updated.` });
      onUpdated(data.employee);
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't save", description: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    const res = await fetch(`/api/employees/${staff.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: staff.active ? 0 : 1 }),
    });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't update status", description: data.error });
    toast({ variant: "success", title: staff.active ? "Employee deactivated" : "Employee reactivated" });
    onUpdated(data.employee);
  }

  return (
    <div className="space-y-5">
      <SectionHeading>Login &amp; Role</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Text label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
        <Text label="New password (leave blank to keep)" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="6+ characters" />
        <Select label="Role" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={ROLES} />
      </div>
      <TillPinField staffId={staff.id} />

      <SectionHeading>Employment &amp; Pay</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DateField label="Hire date" value={form.hire_date} onChange={(v) => setForm({ ...form, hire_date: v })} />
        <Select label="Employment type" value={form.employment_type} onChange={(v) => setForm({ ...form, employment_type: v as "hourly" | "salaried" })}
          options={[{ value: "hourly", label: "Hourly" }, { value: "salaried", label: "Salaried" }]} />
        <Select label="Pay frequency" value={form.pay_frequency} onChange={(v) => setForm({ ...form, pay_frequency: v as "weekly" | "monthly" })}
          options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
        <div>
          <span className="text-muted-foreground text-xs font-semibold">Pay rate</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">£</span>
            <input type="number" step="0.01" value={form.pay_rate} onChange={(e) => setForm({ ...form, pay_rate: e.target.value })}
              className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <span className="text-muted-foreground text-xs whitespace-nowrap">{form.employment_type === "hourly" ? "per hour" : `per ${form.pay_frequency === "weekly" ? "week" : "month"}`}</span>
          </div>
        </div>
      </div>

      <SectionHeading>Contact Details</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Text label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <Text label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
        <DateField label="Date of birth" value={form.date_of_birth} onChange={(v) => setForm({ ...form, date_of_birth: v })} />
      </div>

      <SectionHeading>Emergency Contact</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text label="Name" value={form.emergency_contact_name} onChange={(v) => setForm({ ...form, emergency_contact_name: v })} />
        <Text label="Phone" value={form.emergency_contact_phone} onChange={(v) => setForm({ ...form, emergency_contact_phone: v })} />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={toggleActive} className="ml-auto px-4 py-2 bg-surface-hover hover:bg-elevated text-foreground text-sm font-semibold rounded-lg border border-border">
          {staff.active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
    </div>
  );
}

const TABS = [
  { id: "info", label: "Info" },
  { id: "onboarding", label: "Onboarding" },
  { id: "rtw", label: "RTW Verification" },
  { id: "checklist", label: "New Starter Checklist" },
  { id: "references", label: "References" },
  { id: "documents", label: "Documents" },
] as const;

const SECTIONS = [
  { id: "employee", label: "Employee" },
  { id: "payroll", label: "Payroll" },
  { id: "privacy", label: "Privacy & Retention" },
] as const;

const SECTION_SUB = {
  employee: "Employee directory, onboarding, right-to-work verification and new-starter checklist",
  payroll: "Select an employee to create a payslip or view their payment history.",
  privacy: "What's collected, why, and how long it's kept.",
};

function EmployeeSection() {
  const [employees, setEmployees] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("info");
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("1");
  const [locationNames, setLocationNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    fetch("/api/locations")
      .then((res) => (res.ok ? res.json() : { locations: [] }))
      .then((data: { locations?: { id: number; name: string }[] }) =>
        setLocationNames(new Map((data.locations ?? []).map((l) => [l.id, l.name]))))
      .catch(() => {});
  }, []);

  const loadEmployees = useCallback(async () => {
    const params = new URLSearchParams({ active: activeFilter });
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    const res = await fetch(`/api/employees?${params}`);
    const data = await res.json();
    setEmployees(data.employees || []);
  }, [search, roleFilter, activeFilter]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <EmployeePicker
          employees={employees} locationNames={locationNames} selected={selected} onSelect={(s) => { setSelected(s); setTab("info"); }} onAddNew={() => setShowNewEmployee(true)}
          search={search} setSearch={setSearch} roleFilter={roleFilter} setRoleFilter={setRoleFilter} activeFilter={activeFilter} setActiveFilter={setActiveFilter}
        />

        <div>
          {!selected ? (
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-10 text-center text-muted-foreground">
              Select an employee to view or edit their HR record.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div>
                  <h2 className="text-foreground font-bold text-lg">{selected.name}</h2>
                  <p className="text-muted-foreground text-sm capitalize">
                    {selected.employee_number} · {selected.role.replace("_", " ")}
                    {!selected.active && <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-surface-hover text-muted-foreground normal-case">Inactive</span>}
                  </p>
                  {locationLabel(selected.location_ids, locationNames) && (
                    <p className="text-muted-foreground text-xs">{locationLabel(selected.location_ids, locationNames)}</p>
                  )}
                </div>
                <Link href={`/staff/${selected.id}/assignments`}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-surface-hover">
                  Locations
                </Link>
              </div>
              <div className="flex flex-wrap gap-1 bg-surface-hover p-1 rounded-xl mb-5 w-fit">
                {TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${tab === t.id ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              {tab === "info" && (
                <EmployeeInfoTab
                  staff={selected}
                  onUpdated={(s) => { setSelected({ ...s, location_ids: s.location_ids ?? selected.location_ids }); loadEmployees(); }}
                />
              )}
              {tab === "onboarding" && <OnboardingTab staffId={selected.id} />}
              {tab === "rtw" && <RtwVerificationTab staffId={selected.id} />}
              {tab === "checklist" && <ChecklistTab staffId={selected.id} />}
              {tab === "references" && <ReferencesTab staffId={selected.id} />}
              {tab === "documents" && <DocumentsTab staffId={selected.id} />}
            </>
          )}
        </div>
      </div>

      {showNewEmployee && (
        <NewEmployeeModal
          onClose={() => setShowNewEmployee(false)}
          onCreated={async (staff) => {
            setShowNewEmployee(false);
            await loadEmployees();
            setSelected(staff);
            setTab("onboarding");
          }}
        />
      )}
    </>
  );
}

function PayrollSection() {
  return <EmployeePayslipsPanel />;
}

function PrivacySection() {
  return (
    <div className="max-w-2xl rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5">
      <h2 className="text-foreground font-bold text-lg mb-3">Employee Data Privacy &amp; Retention</h2>
      <div className="space-y-3 text-sm text-muted-foreground">
        <p><strong className="text-foreground">Right-to-work evidence</strong> — restricted HR access, stored securely in non-editable format. Retain for duration of employment plus 2 years, then securely destroy.</p>
        <p><strong className="text-foreground">Payroll, NI and bank details</strong> — payroll/HR only, secure systems. Retain for applicable payroll, tax and employment-law periods.</p>
        <p><strong className="text-foreground">Reasonable adjustments / health information</strong> — separate confidential record with very limited access. Keep only what&apos;s necessary and review regularly.</p>
        <p><strong className="text-foreground">References and qualifications</strong> — HR and recruiting manager only. Retain only as necessary under the recruitment/employee retention schedule.</p>
        <hr className="border-border" />
        <p>Collect only information that is adequate, relevant and necessary. Keep information accurate, secure and access-controlled. Detailed health or food-handler declarations should be collected separately and confidentially. This page is an operational tool, not legal advice — review against current guidance.</p>
      </div>
    </div>
  );
}

export default function HrView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("employee");

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">HR</h1>
          <p className="text-muted-foreground text-sm">{SECTION_SUB[section]}</p>
          <div className="flex flex-wrap gap-1 mt-4 bg-surface-hover p-1 rounded-xl w-fit">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${section === s.id ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        <div className="mx-auto max-w-6xl">
          {section === "employee" && <EmployeeSection />}
          {section === "payroll" && <PayrollSection />}
          {section === "privacy" && <PrivacySection />}
        </div>
      </div>
    </>
  );
}
