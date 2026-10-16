import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import "./training-select.css";

type Option = { value: string; label: string };

export function TrainingSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [above, setAbove] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const show = () => {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect)
      setAbove(
        innerHeight - rect.bottom < options.length * 44 + 24 &&
          rect.top > innerHeight - rect.bottom,
      );
    setActive(selected);
    setOpen(true);
  };
  const choose = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      if (!open) {
        show();
        if (event.key === "Home") setActive(0);
        if (event.key === "End") setActive(options.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") choose(active);
      else
        setActive(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (active +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  options.length) %
                options.length,
        );
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div
      className="training-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label id={id + "-label"} htmlFor={id + "-trigger"}>
        {label}
      </label>
      <button
        id={id + "-trigger"}
        ref={trigger}
        type="button"
        className="training-select-trigger"
        role="combobox"
        aria-labelledby={id + "-label " + id + "-value"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id + "-list" : undefined}
        aria-activedescendant={open ? id + "-option-" + active : undefined}
        disabled={disabled}
        onKeyDown={keyboard}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span id={id + "-value"}>{options[selected].label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id + "-list"}
          role="listbox"
          aria-labelledby={id + "-label"}
          className={"training-select-menu" + (above ? " opens-above" : "")}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={id + "-option-" + index}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className={active === index ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
