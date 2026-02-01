type Props = {
  value: string;
};

export function PhasePill({ value }: Props) {
  return <span className="pill">{value}</span>;
}
