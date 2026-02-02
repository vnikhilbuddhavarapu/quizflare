type Props = {
  options: string[];
  disabled: boolean;
  onSelect: (choiceIndex: number) => void;
  selectedIndex?: number | null;
  correctIndex?: number | null;
};

export function AnswerGrid({ options, disabled, onSelect, selectedIndex = null, correctIndex = null }: Props) {
  return (
    <div className="answerGrid">
      {options.map((opt, i) => (
        <button
          key={i}
          className={
            correctIndex != null
              ? i === correctIndex
                ? "answerOption answerOptionCorrect"
                : selectedIndex != null && i === selectedIndex
                  ? "answerOption answerOptionWrong"
                  : "answerOption"
              : selectedIndex != null && i === selectedIndex
                ? "answerOption answerOptionSelected"
                : "answerOption"
          }
          onClick={() => onSelect(i)}
          disabled={disabled}
          type="button"
        >
          <span className="answerOptionBadge">{String.fromCharCode(65 + (i % 26))}</span>
          <span className="answerOptionText">{opt}</span>
        </button>
      ))}
    </div>
  );
}
