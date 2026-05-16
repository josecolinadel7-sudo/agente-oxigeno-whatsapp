import localtunnel from "localtunnel";

await import("./server.js");

async function startTunnel() {
  const port = Number(process.env.PORT || 3000);

  try {
    console.log(`Iniciando localtunnel en el puerto ${port}...`);
    const tunnel = await localtunnel({ port });

    console.log(`🔗 URL pública de localtunnel: ${tunnel.url}/webhook`);

    tunnel.on("error", (error) => {
      console.error("Error en el túnel:", error);
    });

    process.on("SIGINT", async () => {
      try { await tunnel.close(); } catch {}
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      try { await tunnel.close(); } catch {}
      process.exit(0);
    });
  } catch (error) {
    console.error("No se pudo iniciar localtunnel:", error?.message ?? error);
    process.exit(1);
  }
}

setTimeout(startTunnel, 1000);
