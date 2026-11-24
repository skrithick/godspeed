const rings = Array.from({ length: 25 }, (_, index) => {
  const radius = 30 + index * 23;
  const count = Math.round((2 * Math.PI * radius) / 24);
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i + (index % 2) * 0.5) * 2 * Math.PI) / count;
    return `${(600 + Math.cos(angle) * radius).toFixed(1)} ${(380 + Math.sin(angle) * radius).toFixed(1)}`;
  });
}).flat();

const dots = `M${rings.join("h0 M")}h0`;

export function RadialPattern() {
  return <svg className="workspace-pattern" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <path d={dots} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
  </svg>;
}
