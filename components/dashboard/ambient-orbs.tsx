"use client"

import { useEffect, useState } from "react"

const ORBS = [
  {
    className: "ambient-orb top-[12%] left-[18%] size-3 bg-pink-300/80",
    delay: "0s",
  },
  {
    className: "ambient-orb top-[22%] right-[14%] size-2.5 bg-emerald-300/70",
    delay: "1.6s",
  },
  {
    className: "ambient-orb right-[28%] bottom-[18%] size-2 bg-sky-300/70",
    delay: "3.2s",
  },
  {
    className: "ambient-orb bottom-[28%] left-[8%] size-4 bg-pink-200/40 blur-md",
    delay: "2.1s",
  },
] as const

/**
 * Soft floating pastel dots behind the dashboard, matching the 3D
 * banking reference (lavender, mint, and a smaller green spark).
 * Client-only after mount so CSS animation transforms cannot desync
 * from the server HTML (React hydration #441).
 */
export const AmbientOrbs = () => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {ORBS.map((orb) => (
        <span
          key={orb.delay}
          className={orb.className}
          style={{ animationDelay: orb.delay }}
        />
      ))}
    </div>
  )
}
