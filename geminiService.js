import * as GA from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Intentar resolver varias formas de export que podría tener la librería
const GoogleGenAI = GA.GoogleGenAI ?? GA.GoogleGenerativeAI ?? GA.default?.GoogleGenAI ?? GA.default ?? GA;

let ai = null;
try {
  // Algunos empaquetados exponen una clase constructora; otros exponen un cliente factory.
  if (typeof GoogleGenAI === "function") {
    ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
  } else if (GoogleGenAI && typeof GoogleGenAI === "object" && typeof GoogleGenAI.create === "function") {
    ai = GoogleGenAI.create({ apiKey: process.env.GEMINI_API_KEY });
  } else {
    // no se pudo instanciar el cliente — usaremos un fallback en tiempo de ejecución
    ai = null;
  }
} catch (e) {
  console.warn("No fue posible instanciar el cliente de @google/generative-ai, usando fallback local:", e?.message ?? e);
  ai = null;
}

/**
 * Procesa el mensaje de WhatsApp recibido y extrae los datos del oxígeno en formato JSON.
 * @param {string} whatsappMessage - El texto enviado por el usuario o trabajador.
 */
export async function procesarMensajeOxigeno(whatsappMessage) {
  try {
    // Si no hay cliente (o queremos modo mock), usar parseo local para pruebas
    const useLocalFallback = !ai || process.env.MOCK_GEMINI === "1" || process.env.NODE_ENV === "test";
    if (useLocalFallback) {
      return localParse(whatsappMessage);
    }

    // Obtener el modelo usando la instancia 'ai'
    const model = typeof ai.getGenerativeModel === "function"
      ? ai.getGenerativeModel({ 
          model: "gemini-1.5-flash",
          systemInstruction: `Eres un asistente analítico especializado en la gestión de datos acuícolas para fincas de camarón. Tu única tarea es procesar reportes de niveles de oxígeno enviados por WhatsApp y extraer la información en un formato JSON limpio.
      
      Reglas críticas de procesamiento:
      1. Identifica la piscina: Si el texto dice "piscina 4" o "la 4", el campo "piscina" debe ser 4.
      2. Identifica el valor: Los niveles de oxígeno son decimales. Si usan coma (ej: 2,5), conviértelo a punto decimal (2.5) en el JSON.
      3. Identifica el día: Si el mensaje menciona un día (ej: "hoy 15", "ayer 14"), extrae ese número para "dia_lectura". Si no lo menciona, asume el día actual.
      4. Si el mensaje no contiene información sobre niveles de oxígeno o piscinas, devuelve todos los campos como null.`,
        })
      : ai;

    try {
      const response = await model.generateContent({
        contents: whatsappMessage,
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      const parsed = await safeParseResponse(response);
      // si parseo falló, caeremos al fallback local
      if (!parsed) return localParse(whatsappMessage);
      return normalizeParsed(parsed, whatsappMessage);
    } catch (e) {
      console.warn('Fallo la petición a Gemini, usando fallback local:', e?.message ?? e);
      return localParse(whatsappMessage);
    }

  } catch (error) {
    console.error("Error al procesar el mensaje con Gemini:", error);
    return null;
  }
}

/**
 * Safe parse de la posible estructura de respuesta del SDK.
 */
async function safeParseResponse(response) {
  try {
    // response puede tener varias formas según la versión del SDK
    if (!response) return null;

    if (typeof response === "string") return JSON.parse(response);

    // algunas implementaciones devuelven response.response.text() (función async)
    if (response.response && typeof response.response === "object") {
      if (typeof response.response.text === "function") {
        const txt = await response.response.text();
        return JSON.parse(txt);
      }
      if (typeof response.response === "string") {
        return JSON.parse(response.response);
      }
    }

    // otros SDKs colocan el texto en response.output[*].content[*].text
    if (Array.isArray(response.output) && response.output.length) {
      const first = response.output[0];
      if (first?.content && Array.isArray(first.content) && first.content[0]?.text) {
        return JSON.parse(first.content[0].text);
      }
    }

    // fallback: si ya es objeto, devolverlo
    if (typeof response === "object") return response;

    return null;
  } catch (e) {
    console.warn("No se pudo parsear la respuesta LLM como JSON, se usará fallback:", e?.message ?? e);
    return null;
  }
}

/** Normaliza y valida campos del JSON final */
function normalizeParsed(parsed, originalMessage) {
  const nowDay = new Date().getDate();
  const out = {
    finca: null,
    zona: null,
    piscina: null,
    dia_lectura: null,
    valor_oxigeno: null
  };

  if (!parsed || typeof parsed !== 'object') return localParse(originalMessage);

  if (parsed.finca) out.finca = String(parsed.finca).toUpperCase();
  if (parsed.zona) out.zona = String(parsed.zona).toUpperCase();

  if (parsed.piscina != null) {
    const p = parseInt(parsed.piscina, 10);
    out.piscina = Number.isFinite(p) ? p : null;
  }

  if (parsed.dia_lectura != null) {
    const d = parseInt(parsed.dia_lectura, 10);
    out.dia_lectura = Number.isFinite(d) ? d : nowDay;
  } else {
    out.dia_lectura = nowDay;
  }

  if (parsed.valor_oxigeno != null) {
    let v = String(parsed.valor_oxigeno).replace(',', '.');
    const n = parseFloat(v);
    out.valor_oxigeno = Number.isFinite(n) ? n : null;
  }

  return out;
}

/**
 * Parser local sencillo para pruebas sin red. Extrae piscina, valor y día usando regex.
 */
function localParse(text) {
  const nowDay = new Date().getDate();
  const lower = (text || '').toLowerCase();
  const out = { finca: null, zona: null, piscina: null, dia_lectura: null, valor_oxigeno: null };

  // finca (palabra ANTON u otros)
  const fincaMatch = /\b(anton|antonio|antonio|anton)\b/i.exec(text);
  if (fincaMatch) out.finca = fincaMatch[1].toUpperCase();

  // zona: letra A, B, C
  const zonaMatch = /zona\s*([a-zA-Z])/i.exec(text) || /\b([A-Z])\b/.exec(text);
  if (zonaMatch) out.zona = String(zonaMatch[1]).toUpperCase();

  // piscina: 'piscina 4' or 'la 4'
  const piscinaMatch = /piscina\s*(\d+)/i.exec(text) || /\bla\s*(\d+)\b/i.exec(text);
  if (piscinaMatch) out.piscina = parseInt(piscinaMatch[1], 10);

  // valor oxígeno: mejor esfuerzo
  // 1) buscar decimales con coma/punto
  let valor = null;
  const decimalMatch = /(\d+[\.,]\d+)/.exec(text);
  if (decimalMatch) {
    valor = decimalMatch[1];
  } else {
    // 2) buscar números y elegir el que no sea piscina ni día
    const allNums = text.match(/\d+[\.,]?\d*/g) || [];
    const numsClean = allNums.map(s => s.replace(',', '.'));
    const candidates = numsClean.map(s => parseFloat(s)).filter(n => Number.isFinite(n));
    // eliminar piscina y día cuando sea posible
    const filtered = candidates.filter(n => n !== out.piscina && n !== out.dia_lectura);
    if (filtered.length) valor = String(filtered[0]);
    else if (candidates.length) valor = String(candidates[0]);
  }
  if (valor != null) {
    const n = parseFloat(String(valor).replace(',', '.'));
    out.valor_oxigeno = Number.isFinite(n) ? n : null;
  }

  // día: 'hoy 15', 'ayer 14', or explicit number
  const hoyMatch = /hoy\s*(\d{1,2})/i.exec(text);
  const ayerMatch = /ayer\s*(\d{1,2})/i.exec(text);
  const diaNumMatch = /\b(\d{1,2})\b/.exec(text);
  if (hoyMatch) out.dia_lectura = parseInt(hoyMatch[1], 10);
  else if (ayerMatch) out.dia_lectura = parseInt(ayerMatch[1], 10);
  else if (diaNumMatch) out.dia_lectura = parseInt(diaNumMatch[1], 10);
  else out.dia_lectura = nowDay;

  return out;
}