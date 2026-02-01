import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle: string;
  badge: string;
  children: ReactNode;
};

export function AppShell({ title, subtitle, badge, children }: Props) {
  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">{title}</div>
          <div className="subtitle">{subtitle}</div>
        </div>
        <div className="badge">{badge}</div>
      </header>
      {children}
    </div>
  );
}
