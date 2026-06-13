// Skeleton that mirrors the dossier layout exactly so there is no layout shift
// when data arrives. Never a centered spinner on blank.
export default function PetLoading() {
  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <div className="grid gap-6 md:grid-cols-[200px_1fr] md:gap-8">
        <div className="skeleton aspect-square w-full rounded-lg" style={{ maxWidth: 200 }} />
        <div className="flex flex-col justify-between gap-6">
          <div className="space-y-3">
            <div className="skeleton h-10 w-2/3 rounded" />
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-2 w-full rounded-full" />
            <div className="skeleton h-3 w-3/4 rounded" />
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg md:grid-cols-4" style={{ background: "var(--line)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4" style={{ background: "var(--paper-raised)" }}>
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-7 w-16 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="panel space-y-4 p-6">
              <div className="skeleton h-4 w-32 rounded" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="skeleton h-8 w-full rounded" />
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel space-y-4 p-6">
              <div className="skeleton h-4 w-28 rounded" />
              <div className="skeleton h-20 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
