export function HeroBanner() {
  return (
    <section
      style={{
        background:
          "linear-gradient(90deg, #c60000 0%, #ff7a00 60%, #ffb300 100%)",
        color: "#fff",
        minHeight: "380px",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          width: "100%",
          padding: "40px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "54px",
              fontWeight: 700,
              marginBottom: "16px",
            }}
          >
            Soluções para sua obra
          </h1>

          <p style={{ fontSize: "22px", maxWidth: "520px" }}>
            Impermeabilização, hidráulica, elétrica, ferramentas e muito mais.
          </p>
        </div>

        <div
          style={{
            width: "320px",
            height: "320px",
            borderRadius: "16px",
            background: "rgba(255,255,255,.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "22px",
            fontWeight: 600,
          }}
        >
          Produto Destaque
        </div>
      </div>
    </section>
  );
}