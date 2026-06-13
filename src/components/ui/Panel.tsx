// A titled panel: mono eyebrow, optional note, bordered surface. The repeating
// container for dense data across the site. Generous padding around the data.
export default function Panel({
  eyebrow,
  title,
  note,
  children,
  className = "",
  style,
}: {
  eyebrow?: string;
  title?: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel p-5 md:p-6 ${className}`} style={style}>
      {(eyebrow || title) && (
        <header className="mb-4">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          {title && <h2 className="type-card-title text-ink">{title}</h2>}
          {note && <p className="type-micro mt-1 normal-case text-ink-faint">{note}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
