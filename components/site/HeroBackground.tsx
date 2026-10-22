"use client";

import { useEffect, useState } from "react";
import { getImageProps } from "next/image";

// Only ever mounts ONE hero image at a time (not all of them stacked with
// opacity-0) — measured via Lighthouse that stacking all 4 competed for
// mobile bandwidth with the one image that actually needs to paint first.
//
// The fade-in animation is deliberately skipped on the very first image:
// Chrome doesn't count an element as "painted" for LCP until its opacity
// animation has progressed, so animating the FIRST hero image in from
// opacity:0 was adding ~1.3s of pure LCP delay for a purely cosmetic effect
// nobody sees anyway (there's nothing to fade in from on initial load).
// Only rotations after that get the fade.
//
// Portrait screens (phones) show the tall `mobile` photos and landscape
// screens the wide `desktop` ones, through one <picture>, so each device
// downloads only its own. No mobile list → the desktop photos everywhere.
export default function HeroBackground({ images, mobileImages = [] }: { images: string[]; mobileImages?: string[] }) {
  const tall = mobileImages.length ? mobileImages : images;
  const slides = Math.max(images.length, tall.length);
  const [active, setActive] = useState(0);
  const [hasRotated, setHasRotated] = useState(false);

  useEffect(() => {
    if (slides <= 1) return;
    const interval = setInterval(() => {
      setActive((i) => (i + 1) % slides);
      setHasRotated(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [slides]);

  if (!slides) return null;
  const first = active === 0;
  const common = { alt: "", fill: true, sizes: "100vw", fetchPriority: first ? "high" : "auto", loading: first ? "eager" : "lazy" } as const;
  const { props: { srcSet: wideSet } } = getImageProps({ ...common, src: images[active % images.length] ?? tall[0] });
  const { props: tallProps } = getImageProps({ ...common, src: tall[active % tall.length] });

  return (
    <picture key={active}>
      <source media="(orientation: landscape)" srcSet={wideSet} sizes="100vw" />
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- getImageProps fills src/srcSet/alt for art direction */}
      <img {...tallProps} className={`object-cover ${hasRotated ? "animate-hero-fade" : ""}`} />
    </picture>
  );
}
