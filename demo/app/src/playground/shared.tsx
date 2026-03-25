import { type ReactNode } from "react";

export function CodeBlock(properties: { code: string }) {
  return <pre className="code-block">{properties.code}</pre>;
}

export function Fact(properties: { label: string; value: string }) {
  return (
    <dl className="fact">
      <dt>{properties.label}</dt>
      <dd>{properties.value}</dd>
    </dl>
  );
}

export function Panel(properties: { children: ReactNode; title: string }) {
  return (
    <article className="panel">
      <h3>{properties.title}</h3>
      {properties.children}
    </article>
  );
}

function MessageList(properties: {
  emptyMessage: string;
  items?: string[] | undefined;
}) {
  if (!properties.items?.length) {
    return <p className="panel-copy">{properties.emptyMessage}</p>;
  }

  return (
    <ul className="list">
      {properties.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function NoteGroup(properties: {
  emptyMessage: string;
  items?: string[] | undefined;
  title: string;
}) {
  return (
    <section className="note-group">
      <h4>{properties.title}</h4>
      <MessageList
        emptyMessage={properties.emptyMessage}
        items={properties.items}
      />
    </section>
  );
}

export function Shell(properties: {
  children?: ReactNode;
  subtitle: string;
  title: string;
}) {
  if (!properties.children) {
    return (
      <main className="shell">
        <header className="header">
          <p className="eyebrow">{properties.subtitle}</p>
          <h1>{properties.title}</h1>
        </header>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="header">
        <p className="eyebrow">{properties.subtitle}</p>
        <h1>{properties.title}</h1>
      </header>
      {properties.children}
    </main>
  );
}

export function Status(properties: { value: string }) {
  return <div className={`status status-${properties.value}`}>{properties.value}</div>;
}

export function ToggleButton(properties: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={properties.active}
      className={`toggle-button${properties.active ? " toggle-button-active" : ""}`}
      onClick={properties.onClick}
      type="button"
    >
      {properties.label}
    </button>
  );
}

export function shortHex(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
