"use client";

import Image from "next/image";
import { useState } from "react";

// The dossier portrait. A Gigling can have no art yet (an unrevealed Duelborn) or a broken image
// URL; either way we render a designed placeholder (the Paddock asterisk mark on the dark card with
// an "ART REVEALS WITH RACING" micro-label) instead of the browser's broken-image glyph. Both the
// null-check and the onError fallback are handled so the broken icon can never appear.
export default function PetPortrait({ src, alt, size = 200 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;

  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded-lg border hairline"
      style={{ maxWidth: size, background: showPlaceholder ? "var(--paper)" : "var(--paper-sunken)" }}
    >
      {showPlaceholder ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-dotgrid">
          <span className="asterisk text-4xl leading-none" style={{ color: "var(--gold)" }} aria-hidden>
            ✳
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--ink-faint)" }}>
            Art reveals with racing
          </span>
        </div>
      ) : (
        <Image
          src={src as string}
          alt={alt}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          priority
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
