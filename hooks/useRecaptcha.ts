"use client";

import { useCallback } from "react";

interface Grecaptcha {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

function getGrecaptcha(): Grecaptcha | undefined {
  return (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
}

const READY_TIMEOUT_MS = 4000;

function waitForGrecaptcha(): Promise<Grecaptcha | null> {
  const existing = getGrecaptcha();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
    const interval = setInterval(() => {
      const grecaptcha = getGrecaptcha();
      if (grecaptcha) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(grecaptcha);
      }
    }, 100);
  });
}

export function useRecaptcha() {
  const getRecaptchaToken = useCallback(
    async (action: string): Promise<string | null> => {
      const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      if (!siteKey) return null;

      const grecaptcha = await waitForGrecaptcha();
      if (!grecaptcha) return null;

      try {
        return await new Promise<string>((resolve, reject) => {
          grecaptcha.ready(() => {
            grecaptcha.execute(siteKey, { action }).then(resolve, reject);
          });
        });
      } catch (error) {
        // Não bloqueia o envio do formulário por isso (o servidor trata a
        // ausência de token como zona cinzenta, não como bloqueio) — só
        // deixa rastro no console para diagnosticar (ex.: domínio não
        // cadastrado na chave do reCAPTCHA).
        console.warn("[recaptcha] falha ao gerar token", action, error);
        return null;
      }
    },
    [],
  );

  return { getRecaptchaToken };
}
