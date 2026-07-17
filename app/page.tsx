export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ marginBottom: "12px" }}>Persi Materiais</p>

        <h1 style={{ fontSize: "48px", marginBottom: "16px" }}>
          Nova loja em desenvolvimento
        </h1>

        <p style={{ fontSize: "18px", maxWidth: "600px" }}>
          Projeto Next.js da Persi — Revisão 0.1
        </p>
      </div>
    </main>
  );
}