import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
};

export function Button({ children, onClick, disabled, variant = "primary", type = "button" }: Props) {
  const className = variant === "primary" ? "btn" : variant === "secondary" ? "btn secondary" : "btn ghost";
  return (
    <button className={className} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  );
}
