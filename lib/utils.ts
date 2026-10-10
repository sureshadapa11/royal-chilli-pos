import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

// Staff hours always read as hours and minutes ("9h 49m"), never 9.82 —
// the same everywhere in the Staff Hub and the attendance app.
export function hoursMinutes(hours: number | null | undefined): string {
  const mins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// UK mobile numbers only: starts with 07, 11 digits total (e.g. 07123456789).
// Strips spaces/dashes before checking, so "07123 456789" also passes.
export function isValidUkMobile(phone: string): boolean {
  return /^07\d{9}$/.test(phone.replace(/[\s-]/g, ""));
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isHappyHour(): boolean {
  const now = new Date();
  const hours = now.getHours();
  return hours >= 16 && hours < 19; // 4pm - 7pm
}

export function isBreakfastTime(): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const breakfastStart = 7 * 60; // 7:00am
  const breakfastEnd = 11 * 60 + 30; // 11:30am

  // Mon-Fri (1-5)
  return day >= 1 && day <= 5 && timeInMinutes >= breakfastStart && timeInMinutes < breakfastEnd;
}

export function getTimeElapsed(dateStr: string): string {
  const now = new Date();
  const created = new Date(dateStr);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}h ${mins}m ago`;
}

// A table occupied longer than this without being cleared/paid is flagged
// for staff attention (unattended guests, forgotten bill, stalled kitchen).
export const TABLE_ATTENTION_MINUTES = 45;

export function minutesSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export function tableElapsedLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
