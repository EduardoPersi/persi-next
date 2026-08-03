"use client";

import type {
  HTMLInputAutoCompleteAttribute,
  HTMLInputTypeAttribute,
} from "react";
import type { FieldPath, UseFormRegisterReturn } from "react-hook-form";
import { useFormContext } from "react-hook-form";
import { Check, X } from "lucide-react";
import clsx from "clsx";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
import type { CheckoutFormValues } from "@/types/checkout";

interface CheckoutFieldProps {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  required?: boolean;
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
  required = false,
  type = "text",
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
  onChange,
}: CheckoutFieldProps) {
  const { getFieldState, formState } = useFormContext<CheckoutFormValues>();
  const { isTouched, isDirty } = getFieldState(
    registration.name as FieldPath<CheckoutFormValues>,
    formState,
  );
  const errorId = `${id}-error`;
  const InputComponent = type === "email" ? EmailAutocompleteInput : "input";
  const isValid = !error && (isTouched || isDirty);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-black">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <div className="relative">
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
          className={clsx(
            "min-h-11 w-full rounded-xl border bg-white px-3 py-2 pr-9 text-sm text-black outline-none transition focus:border-primary",
            error ? "border-danger" : "border-slate-300",
          )}
        />
        {error ? (
          <X
            size={18}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-danger"
            aria-hidden="true"
          />
        ) : isValid ? (
          <Check
            size={18}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-success"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
