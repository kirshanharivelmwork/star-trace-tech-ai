"use client"

import { useCallback, useRef, useState } from "react"
import type { CSSProperties, MouseEvent, ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type MetricTileProps = {
  label: string
  value: string
  hint: string
  icon: ReactNode
}

const RESTING_TILT =
  "perspective(920px) rotateX(0deg) rotateY(0deg) translateZ(0)"

/**
 * 3D-tilt metric tile. Pointer tracking stays in this leaf client
 * component so pages can remain Server Components.
 */
export const MetricTile = ({ label, value, hint, icon }: MetricTileProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState<CSSProperties>({ transform: RESTING_TILT })

  const handleMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const node = ref.current
    if (!node) return

    const box = node.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    const rotateX = (0.5 - y) * 11
    const rotateY = (x - 0.5) * 14

    setTilt({
      transform: `perspective(920px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`,
    })
  }, [])

  const handleLeave = useCallback(() => {
    setTilt({ transform: RESTING_TILT })
  }, [])

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={tilt}
      className="metric-tilt transition-transform duration-200 ease-out will-change-transform"
    >
      <Card className="h-full">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">
            {label}
          </CardTitle>
          <span className="icon-well size-8">{icon}</span>
        </CardHeader>
        <CardContent>
          <div className="metric-value text-3xl text-zinc-50">{value}</div>
          <p className="mt-1 text-xs tracking-wide text-zinc-500">{hint}</p>
        </CardContent>
      </Card>
    </div>
  )
}
