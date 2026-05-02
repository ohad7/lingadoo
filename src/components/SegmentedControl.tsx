type SegmentedControlProps = {
  options: { value: string; label: string }[];
  value: string; // empty string = no selection (mixed)
  onChange: (value: string) => void;
  disabled?: boolean;
};

export default function SegmentedControl({ options, value, onChange, disabled }: SegmentedControlProps) {
  return (
    <div className="segmented-control">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
