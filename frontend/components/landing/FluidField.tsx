interface FluidFieldProps {
  /** Extra classes merged onto the stage. */
  className?: string
  /** "hero" fills a full viewport; "banner" is a tighter header band. */
  variant?: "hero" | "banner"
  /** Specular silk sheen band. */
  sheen?: boolean
}

/**
 * High-performance, GPU-accelerated fluid orange field:
 * Uses pre-feathered radial gradients, reduced blur radii, and composite-only
 * transforms (translate3d/scale/rotate). Never animates non-composited properties
 * (like border-radius or blur) to ensure 60fps on low-end laptops and mobile phones
 * with near-zero CPU usage.
 */
export function FluidField({
  className = "",
  variant = "hero",
  sheen = true,
}: FluidFieldProps) {
  return (
    <div
      aria-hidden="true"
      className={`fluid-stage silk-weave ${variant === "banner" ? "fluid-banner" : ""} ${className}`}
    >
      <div className="fluid-field fluid-enter">
        <span className="fluid-blob fluid-blob-1" />
        <span className="fluid-blob fluid-blob-2" />
        {variant !== "banner" && <span className="fluid-blob fluid-blob-3" />}
        {sheen && <span className="fluid-sheen" />}
      </div>
    </div>
  )
}
