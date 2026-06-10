import { db } from "../db";

export async function syncEthPrice(): Promise<{ usd: number }> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Coinbase API ${res.status}`);
  const json = (await res.json()) as { data: { amount: string } };
  const usd = Number(json.data.amount);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`Coinbase returned invalid price: ${json.data.amount}`);
  }

  const { error } = await db()
    .from("eth_price")
    .upsert({ id: 1, usd, updated_at: new Date().toISOString() });
  if (error) throw new Error(`eth_price upsert failed: ${error.message}`);
  return { usd };
}
