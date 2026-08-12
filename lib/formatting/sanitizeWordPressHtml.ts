import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

// Conteúdo do WordPress vem com a marcação do Elementor (divs/spans com
// classes e estilo inline). Como o conteúdo é re-renderizado com a
// tipografia do próprio site (não a aparência do Elementor), tags fora da
// lista abaixo são descartadas mas o texto interno é preservado — não
// usamos allowedTags mais permissivo para não herdar layout/estilo do
// editor de página.
export function sanitizeWordPressHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "width", "height", "srcset", "sizes", "loading"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: (tagName, attribs) =>
        attribs.target === "_blank"
          ? { tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }
          : { tagName, attribs },
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: "lazy" },
      }),
    },
  }).trim();
}
