/**
 * Soft floating pastel dots behind the dashboard, matching the 3D
 * banking reference (lavender, mint, and a smaller green spark).
 */
export const AmbientOrbs = () => {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <span
        className="ambient-orb top-[12%] left-[18%] size-3 bg-pink-300/80"
        style={{ animationDelay: "0s" }}
      />
      <span
        className="ambient-orb top-[22%] right-[14%] size-2.5 bg-emerald-300/70"
        style={{ animationDelay: "1.6s" }}
      />
      <span
        className="ambient-orb right-[28%] bottom-[18%] size-2 bg-sky-300/70"
        style={{ animationDelay: "3.2s" }}
      />
      <span
        className="ambient-orb bottom-[28%] left-[8%] size-4 bg-pink-200/40 blur-md"
        style={{ animationDelay: "2.1s" }}
      />
    </div>
  )
}
