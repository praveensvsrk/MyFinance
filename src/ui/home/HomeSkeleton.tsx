/** Placeholder cards while the first Home query resolves. */
export function HomeSkeleton() {
  return (
    <div className="stack gap16" aria-busy="true" aria-label="Loading">
      <div className="sk r" style={{ height: 132 }} />
      <div className="sk r" style={{ height: 150 }} />
      <div className="sk r" style={{ height: 210 }} />
      <div className="sk r" style={{ height: 180 }} />
    </div>
  );
}
