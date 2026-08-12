import { z } from "zod";

export const CONTACT_SUBJECTS = [
  { value: "duvidas", label: "Dúvidas" },
  { value: "devolucoes", label: "Devoluções" },
  { value: "trocas", label: "Trocas" },
  { value: "outros", label: "Outros" },
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]["value"];

const CONTACT_SUBJECT_VALUES = CONTACT_SUBJECTS.map((subject) => subject.value) as [
  ContactSubject,
  ...ContactSubject[],
];

export const contactFormSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.email("Informe um e-mail válido."),
  subject: z.enum(CONTACT_SUBJECT_VALUES, {
    error: "Selecione um assunto.",
  }),
  message: z
    .string()
    .trim()
    .min(10, "Conte um pouco mais na mensagem (mínimo 10 caracteres).")
    .max(4000, "Mensagem muito longa."),
  website: z.literal(""),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export const contactSubmissionSchema = contactFormSchema.extend({
  recaptchaToken: z.string().max(8192),
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
