// One-off: sync ETH price then pull OpenSea sales history for valuation comps.
// Run: npm run backfill:market
import { syncEthPrice } from "../src/lib/ingest/ethPrice";
import { syncSales } from "../src/lib/ingest/sales";

const price = await syncEthPrice();
console.log(`ETH price: $${price.usd}`);

const sales = await syncSales();
console.log(`sales: ${sales.inserted} inserted across ${sales.pages} page(s)`);
