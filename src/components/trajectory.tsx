const orbits = Array.from({ length: 21 }, (_, index) => ({
  angle: -42 + index * 3.8,
  radius: 168 - index * 1.75,
  height: 27 + index * 1.9,
}));

export function Trajectory() {
  return <svg className="trajectory" viewBox="0 0 440 380" aria-hidden="true">
    <g fill="none" stroke="currentColor">
      <circle cx="220" cy="190" r="146" strokeWidth=".6" strokeDasharray="1 5" opacity=".34" />
      <path d="M220 21v338M51 190h338" strokeWidth=".65" strokeDasharray="2 6" opacity=".36" />
      {orbits.map(({ angle, radius, height }, index) => <ellipse key={angle} cx="220" cy="190" rx={radius} ry={height}
        transform={`rotate(${angle} 220 190)`} strokeWidth={index % 5 === 0 ? 1.2 : .7} opacity={index % 5 === 0 ? .68 : .42} />)}
      <path d="M288 114l30-32h33M87 250h-22m11-11v22M354 281h12m-6-6v12" strokeWidth=".85" opacity=".65" />
      <circle cx="288" cy="114" r="4" fill="var(--hero-bg)" />
      <circle cx="220" cy="190" r="15" fill="var(--hero-bg)" strokeWidth=".7" />
    </g>
    <path d="M220 179q.8 10.2 11 11-10.2.8-11 11-.8-10.2-11-11 10.2-.8 11-11Z" fill="currentColor" />
  </svg>;
}
