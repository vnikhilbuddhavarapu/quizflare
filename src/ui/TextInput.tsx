type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
};

export function TextInput({ label, value, onChange, placeholder, inputMode = "text", maxLength }: Props) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      <input
        className={inputMode === "numeric" ? "input mono" : "input"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
      />
    </div>
  );
}
