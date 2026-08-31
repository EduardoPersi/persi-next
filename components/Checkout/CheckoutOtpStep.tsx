"use client";

import { ShieldCheck } from "lucide-react";
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/UI/Button";

interface CheckoutOtpStepProps {
  cooldown: number;
  digits: string[];
  error: string;
  loading: boolean;
  maskedEmail: string;
  onBack: () => void;
  onChange: (digits: string[]) => void;
  onResend: () => void;
  onSubmit: () => void;
}

export function CheckoutOtpStep(props: CheckoutOtpStepProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...props.digits];
    next[index] = digit;
    props.onChange(next);
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !props.digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const code = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) return;
    event.preventDefault();
    props.onChange(code.split(""));
    inputs.current[5]?.focus();
  }

  return (
    <div className="w-full max-w-xl text-center">
      <ShieldCheck className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
      <h1 className="mt-5 text-xl font-bold text-foreground">Enviamos um código para você!</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Digite o código enviado para:<br />
        <strong className="text-foreground">{props.maskedEmail}</strong>
      </p>

      <div className="mx-auto mt-6 grid max-w-sm grid-cols-6 gap-2" role="group" aria-label="Código de acesso com seis dígitos">
        {props.digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => { inputs.current[index] = element; }}
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => keyDown(index, event)}
            onPaste={paste}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Dígito ${index + 1} do código`}
            className="aspect-square min-w-0 rounded-xl border border-slate-300 bg-white text-center text-xl font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        ))}
      </div>

      <Button onClick={props.onSubmit} disabled={props.loading || props.digits.some((digit) => !digit)} className="mt-5 w-full max-w-sm">
        {props.loading ? "Validando..." : "Validar"}
      </Button>

      <div className="mt-4 text-sm text-muted">
        <span>Não recebeu? </span>
        {props.cooldown > 0 ? (
          <span>Aguarde {props.cooldown} segundos para enviar novamente.</span>
        ) : (
          <button type="button" onClick={props.onResend} disabled={props.loading} className="font-semibold text-secondary underline underline-offset-2">
            Enviar novamente
          </button>
        )}
      </div>
      <button type="button" onClick={props.onBack} disabled={props.loading} className="mt-4 text-sm font-medium text-primary underline underline-offset-2">
        Voltar para a senha
      </button>
    </div>
  );
}
