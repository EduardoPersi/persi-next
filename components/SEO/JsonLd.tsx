// Renderiza um ou mais objetos schema.org como blocos <script type="application/ld+json">
// independentes, na mesma ordem recebida. Escapa "<" para evitar que o
// conteúdo de um campo (ex: nome de produto/categoria) feche a tag <script>
// prematuramente dentro do dangerouslySetInnerHTML.
export function JsonLd({ data }: { data: object | object[] }) {
  const items = Array.isArray(data) ? data : [data];

  return (
    <>
      {items.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(item).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
