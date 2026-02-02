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
        <div className="brand">
          <div className="brandMark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 3C7.029 3 3 7.029 3 12c0 4.971 4.029 9 9 9s9-4.029 9-9c0-4.971-4.029-9-9-9Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path d="M8.25 13.25 11 16l4.75-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="title">{title}</div>
            <div className="subtitle">{subtitle}</div>
          </div>
        </div>
        <div className="badge">{badge}</div>
      </header>
      {children}
    </div>
  );
}
