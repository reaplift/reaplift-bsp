/** A menu page whose screen is not built yet. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <p className="empty-state">This page is coming soon.</p>
    </div>
  );
}
