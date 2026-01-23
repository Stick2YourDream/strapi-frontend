type ReactionPickerProps = {
  onPick: (emoji: string) => void;
  className?: string;
};

const REACTIONS = [
  "\u{1F44D}",
  "\u{1F602}",
  "\u{1F970}",
  "\u{1F929}",
  "\u{1F60E}",
  "\u{1F64C}",
  "\u{1F44F}",
  "\u{1F525}",
  "\u{1F389}",
  "\u{1F4AA}",
  "\u{1F91D}",
  "\u{1F31F}",
  "\u2764\uFE0F",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F92F}",
];

export default function ReactionPicker({ onPick, className }: ReactionPickerProps) {
  return (
    <div className={`post-reaction-picker${className ? ` ${className}` : ""}`}>
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          className="post-reaction-emoji"
          type="button"
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
