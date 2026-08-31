const TONE_CLASSES = {
  muted: "text-muted hover:[&_a]:text-foreground",
  light: "text-white/35 hover:[&_a]:text-white/70 [&_a]:decoration-white/35 hover:[&_a]:decoration-white/70",
} as const;

export function RecaptchaNotice({
  tone = "muted",
  className = "",
}: {
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
}) {
  return (
    <p className={`text-[11px] leading-4 ${TONE_CLASSES[tone]} ${className}`}>
      Este site é protegido pelo reCAPTCHA e se aplicam a{" "}
      <a
        href="https://policies.google.com/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Política de Privacidade
      </a>{" "}
      e os{" "}
      <a
        href="https://policies.google.com/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Termos de Serviço
      </a>{" "}
      do Google.
    </p>
  );
}
