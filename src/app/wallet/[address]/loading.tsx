// Stable report skeleton: header, value + flags, then the A-team grid. Matches
// the report layout so the modules appear to assemble in place, no shift.
export default function WalletLoading() {
  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <div className="space-y-2">
        <div className="skeleton h-3 w-40 rounded" />
        <div className="skeleton h-10 w-64 rounded" />
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel space-y-3 p-6">
          <div className="skeleton h-3 w-36 rounded" />
          <div className="skeleton h-10 w-56 rounded" />
          <div className="skeleton h-3 w-3/4 rounded" />
        </div>
        <div className="panel space-y-3 p-6">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      </div>
      <div className="mt-8 space-y-3">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel flex items-center gap-3 p-3">
              <div className="skeleton h-12 w-12 rounded-md" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-32 rounded" />
                <div className="skeleton h-2 w-full rounded-full" />
              </div>
              <div className="skeleton h-8 w-12 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
