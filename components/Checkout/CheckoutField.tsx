"use client";

import type {
  HTMLInputAutoCompleteAttribute,
  HTMLInputTypeAttribute,
} from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";

interface CheckoutFieldProps {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: HTMLInputTypeAttribute;
  autoComplete?: HTMLInputAutoCompleteAttribute;
  inputMode?: "email" | "numeric" | "tel" | "text";
  maxLength?: number;
  placeholder?: string;
  onChange?: (value: string) => void;
}

export function CheckoutField({
  id,
  label,
  registration,
  error,
  type = "text",
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
  onChange,
}: CheckoutFieldProps) {
  const errorId = `${id}-error`;
  const InputComponent = type === "email" ? EmailAutocompleteInput : "input";

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm text-slate-800">
        {label}
      </label>
      <InputComponent
        {...registration}
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={
          onChange
            ? (event) => {
                onChange(event.currentTarget.value);
              }
            : registration.onChange
        }
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 aria-[invalid=true]:border-danger"
      />
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
