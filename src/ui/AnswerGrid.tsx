import { Button } from "./Button";

type Props = {
  options: string[];
  disabled: boolean;
  onSelect: (choiceIndex: number) => void;
};

export function AnswerGrid({ options, disabled, onSelect }: Props) {
  return (
    <div className="answerGrid">
      {options.map((opt, i) => (
        <Button key={i} onClick={() => onSelect(i)} disabled={disabled} variant="secondary">
          {opt}
        </Button>
      ))}
    </div>
  );
}
