"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Colour of the eye button, to suit a light or dark box. */
  toggleClassName?: string;
  /** Spacing (margins) for the box — kept off the input so the eye stays centred. */
  wrapperClassName?: string;
};

/**
 * A password box with an eye button to show what's been typed, so a typo or
 * Caps Lock can be spotted before signing in. It starts hidden and hides
 * again as soon as focus leaves the box (e.g. tapping Sign in), so it's never
 * left showing on a shared screen. Not for 4-digit PINs.
 */
export function PasswordInput({ className = "", toggleClassName = "text-neutral-500 hover:text-neutral-800", wrapperClassName = "", onBlur, ...props }: Props) {
  const [shown, setShown] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...props}
        type={shown ? "text" : "password"}
        // Shown passwords mustn't be auto-corrected or capitalised.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onBlur={(e) => {
          if (e.relatedTarget !== toggle.current) setShown(false);
          onBlur?.(e);
        }}
        className={`${className} pr-11`}
      />
      <button
        ref={toggle}
        type="button"
        // Keep the keyboard up and the cursor in the box on phones.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center ${toggleClassName}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}
