import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { formatInr } from '../../domain/money';
import type { IsoDate, Paise } from '../../parsers/types';
import { dateShort } from '../format';
import { VIEW_H, VIEW_W } from '../home/trendGeometry';

/**
 * Hover / touch-drag inspection for the SVG charts, like a stock app: a crosshair follows the
 * pointer, snaps to the nearest point and shows its date and value. Render inside the chart's <svg>.
 * Amounts stay hidden while `hidden` is set (only the date shows).
 */
export function ChartScrub({
  points,
  xy,
  hidden,
}: {
  points: { date: IsoDate; total: Paise }[];
  xy: { x: number; y: number }[];
  hidden: boolean;
}) {
  const overlay = useRef<SVGRectElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const move = (event: PointerEvent<SVGRectElement>): void => {
    const box = overlay.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const x = ((event.clientX - box.left) / box.width) * VIEW_W;
    let best = 0;
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].x - x) < Math.abs(xy[best].x - x)) best = i;
    setActive(best);
  };

  const point = active === null ? null : points[active];
  const at = active === null ? null : xy[active];
  const label = point === null ? '' : `${dateShort(point.date)} ${point.date.slice(0, 4)}${hidden ? '' : `  ·  ${formatInr(point.total, { compact: true })}`}`;
  const width = label.length * 6.4 + 12;
  const boxX = at === null ? 0 : Math.min(Math.max(at.x - width / 2, 0), VIEW_W - width);

  return (
    <g>
      {at !== null && (
        <g pointerEvents="none">
          <line x1={at.x} x2={at.x} y1={0} y2={VIEW_H - 22} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={at.x} cy={at.y} r="5" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="2" />
          <rect x={boxX} y={0} width={width} height={20} rx="6" fill="var(--surface)" stroke="var(--chart-grid)" />
          <text className="val" x={boxX + width / 2} y={14} textAnchor="middle" style={{ fontSize: 11 }}>
            {label}
          </text>
        </g>
      )}
      <rect
        ref={overlay}
        x={0}
        y={0}
        width={VIEW_W}
        height={VIEW_H}
        fill="transparent"
        style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
        onPointerDown={move}
        onPointerMove={move}
        onPointerLeave={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onPointerUp={(event) => {
          if (event.pointerType !== 'mouse') setActive(null);
        }}
      />
    </g>
  );
}
