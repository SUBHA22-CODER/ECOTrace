import React from 'react';

export default function TiltCard({ children, className = '', maxTilt, glare, ...props }) {
  return (
    <div
      className={`eleven-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
