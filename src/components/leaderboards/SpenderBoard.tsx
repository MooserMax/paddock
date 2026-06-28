import Link from "next/link";
import type { SpenderBoardData } from "@/lib/api/queries";
import { shortAddress, formatInt } from "@/lib/format";

// The on-chain top-spender board: who has spent the most native ETH buying items on the
// Gigaverse ItemMarketSystem. Ranked by total spend (integer-wei derived, shown precisely
// because item spends are tiny). Buyers only (transferredTo); a seller can never appear.
// Until the indexer has run, board is null and we show a clean "coming soon" rather than a
// broken or empty table, so the page never breaks while the pipeline warms up.
export default function SpenderBoard({ board }: { board: SpenderBoardData | null }) {
  if (!board || board.spenders.length === 0) {
    return (
      <div className="panel p-8 text-center">
        <p className="type-card-title text-ink">Top spenders, coming soon</p>
        <p className="type-body mx-auto mt-1 max-w-md text-ink-soft">
          The on-chain item-spend index is warming up. This board ranks wallets by total native ETH spent buying items on the Gigaverse marketplace. It will light up here as soon as the first index completes.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="type-micro mb-4 max-w-2xl normal-case leading-relaxed text-ink-faint">
        Wallets ranked by total native ETH spent on race consumables (dung &amp; butterfly) on the on-chain marketplace. Other marketplace items are excluded. Spends are small, shown to full precision rather than rounded away.
        {board.complete === false && (
          <span className="ml-1" style={{ color: "var(--gold)" }}>Indexing on-chain history now, these totals are partial and growing toward all-time.</span>
        )}
      </p>

      <div className="overflow-hidden rounded-lg border hairline">
        <div className="hidden items-center gap-4 border-b hairline bg-paper-raised px-4 py-2.5 sm:flex">
          <span className="type-micro w-8 uppercase tracking-wider text-ink-faint">#</span>
          <span className="type-micro flex-1 uppercase tracking-wider text-ink-faint">Spender</span>
          <span className="type-micro w-28 text-right uppercase tracking-wider text-ink-faint">Items</span>
          <span className="type-micro w-32 text-right uppercase tracking-wider text-ink-faint">Total spend</span>
        </div>
        {board.spenders.map((s, i) => (
          <div
            key={s.address}
            className="flex flex-col gap-1 border-b hairline px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4"
            style={{ background: i % 2 ? "transparent" : "color-mix(in srgb, var(--paper-raised) 40%, transparent)" }}
          >
            <span className="type-data hidden w-8 tabular-nums text-ink-faint sm:block">{s.rank}</span>
            <span className="type-data flex-1 truncate text-ink">
              {s.username ? (
                <Link href={`/wallet/${s.address}`} className="transition-paddock hover:text-glow">@{s.username}</Link>
              ) : (
                <Link href={`/wallet/${s.address}`} className="transition-paddock text-ink-soft hover:text-glow">{shortAddress(s.address)}</Link>
              )}
              {s.byItem.length > 0 && (
                <span className="type-micro ml-2 normal-case text-ink-faint">
                  top: {s.byItem[0].name ?? `Item #${s.byItem[0].itemId}`}
                </span>
              )}
            </span>
            <span className="type-data w-28 text-right tabular-nums text-ink-soft">{formatInt(s.itemsBought)}</span>
            <span className="type-data w-32 text-right tabular-nums" style={{ color: "var(--gold)" }}>{s.totalSpendEth} ETH</span>
          </div>
        ))}
      </div>

      <p className="type-micro mt-4 normal-case text-ink-faint">
        {formatInt(board.uniqueBuyers)} unique race-item spenders (dung + butterfly). Served by{" "}
        <Link href="/api/v1/item-leaderboard" className="underline transition-paddock hover:text-glow">/api/v1/item-leaderboard</Link>. Spend is native ETH, exact to the wei.
      </p>
    </>
  );
}
