import Link from "next/link";
import { ownerDisplay } from "@/lib/format";

// The one component every HTML surface uses to render a wallet owner: shows the
// resolved username when present, the truncated address otherwise, and always
// links to the canonical /wallet/{address} (the address stays the id; the
// username is only the label). Pass the raw username via `name` (from the DTO,
// resolved in the data layer); omit it and it safely shows the truncated address.
export default function OwnerLabel({
  address,
  name,
  className,
  title,
}: {
  address: string;
  name?: string | null;
  className?: string;
  title?: string;
}) {
  return (
    <Link href={`/wallet/${address}`} className={className} title={title ?? address}>
      {ownerDisplay(name, address)}
    </Link>
  );
}
