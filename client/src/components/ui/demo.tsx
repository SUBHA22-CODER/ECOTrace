"use client";

import RevealText from "./reveal-text";

export default function RevealTextDemo() {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-8 md:p-12 gap-8 bg-[#09090b] text-white overflow-x-hidden"
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(1.5rem, 5vw, 4rem) 1rem",
        gap: "clamp(1.5rem, 4vw, 3rem)",
        backgroundColor: "#09090b",
        color: "#ffffff",
        fontFamily: "'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center w-full max-w-5xl mx-auto">
        {/* Responsive Eyebrow */}
        <RevealText
          size="sm"
          as="p"
          stagger={0.02}
          className="uppercase tracking-widest font-mono font-semibold text-emerald-400"
          style={{ color: "#34d399", letterSpacing: "0.2em", maxWidth: "36rem" }}
        >
          Fluid Responsive Typography
        </RevealText>

        {/* Big Responsive Headline */}
        <RevealText
          size="display"
          as="h1"
          stagger={0.045}
          delay={0.15}
          duration={0.85}
          className="text-white font-bold max-w-4xl"
        >
          Every great developer was once a beginner who refused to give up.
        </RevealText>

        {/* Responsive Subtitle */}
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
    </div>
  );
}
