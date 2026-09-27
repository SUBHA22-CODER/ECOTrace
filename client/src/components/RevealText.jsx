import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

// ─── Helper Functions ─────────────────────────────────────────────────────────

function cn(...inputs) {
  return inputs
    .filter((val) => typeof val === 'string' && val.trim().length > 0)
    .join(' ');
}

function splitTextIntoWords(input) {
  if (!input) return [];
  return input.trim().split(/\s+/);
}

function getFontSize(size = 'display') {
  switch (size) {
    case 'sm':      return 'clamp(0.875rem, 1.5vw, 1.125rem)';
    case 'base':    return 'clamp(1rem, 2vw, 1.375rem)';
    case 'lg':      return 'clamp(1.375rem, 3vw, 2rem)';
    case 'xl':      return 'clamp(1.75rem, 4vw, 2.75rem)';
    case '2xl':
    case 'display': return 'clamp(2rem, 5vw, 4rem)';
    case 'huge':    return 'clamp(2.5rem, 7vw, 5.5rem)';
    default:        return size;
  }
}

function getLineHeight(size = 'display') {
  switch (size) {
    case 'sm':   return 1.6;
    case 'base': return 1.5;
    case 'lg':   return 1.35;
    default:     return 1.2;
  }
}

function createRevealVariants({ stagger = 0.045, delay = 0, duration = 0.8, yOffset = 24, blur = 10 }) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  };
  const childVariants = {
    hidden: {
      opacity: 0,
      y: yOffset,
      filter: typeof blur === 'number' ? `blur(${blur}px)` : `blur(${blur})`,
    },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration, ease: [0.215, 0.61, 0.355, 1] },
    },
  };
  return { containerVariants, childVariants };
}

// ─── Motion element map ───────────────────────────────────────────────────────

const MOTION_ELEMENTS = {
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  p: motion.p,
  span: motion.span,
  div: motion.div,
};

// ─── RevealText Component ─────────────────────────────────────────────────────

export default function RevealText({
  text,
  children,
  className,
  size = 'display',
  as = 'h2',
  delay = 0,
  duration = 0.8,
  stagger = 0.045,
  yOffset = 24,
  blur = 10,
  once = true,
  viewportMargin = '-10% 0px',
  style,
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once, margin: viewportMargin });

  const rawText = typeof children === 'string' ? children : text || '';
  const words = splitTextIntoWords(rawText);

  const { containerVariants, childVariants } = createRevealVariants({
    stagger, delay, duration, yOffset, blur,
  });

  const MotionComponent = MOTION_ELEMENTS[as] || motion.h2;
  const fontSize = getFontSize(size);
  const lineHeight = getLineHeight(size);

  return (
    <MotionComponent
      ref={ref}
      variants={containerVariants}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      className={cn(
        'reveal-text-container',
        className
      )}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize,
        lineHeight,
        letterSpacing: '-0.02em',
        width: '100%',
        maxWidth: 'min(92vw, 68rem)',
        marginLeft: 'auto',
        marginRight: 'auto',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          variants={childVariants}
          style={{
            display: 'inline-block',
            marginRight: '0.24em',
            willChange: 'transform, opacity, filter',
          }}
        >
          {word}
        </motion.span>
      ))}
    </MotionComponent>
  );
}
