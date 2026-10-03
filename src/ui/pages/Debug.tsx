/** Temporary placeholder body: shows a screen's hook data as JSON. Deleted with the real screens (Plan 3B). */
export function Debug({ title, query }: { title: string; query: { data: unknown; loading: boolean } }) {
  const text = query.loading ? 'loading' : (JSON.stringify(query.data, null, 2) ?? 'null');
  return (
    <section>
      <h2>{title}</h2>
      <pre className="debug" data-testid="debug">
        {text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text}
      </pre>
    </section>
  );
}
