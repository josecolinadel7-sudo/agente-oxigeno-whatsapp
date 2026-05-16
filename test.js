import { procesarMensajeOxigeno } from "./geminiService.js";
import { actualizarOxigenoSheet } from "./sheetsService.js";
import dotenv from "dotenv";

dotenv.config();

async function correrPruebaCompleta() {
  // 1. Mensaje de WhatsApp simulado que llega desde el campo
  const mensajeSimulado = "Mano, el oxígeno de la piscina 4 de la zona A en Anton marcó 3,5 hoy 15";
  
  console.log("--- 1. Procesando Mensaje con Gemini ---");
  const datosEstructurados = await procesarMensajeOxigeno(mensajeSimulado);
  console.log("Resultado de la IA:", JSON.stringify(datosEstructurados, null, 2));

  // 2. Si la IA logró extraer los datos, guardarlos directamente en Google Sheets
  if (datosEstructurados) {
    console.log("\n--- 2. Guardando datos en Google Sheets ---");
    const spreadsheetId = process.env.SPREADSHEET_ID;
    await actualizarOxigenoSheet(spreadsheetId, datosEstructurados);
  }
}

correrPruebaCompleta();