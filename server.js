import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { procesarMensajeOxigeno } from "./geminiService.js";
import { actualizarOxigenoSheet } from "./sheetsService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Token secreto inventado por ti para validar tu webhook con el proveedor
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || "camaron_token_secreto_2026";

app.use(bodyParser.json());

app.get("/", (_req, res) => {
  res.status(200).send("Bot de WhatsApp activo");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, port: PORT });
});

// DETECTOR DE TRÁFICO GENERAL: Esto imprimirá CUALQUIER golpe que reciba tu puerto,
// sin importar si es de Meta, de un túnel, un GET, un POST o un error.
app.use((req, res, next) => {
  console.log(`\n👀 [Tráfico detectado] Método: ${req.method} | Ruta: ${req.url}`);
  console.log("📥 Cabeceras recibidas:", JSON.stringify(req.headers, null, 2));
  next();
});

async function enviarMensajeWhatsApp(destino, texto) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("No se puede responder por WhatsApp: faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en .env");
    return false;
  }

  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: destino,
      type: "text",
      text: { body: texto },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Error enviando mensaje a WhatsApp:", JSON.stringify(data, null, 2));
    return false;
  }

  console.log("✅ Respuesta enviada a WhatsApp:", JSON.stringify(data, null, 2));
  return true;
}

/**
 * 1. ENDPOINT DE VERIFICACIÓN (GET)
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
      console.log("✅ Webhook verificado con éxito ante el proveedor.");
      return res.status(200).send(challenge);
    } else {
      console.log("❌ Token de verificación inválido.");
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});

/**
 * 2. ENDPOINT DE RECEPCIÓN (POST)
 */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("\n📩 ¡Paquete recibido desde WhatsApp!");
    console.log("📦 Estructura del body completo:", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    
    // LOG ADICIONAL: Si Meta manda algo que no son mensajes (ej. estados 'sent' o 'delivered'), lo sabremos aquí
    if (value && !value.messages) {
      console.log("ℹ️ Se recibió una actualización de estado o webhook sin mensajes directos.");
    }

    const messageObject = value?.messages?.[0];

    if (messageObject && messageObject.type === "text") {
      const whatsappMessage = messageObject.text.body;
      const deQuien = messageObject.from; // Número de teléfono del trabajador

      console.log(`👤 De: ${deQuien}`);
      console.log(`💬 Mensaje: "${whatsappMessage}"`);

      // A) Pasamos el mensaje por el cerebro (Gemini / Fallback Local)
      console.log("🧠 Procesando con inteligencia artificial...");
      const datosEstructurados = await procesarMensajeOxigeno(whatsappMessage);

      // B) Si la IA extrajo la data, la inyectamos directo en Google Sheets
      if (datosEstructurados && datosEstructurados.piscina !== null) {
        console.log("📊 Guardando en la matriz de Google Sheets...");
        const spreadsheetId = process.env.SPREADSHEET_ID;
        await actualizarOxigenoSheet(spreadsheetId, datosEstructurados);

        const respuesta = `Recibido: piscina ${datosEstructurados.piscina}, día ${datosEstructurados.dia_lectura}, oxígeno ${datosEstructurados.valor_oxigeno}.`;
        await enviarMensajeWhatsApp(deQuien, respuesta);
      } else {
        console.log("⚠️ El mensaje no contenía datos de oxígeno válidos o estructurables.");

        const respuesta = "Recibí tu mensaje, pero no pude detectar una piscina o un valor de oxígeno válido. Envíalo como: piscina 4, zona A, Anton, 3,5 hoy 15.";
        await enviarMensajeWhatsApp(deQuien, respuesta);
      }
    }

    // Siempre responder con 200 OK de inmediato a WhatsApp para que no reenvíe el mensaje
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Hubo un fallo crítico en el webhook:", error);
    return res.status(500).send("INTERNAL_SERVER_ERROR");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de Webhooks escuchando en el puerto ${PORT}`);
  console.log(`🔗 Tu URL local para pruebas es: http://localhost:${PORT}/webhook`);
});