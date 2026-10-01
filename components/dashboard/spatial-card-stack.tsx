import { cn } from "cn"

export type SpatialTone = "pink" | "mint" | "blue"

export type SpatialCard = {
  eyebrow: string
  title: string
  value: string
  tone: SpatialTone
}

const TONE_CLASS: Record<SpatialTone, string> = {
  pink: "spatial-card-pink",
  mint: "spatial-card-mint",
  blue: "spatial-card-blue",
}

type SpatialCardStackProps = {
  cards: SpatialCard[]
}

/**
 * Isometric stacked plastic cards — the signature 3D treatment from the
 * banking reference. Pure CSS perspective; no extra 3D library.
 */
export const SpatialCardStack = ({ cards }: SpatialCardStackProps) => {
  const layers = cards.slice(0, 3)

  return (
    <div className="spatial-scene relative w-full">
      <div className="spatial-stack">
        {layers.map((card, index) => (
          <article
            key={`${card.title}-${index}`}
            data-layer={index}
            className={cn("spatial-card", TONE_CLASS[card.tone])}
          >
            {index === 0 ? (
              <>
                <p className="text-[11px] font-medium tracking-[0.18em] uppercase opacity-70">
                  {card.eyebrow}
                </p>
                <p className="mt-5 font-heading text-2xl font-semibold tracking-tight">
                  {card.value}
                </p>
                <div className="mt-auto flex items-end justify-between pt-4">
                  <p className="text-sm font-medium">{card.title}</p>
                  <span className="flex items-center" aria-hidden>
                    <span className="size-5 rounded-full bg-zinc-800/35" />
                    <span className="-ml-2 size-5 rounded-full bg-zinc-800/20" />
                  </span>
                </div>
              </>
            ) : (
              <p className="sr-only">
                {card.title}: {card.value}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
