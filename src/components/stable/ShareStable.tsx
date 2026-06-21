"use client";

import { useState } from "react";
import type { StableSkill } from "@/lib/api/types";
import { formatPercentile } from "@/lib/format";

// Share trigger on the stable report: an honest pre-filled post (X intent), a
// copy-link action, and a download of the rendered card image. The post text
// never claims a rank the data does not support: a percentile only for ranked
// stables, a neutral line otherwise. No invented social handle, just the link.
export default function ShareStable({ address, skill }: { address: string; skill: StableSkill }) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/wallet/${address}` : `/wallet/${address}`;
  const text =
    skill.state === "ranked" && skill.percentile != null
      ? `My Gigling stable is ${formatPercentile(skill.percentile)} by proven roster quality on Paddock. Check yours:`
      : "My Gigling stable on Paddock. Check yours:";
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the X intent and download still work
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={intent}
        target="_blank"
        rel="noopener noreferrer"
        className="transition-paddock rounded-md px-4 py-2.5"
        style={{ background: "var(--action)", color: "#14110f" }}
      >
        <span className="type-data" style={{ color: "#14110f" }}>Share to X</span>
      </a>
      <button
        type="button"
        onClick={copyLink}
        className="transition-paddock rounded-md border px-4 py-2.5 text-ink-soft hover:text-ink hover:border-line-strong"
        style={{ borderColor: "var(--line-strong)" }}
      >
        <span className="type-data">{copied ? "Link copied" : "Copy link"}</span>
      </button>
      <a
        href={`/wallet/${address}/opengraph-image`}
        download={`paddock-stable-${address.slice(0, 8)}.png`}
        className="transition-paddock rounded-md border px-4 py-2.5 text-ink-soft hover:text-ink hover:border-line-strong"
        style={{ borderColor: "var(--line-strong)" }}
      >
        <span className="type-data">Download card</span>
      </a>
    </div>
  );
}
