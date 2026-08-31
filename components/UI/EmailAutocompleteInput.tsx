"use client";

import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
} from "react";

const EMAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com.br",
  "yahoo.com",
  "live.com",
  "icloud.com",
  "me.com",
  "msn.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "hotmail.com.br",
  "live.com.br",
  "oi.com.br",
  "zipmail.com.br",
  "r7.com",
] as const;

type EmailAutocompleteInputProps = InputHTMLAttributes<HTMLInputElement>;

function assignRef(
  ref: Ref<HTMLInputElement> | undefined,
  value: HTMLInputElement | null,
) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function getEmailParts(value: string) {
  const atIndex = value.lastIndexOf("@");
  if (atIndex <= 0 || value.indexOf("@") !== atIndex) return null;

  return {
    localPart: value.slice(0, atIndex),
    domainQuery: value.slice(atIndex + 1).toLowerCase(),
  };
}

export const EmailAutocompleteInput = forwardRef<
  HTMLInputElement,
  EmailAutocompleteInputProps
>(function EmailAutocompleteInput(
  { onBlur, onChange, onKeyDown, className, type = "email", ...props },
  forwardedRef,
) {
  const generatedId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${props.id ?? generatedId}-email-suggestions`;

  function updateSuggestions(value: string) {
    const parts = getEmailParts(value);
    const nextSuggestions =
      parts && parts.domainQuery.length >= 2
        ? EMAIL_DOMAINS.filter((domain) =>
            domain.startsWith(parts.domainQuery),
          ).slice(0, 6)
        : [];

    setSuggestions(nextSuggestions);
    setActiveIndex(-1);
  }

  function selectDomain(domain: string, focusInput = true) {
    const input = inputRef.current;
    if (!input) return;

    const parts = getEmailParts(input.value);
    if (!parts) return;

    input.value = `${parts.localPart}@${domain}`;
    onChange?.({
      target: input,
      currentTarget: input,
    } as ChangeEvent<HTMLInputElement>);
    setSuggestions([]);
    setActiveIndex(-1);
    if (focusInput) input.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectDomain(suggestions[activeIndex]);
    } else if (event.key === "Tab" && activeIndex >= 0) {
      selectDomain(suggestions[activeIndex], false);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(suggestions.length - 1);
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActiveIndex(-1);
    }
  }

  const localPart = getEmailParts(inputRef.current?.value ?? "")?.localPart;

  return (
    <div className="relative">
      <input
        {...props}
        ref={(element) => {
          inputRef.current = element;
          assignRef(forwardedRef, element);
        }}
        type={type}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listboxId : undefined}
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        onChange={(event) => {
          updateSuggestions(event.currentTarget.value);
          onChange?.(event);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          setSuggestions([]);
          setActiveIndex(-1);
          onBlur?.(event);
        }}
      />

      {suggestions.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Sugestões de e-mail"
          className="absolute z-50 mt-1 max-h-56 w-full list-none overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {suggestions.map((domain, index) => (
            <li
              id={`${listboxId}-${index}`}
              key={domain}
              role="option"
              aria-selected={index === activeIndex}
              className={`rounded-lg ${
                index === activeIndex
                  ? "bg-blue-50 text-primary ring-1 ring-inset ring-primary/20"
                  : "text-foreground"
              }`}
            >
              <button
                type="button"
                tabIndex={-1}
                className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-inherit hover:bg-slate-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectDomain(domain)}
              >
                {localPart}@{domain}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
