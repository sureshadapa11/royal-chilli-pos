"use client";

import { useEffect, useState } from "react";

const SPLASH_KEY = "rc_splash_shown";
const DURATION_MS = 1200; // brief — it covers the page, so longer feels like slow loading
const FADE_MS = 300; // tail end of DURATION_MS spent fading out

export default function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  // Starts hidden (matches server render) and only appears after mount, once
  // per browser session — sessionStorage so it reappears on a fresh visit
  // (new tab/window) but not on every page navigation within one.
  useEffect(() => {
    let alreadyShown = true;
    try {
      alreadyShown = sessionStorage.getItem(SPLASH_KEY) === "1";
    } catch {
      // sessionStorage unavailable (private mode etc.) — just skip the splash
      // rather than risk showing it on every navigation.
    }
    if (alreadyShown) return;

    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // ignore — worst case the splash shows again next navigation
    }
    setVisible(true);
    document.body.style.overflow = "hidden";
    const fadeTimer = setTimeout(() => setFading(true), DURATION_MS - FADE_MS);
    const hideTimer = setTimeout(() => {
      setVisible(false);
      document.body.style.overflow = "";
    }, DURATION_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      document.body.style.overflow = "";
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0d0d0d] transition-opacity duration-300 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <img src="/splash.webp" alt="The Royal Chilli" className="w-[85vw] max-w-sm sm:max-w-md md:max-w-lg lg:max-w-2xl" />
      <div className="mt-8 h-[3px] w-48 overflow-hidden rounded-full bg-white/10 sm:w-64 md:w-72">
        <div className="h-full w-full origin-left scale-x-0 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 motion-safe:animate-[splash-load_0.9s_ease-in-out_forwards] motion-reduce:scale-x-100" />
      </div>
    </div>
  );
}
