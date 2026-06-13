import Link from "next/link";
import type { Metadata } from "next";
import Panel from "@/components/ui/Panel";
import DryRun from "@/components/autoracer/DryRun";
import { GUARD_CONTRACTS } from "@/lib/autoracer/guard";

export const metadata: Metadata = {
  title: "Auto-racer",
  description: "The optional XP auto-racer, in simulation. It signs exactly one kind of transaction, a zero-value free-race entry, and nothing else. Proven by a signer-rejection test.",
};

const INVARIANTS = [
  "Signs exactly one function: joinRace, a free-race entry, and nothing else.",
  "Never approve, setApprovalForAll, transfer, or permit. Your Giglings never move.",
  "Never a nonzero value. Free races only; paid races are excluded and need a separate manual confirm.",
  "Every transaction passes the safety guard before signing; the guard refuses everything outside the allowlist.",
  "Per-transaction approval only. No batch pre-authorization, no session keys.",
  "Kill switch and a daily race-count cap. Auto mode starts OFF.",
];

export default function AutoRacerPage() {
  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      {/* The status banner: this build never signs. */}
      <div className="mb-8 rounded-lg border p-4" style={{ borderColor: "var(--gold)", background: "color-mix(in srgb, var(--gold) 8%, transparent)" }}>
        <p className="type-micro uppercase tracking-widest" style={{ color: "var(--gold)" }}>Simulation only · no key loaded · never signs</p>
        <p className="type-body mt-1 text-ink-soft">
          This deployment carries no private key and cannot sign or broadcast anything. It builds the transaction, runs the safety guard, and does a read-only simulation, so you can audit exactly what the signing path would do before any key is ever involved.
        </p>
      </div>

      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">The optional XP auto-racer</p>
        <h1 className="type-page-title mt-2 text-ink">It enters free races. It cannot touch your assets.</h1>
        <p className="type-body mt-3 text-ink-soft">
          The auto-racer&apos;s entire job is to sign one kind of transaction: a zero-value free-race entry. The racing contract only reads ownership, so a Gigling never moves and no approval is ever needed. This is proven on-chain in{" "}
          <Link href="/methodology" className="underline transition-paddock hover:text-glow">the methodology</Link>, and enforced in code by a guard that a signer-rejection test holds to account.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel eyebrow="Enforced invariants" title="What it will and will not do">
          <ul className="space-y-2.5">
            {INVARIANTS.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="asterisk mt-0.5 leading-none">✳</span>
                <span className="type-data text-ink-soft">{t}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="The allowlist" title="Two contracts, one function">
          <dl className="space-y-3">
            <div>
              <dt className="type-micro uppercase text-ink-faint">Racing contract (the only signing target)</dt>
              <dd className="type-data mt-0.5 break-all text-ink-soft">{GUARD_CONTRACTS.racing}</dd>
            </div>
            <div>
              <dt className="type-micro uppercase text-ink-faint">Giglings collection (read-only, never an approval target)</dt>
              <dd className="type-data mt-0.5 break-all text-ink-soft">{GUARD_CONTRACTS.giglings}</dd>
            </div>
            <div>
              <dt className="type-micro uppercase text-ink-faint">Allowed function</dt>
              <dd className="type-data mt-0.5 text-ink-soft">joinRace(uint256, uint256, bytes) · selector 0x168491e9</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel eyebrow="Dry run" title="Build a real entry and watch the guard check it" className="mt-6" note="Builds the joinRace transaction for a race and pet, runs every safety check, and simulates read-only. Nothing is signed.">
        <DryRun />
      </Panel>

      <p className="type-micro mt-8 normal-case text-ink-faint">
        The safety guard is enforced by a committed signer-rejection test that proves it refuses setApprovalForAll, approve, transfer, nonzero value, and any non-joinRace call. The full on-chain safety analysis and the re-runnable forensics harness are in SECURITY.md.
      </p>
    </div>
  );
}
