import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

export interface BarChartProps {
  /** Bar heights (probabilities) indexed by k. */
  values: number[];
  /** Optional step line (e.g. P(X >= k)) drawn on the same x axis, range 0..1. */
  stepLine?: number[];
  /** Vertical marker (e.g. the mean). */
  marker?: number;
  markerLabel?: string;
  /** Shaded x-range, inclusive (e.g. p5..p95). */
  shade?: { from: number; to: number };
  /** Max index to draw (defaults to the last index with non-negligible mass). */
  maxIndex?: number;
  xLabel: string;
  yLabel: string;
  /** Tooltip lines for a given k. */
  tooltip: (k: number) => string[];
  ariaLabel: string;
  height?: number;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function trimIndex(values: number[], eps = 0.0005): number {
  let last = values.length - 1;
  while (last > 0 && (values[last] ?? 0) < eps) last--;
  return Math.max(last, 1);
}

const PAD = { l: 38, r: 10, t: 12, b: 28 };

export function BarChart(props: BarChartProps) {
  const { values, stepLine, marker, markerLabel, shade, xLabel, yLabel, tooltip, ariaLabel } = props;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | undefined>(undefined);
  const height = props.height ?? 220;
  const maxK = props.maxIndex ?? trimIndex(values);
  const n = maxK + 1;
  const innerW = Math.max(10, width - PAD.l - PAD.r);
  const innerH = Math.max(10, height - PAD.t - PAD.b);
  const yMax = useMemo(() => {
    let m = 0;
    for (let k = 0; k <= maxK; k++) m = Math.max(m, values[k] ?? 0);
    return m > 0 ? m : 1;
  }, [values, maxK]);
  const bw = innerW / n;
  const x = (k: number) => PAD.l + k * bw;
  const y = (p: number) => PAD.t + innerH - (p / yMax) * innerH;
  const yStep = (p: number) => PAD.t + innerH - p * innerH;

  const ticks = useMemo(() => {
    const step = n <= 12 ? 1 : n <= 30 ? 2 : n <= 60 ? 5 : n <= 120 ? 10 : 20;
    const out: number[] = [];
    for (let k = 0; k <= maxK; k += step) out.push(k);
    return out;
  }, [n, maxK]);

  const yTicks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push((yMax * i) / 4);
    return out;
  }, [yMax]);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.l;
    const k = Math.floor(px / bw);
    setHover(k >= 0 && k <= maxK ? k : undefined);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(maxK, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 1) - 1));
    else if (e.key === "Escape") setHover(undefined);
    else return;
    e.preventDefault();
  };

  const tipLines = hover !== undefined ? tooltip(hover) : [];
  const tipLeft = hover !== undefined ? Math.min(x(hover) + bw / 2 + 8, Math.max(0, width - 170)) : 0;

  return (
    <div className="chart-wrap" ref={wrapRef} tabIndex={0} role="img" aria-label={ariaLabel} onKeyDown={onKey} onBlur={() => setHover(undefined)}>
      {width > 0 ? (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)}>
          {shade ? <rect x={x(Math.max(0, shade.from))} y={PAD.t} width={Math.max(0, x(Math.min(maxK, shade.to) + 1) - x(Math.max(0, shade.from)))} height={innerH} fill="var(--chart-shade)" /> : null}
          {yTicks.map((p) => (
            <g key={p}>
              <line x1={PAD.l} x2={PAD.l + innerW} y1={y(p)} y2={y(p)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.l - 4} y={y(p) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">
                {(p * 100).toFixed(p * 100 >= 10 ? 0 : 1)}%
              </text>
            </g>
          ))}
          {Array.from({ length: n }, (_, k) => {
            const v = values[k] ?? 0;
            const h = (v / yMax) * innerH;
            const dim = shade ? k < shade.from || k > shade.to : false;
            return <rect key={k} x={x(k) + 1} y={PAD.t + innerH - h} width={Math.max(1, bw - 2)} height={h} fill={hover === k ? "var(--brass)" : dim ? "var(--chart-bar-dim)" : "var(--chart-bar)"} />;
          })}
          {stepLine ? (
            <path
              d={Array.from({ length: n }, (_, k) => {
                const p = Math.max(0, Math.min(1, stepLine[k] ?? 0));
                return `${k === 0 ? "M" : "L"}${x(k)},${yStep(p)} L${x(k + 1)},${yStep(p)}`;
              }).join(" ")}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
          ) : null}
          {marker !== undefined && marker >= 0 && marker <= maxK + 1 ? (
            <g>
              <line x1={x(marker) + bw / 2} x2={x(marker) + bw / 2} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--brass)" strokeWidth={1.5} />
              {markerLabel ? (
                <text x={Math.min(x(marker) + bw / 2 + 4, width - 40)} y={PAD.t + 9} fontSize={9} fill="var(--brass)">
                  {markerLabel}
                </text>
              ) : null}
            </g>
          ) : null}
          <line x1={PAD.l} x2={PAD.l + innerW} y1={PAD.t + innerH} y2={PAD.t + innerH} stroke="var(--border-strong)" />
          {ticks.map((k) => (
            <text key={k} x={x(k) + bw / 2} y={PAD.t + innerH + 12} textAnchor="middle" fontSize={9} fill="var(--muted)">
              {k}
            </text>
          ))}
          <text x={PAD.l + innerW / 2} y={height - 3} textAnchor="middle" fontSize={9} fill="var(--muted)">
            {xLabel}
          </text>
          <text x={10} y={PAD.t + innerH / 2} textAnchor="middle" fontSize={9} fill="var(--muted)" transform={`rotate(-90 10 ${PAD.t + innerH / 2})`}>
            {yLabel}
          </text>
        </svg>
      ) : null}
      {hover !== undefined && tipLines.length ? (
        <div className="chart-tip" style={{ left: tipLeft, top: PAD.t }}>
          {tipLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
