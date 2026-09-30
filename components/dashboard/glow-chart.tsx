type GlowChartProps = {
  values: number[]
  labels?: string[]
  height?: number
}

const buildSmoothPath = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = (current.x + next.x) / 2
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`
  }
  return path
}

/**
 * Sleek glowing area chart used on Analytics (and optionally Overview).
 * Pure SVG — no charting library — so it stays server-component friendly
 * and matches the dark tooltip / violet-magenta gradient spec without
 * adding a new dependency.
 */
export const GlowChart = ({
  values,
  labels,
  height = 168,
}: GlowChartProps) => {
  const width = 640
  const paddingX = 12
  const paddingY = 16
  const series = values.length > 0 ? values : [0, 0]
  const maxValue = Math.max(1, ...series)

  const points = series.map((value, index) => {
    const x =
      paddingX +
      (index / Math.max(1, series.length - 1)) * (width - paddingX * 2)
    const y =
      paddingY +
      (1 - value / maxValue) * (height - paddingY * 2)
    return { x, y, value, label: labels?.[index] }
  })

  const linePath = buildSmoothPath(points)
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
  const gradientId = `glow-chart-fill-${series.join("-")}`
  const strokeId = `glow-chart-stroke-${series.join("-")}`
  const blurId = `glow-chart-blur-${series.join("-")}`

  return (
    <div className="relative w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label="Lease expiration distribution"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.667 0.295 322.15)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="oklch(0.606 0.25 292.717)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.606 0.25 292.717)" />
            <stop offset="100%" stopColor="oklch(0.72 0.28 322.15)" />
          </linearGradient>
          <filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="3"
          strokeLinecap="round"
          filter={`url(#${blurId})`}
          opacity="0.7"
        />
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <g key={`${point.x}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r="7"
              className="fill-violet-400/20"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r="3.5"
              className="fill-zinc-50"
            >
              <title>
                {point.label
                  ? `${point.label}: ${point.value}`
                  : String(point.value)}
              </title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  )
}
