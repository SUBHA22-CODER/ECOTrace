"use client";

import { useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { motion, useInView } from "framer-motion";
import type { Variants } from "framer-motion";

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Lightweight class name combiner (no external dependencies required).
 */
export function cn(...inputs: (string | number | boolean | undefined | null)[]): string {
  return inputs
    .filter((val): val is string => typeof val === "string" && val.trim().length > 0)
    .join(" ");
}

/**
 * Splits a text string into an array of words while trimming excess whitespace.
 */
export function splitTextIntoWords(input: string): string[] {
  if (!input) return [];
  return input.trim().split(/\s+/);
}

/**
 * Returns fluid, responsive font-size clamp values across all screen sizes.
 * Scales fluidly from mobile (<640px) to tablet (768px-1024px) to desktop (1280px+).
 */
export function getFontSize(size: string = "display"): string {
  switch (size) {
    case "sm":
      return "clamp(0.875rem, 1.5vw, 1.125rem)";
    case "base":
      return "clamp(1rem, 2vw, 1.375rem)";
    case "lg":
      return "clamp(1.375rem, 3vw, 2rem)";
    case "xl":
      return "clamp(1.75rem, 4vw, 2.75rem)";
    case "2xl":
    case "display":
      // Big, bold, fluid typography that scales seamlessly from 320px mobile to 4k desktop
      return "clamp(2rem, 5vw, 4rem)";
    case "huge":
      return "clamp(2.5rem, 7vw, 5.5rem)";
    default:
      return size;
  }
}

/**
 * Returns ideal proportional line-height based on font scale.
 */
export function getLineHeight(size: string = "display"): number {
  switch (size) {
    case "sm":
      return 1.6;
    case "base":
      return 1.5;
    case "lg":
      return 1.35;
    case "xl":
    case "2xl":
    case "display":
    case "huge":
    default:
      return 1.2;
  }
}

/**
 * Generates framer-motion variants for container stagger and child blur/slide-up.
 */
export function createRevealVariants({
  stagger = 0.045,
  delay = 0,
  duration = 0.8,
  yOffset = 24,
  blur = 10,
}: {
  stagger?: number;
  delay?: number;
  duration?: number;
  yOffset?: number;
  blur?: number | string;
}) {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
  };

  const childVariants: Variants = {
    hidden: {
      opacity: 0,
      y: yOffset,
      filter: typeof blur === "number" ? `blur(${blur}px)` : `blur(${blur})`,
    },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        duration,
        ease: [0.215, 0.61, 0.355, 1],
      },
    },
  };

  return { containerVariants, childVariants };
}

// ─── Component Props ──────────────────────────────────────────────────────────

export interface RevealTextProps {
  /** The text string to reveal with blur & stagger. Can also be passed as children. */
  text?: string;
  /** Children can be passed as a string or element. */
  children?: ReactNode;
  /** Custom class names to merge onto the container. */
  className?: string;
  /** Size preset or CSS font-size string. Defaults to "display" (responsive clamp(2rem, 5vw, 4rem)). */
  size?: "sm" | "base" | "lg" | "xl" | "2xl" | "display" | "huge" | (string & {});
  /** HTML element type to render. Defaults to "h2". */
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";
  /** Delay in seconds before animation begins. Defaults to 0. */
  delay?: number;
  /** Duration of each word's reveal animation in seconds. Defaults to 0.8. */
  duration?: number;
  /** Stagger interval between words in seconds. Defaults to 0.045. */
  stagger?: number;
  /** Starting vertical offset for the slide-up effect in px. Defaults to 24. */
  yOffset?: number;
  /** Blur intensity in pixels (e.g. 10 or "10px"). Defaults to 10. */
  blur?: number | string;
  /** Whether the reveal animation triggers only once when entering viewport. Defaults to true. */
  once?: boolean;
  /** Viewport margin for the scroll-trigger observer. Defaults to "-10% 0px". */
  viewportMargin?: string;
  /** Optional inline styles. */
  style?: CSSProperties;
}

const MOTION_ELEMENTS = {
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  p: motion.p,
  span: motion.span,
  div: motion.div,
} as const;

// ─── Main Component ───────────────────────────────────────────────────────────

export const RevealText = ({
  text,
  children,
  className,
  size = "display",
  as = "h2",
  delay = 0,
  duration = 0.8,
  stagger = 0.045,
  yOffset = 24,
  blur = 10,
  once = true,
  viewportMargin = "-10% 0px",
  style,
}: RevealTextProps) => {
  const ref = useRef<HTMLElement | null>(null);
  const isInView = useInView(ref, {
    once,
    margin: viewportMargin as any,
  });

  const rawText = typeof children === "string" ? children : text || "";
  const words = splitTextIntoWords(rawText);

  const { containerVariants, childVariants } = createRevealVariants({
    stagger,
    delay,
    duration,
    yOffset,
    blur,
  });

  const MotionComponent = MOTION_ELEMENTS[as] || motion.h2;
  const fontSize = getFontSize(size);
  const lineHeight = getLineHeight(size);

  return (
    <MotionComponent
      ref={ref as any}
      variants={containerVariants}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      className={cn(
        "flex flex-wrap items-center justify-center text-center font-semibold tracking-tight w-full max-w-5xl mx-auto px-4 text-white",
        className
      )}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize,
        lineHeight,
        letterSpacing: "-0.02em",
        width: "100%",
        maxWidth: "min(92vw, 68rem)",
        marginLeft: "auto",
        marginRight: "auto",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          variants={childVariants}
          style={{
            display: "inline-block",
            marginRight: "0.24em",
            willChange: "transform, opacity, filter",
          }}
        >
          {word}
        </motion.span>
      ))}
    </MotionComponent>
  );
};

export default RevealText;

// ─── Standalone Demo Component (for 21st.dev & interactive preview) ───────────

export function RevealTextDemo() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "#09090b",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(1.5rem, 4vw, 4rem) 1rem",
        gap: "clamp(2rem, 5vw, 4rem)",
        fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      {/* Subtle Eyebrow */}
      <RevealText
        size="sm"
        as="p"
        stagger={0.02}
        className="uppercase tracking-widest text-emerald-400 font-semibold"
        style={{ color: "#34d399", letterSpacing: "0.18em", maxWidth: "40rem" }}
      >
        Fluid Typography • Framer Motion
      </RevealText>

      {/* Main Big Responsive Headline */}
      <RevealText
        size="display"
        as="h1"
        stagger={0.05}
        delay={0.15}
        duration={0.85}
        className="font-bold text-white max-w-4xl"
      >
        Every great developer was once a beginner who refused to give up.
      </RevealText>

      {/* Responsive Supporting Subtext */}
      <RevealText
        size="base"
        as="p"
        stagger={0.03}
        delay={0.35}
        className="text-neutral-400 max-w-2xl font-normal"
        style={{ color: "#a1a1aa", lineHeight: 1.6 }}
      >
        Craft is the invisible detail that separates work that merely functions from work that people remember.
      </RevealText>
    </div>
  );
}
