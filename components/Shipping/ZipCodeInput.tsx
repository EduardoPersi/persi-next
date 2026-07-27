import type { FormEvent } from "react";
import { Button } from "@/components/UI/Button";

interface ZipCodeInputProps {
  id: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}

export function ZipCodeInput({
  id,
  isLoading,
  onChange,
  onSubmit,
  value,
}: ZipCodeInputProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        CEP
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          name="postcode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={9}
          placeholder="99999-999"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={isLoading}
          className="h-11 w-full sm:w-auto"
        >
          {isLoading ? "Calculando..." : "Calcular frete"}
        </Button>
      </div>
      <div
        id={`${id}-hint`}
        className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <span className="text-slate-500">Digite com ou sem hífen.</span>
        <a
          href="https://buscacepinter.correios.com.br/app/endereco/index.php?t"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#ff6a00] underline underline-offset-2"
        >
          Pesquisar CEP
        </a>
      </div>
    </form>
  );
}
