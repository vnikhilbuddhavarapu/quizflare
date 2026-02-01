type Props = {
  lines: string[];
};

export function LogPanel({ lines }: Props) {
  return (
    <section className="panel">
      <div className="panelTitle">Logs</div>
      <div className="logs">
        {lines.length === 0 ? <div className="muted">No logs yet.</div> : lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </section>
  );
}
