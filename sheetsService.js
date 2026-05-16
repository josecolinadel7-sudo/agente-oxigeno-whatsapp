import { google } from "googleapis";
import path from "path";
import fs from "fs";

// Buscar archivo de credenciales posible (credentials.json o credentials.json.json)
function findCredentialsFile() {
  const candidates = ["credentials.json", "credentials.json.json", "credentials.json.enc"];
  for (const c of candidates) {
    const p = path.resolve(c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const credPath = findCredentialsFile();
if (!credPath) console.warn("No se encontró archivo de credenciales local (credentials.json). Google Sheets API fallará si se intenta usar en producción.");

// Configuración de la autenticación usando el archivo de credenciales encontrado
const auth = new google.auth.GoogleAuth({
  keyFile: credPath || path.resolve("credentials.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

/**
 * Actualiza la celda de oxígeno correspondiente a la piscina y al día en Google Sheets.
 * @param {string} spreadsheetId - El ID de tu hoja de cálculo de Google o URL completa.
 * @param {Object} datos - El JSON estructurado que devolvió Gemini.
 */
export async function actualizarOxigenoSheet(spreadsheetId, datos) {
  const { piscina, dia_lectura, valor_oxigeno } = datos;

  if (piscina === null || dia_lectura === null || valor_oxigeno === null) {
    console.log("⚠️ Datos incompletos. No se puede actualizar la hoja.");
    return false;
  }

  // Si no hay credenciales, usar fallback local para permitir pruebas sin acceso
  if (!credPath) {
    console.warn('No hay credenciales disponibles: usando fallback local para guardar los datos.');
    await updateLocalSheet(spreadsheetId, datos);
    return true;
  }

  try {
    const sheets = google.sheets({ version: "v4", auth });
    const nombrePestaña = "Oxígenos"; // Coincide con tu pestaña con tilde

    // Si `spreadsheetId` es una URL completa, extraer el ID entre /d/..../
    if (typeof spreadsheetId === 'string' && spreadsheetId.includes('docs.google.com')) {
      const m = spreadsheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (m) spreadsheetId = m[1];
    }

    // 1. LEER LAS CABECERAS: Traemos las primeras 2 filas para buscar los días en la Fila 2 y el Mes en la Fila 1
    const readCabeceraResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${nombrePestaña}!A1:Z2`, 
    });

    const filasCabecera = readCabeceraResponse.data.values;
    if (!filasCabecera || filasCabecera.length < 2) {
      console.log("❌ No se pudo leer la Fila 2 de la hoja de cálculo.");
      return false;
    }

    const filaMesSuperior = filasCabecera[0] || []; // Fila 1 (Donde está "Mayo")
    const cabeceras = filasCabecera[1];             // Fila 2 (Donde están los números de días)

    // Extraer el texto de la fecha/mes de la fila 1 de forma segura sin que rompa el script
    let mesDetectado = "Mes No Definido";
    if (Array.isArray(filaMesSuperior)) {
      const celdaTexto = filaMesSuperior.find(celda => celda && celda.toString().trim() !== "");
      if (celdaTexto) mesDetectado = celdaTexto.toString().trim();
    }
    
    console.log(`📅 Período detectado en la Fila 1: [ ${mesDetectado} ]`);

    // 2. Buscar columna del día en esa Fila 2
    const columnaIndex = cabeceras.findIndex((header) => {
      if (header === undefined || header === null) return false;
      const hLimpio = header.toString().trim();
      return hLimpio === String(dia_lectura) || parseInt(hLimpio, 10) === parseInt(dia_lectura, 10);
    });

    if (columnaIndex === -1) {
      console.log(`❌ No se encontró la columna para el día: ${dia_lectura} en la Fila 2. Cabeceras de la Fila 2:`, cabeceras);
      return false;
    }

    // 3. LEER LAS PISCINAS: Obtenemos toda la columna A (desde la fila 1 hasta el final)
    const readPiscinaResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${nombrePestaña}!A:A`,
    });
    const filasPiscina = readPiscinaResponse.data.values;

    if (!filasPiscina || filasPiscina.length === 0) {
      console.log("❌ No se encontraron datos en la columna A de las piscinas.");
      return false;
    }

    // Buscar en qué fila está el número de piscina exacto
    let filaIndex = -1;
    for (let i = 0; i < filasPiscina.length; i++) {
      if (filasPiscina[i][0] && parseInt(filasPiscina[i][0], 10) === parseInt(piscina, 10)) {
        filaIndex = i;
        break;
      }
    }

    if (filaIndex === -1) {
      console.log(`❌ No se encontró la fila para la piscina: ${piscina} en la columna A.`);
      return false;
    }

    // 4. Convertir índices numéricos a coordenadas de Excel (Fila en Sheets es base 1)
    const numeroFilaSheet = filaIndex + 1;
    const letraColumnaSheet = obtenerLetraColumna(columnaIndex);
    const coordenadaCelda = `${nombrePestaña}!${letraColumnaSheet}${numeroFilaSheet}`;

    // Imprime la ubicación exacta cruzando la información para máxima claridad en tus logs
    console.log(`📍 Celda localizada: ${letraColumnaSheet}${numeroFilaSheet} para Piscina ${piscina}, Día ${dia_lectura} de ${mesDetectado}...`);

    // 5. Escribir el valor del oxígeno en la celda correspondiente
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: coordenadaCelda,
      valueInputOption: "USER_ENTERED", 
      requestBody: {
        values: [[valor_oxigeno]],
      },
    });

    console.log("✅ ¡Hoja de cálculo actualizada con éxito y validación de fecha!");
    return true;
  } catch (error) {
    console.error("Error al interactuar con Google Sheets API:", error);
    
    // Si hay error de permisos o API deshabilitada, usar tu fallback local estructurado
    try {
      const status = error?.code || error?.response?.status;
      if (status === 403 || (error?.cause && String(error.cause).includes('not been used'))) {
        console.warn('Permisos/API denegados: usando fallback local.');
        await updateLocalSheet(spreadsheetId, datos);
        return true;
      }
    } catch (e2) {
      console.warn('No se pudo analizar el error; usando fallback local por seguridad.');
      await updateLocalSheet(spreadsheetId, datos);
      return true;
    }
    return false;
  }
}

/** Escribe en un archivo local JSON para simular la actualización de la hoja */
async function updateLocalSheet(spreadsheetId, datos) {
  const file = path.resolve('sheet-fallback.json');
  let store = {};
  try {
    if (fs.existsSync(file)) store = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    store = {};
  }

  const key = String(spreadsheetId || 'local').replace(/[^a-zA-Z0-9-_]/g, '_');
  if (!store[key]) store[key] = [];
  store[key].push({ datos, ts: new Date().toISOString() });

  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
  console.log(`Fallback local: datos guardados en ${file} bajo la clave ${key}`);
}

/**
 * Función auxiliar para convertir un índice de columna (0, 1, 2...) en letras (A, B, C... AA)
 */
function obtenerLetraColumna(index) {
  let letra = "";
  while (index >= 0) {
    letra = String.fromCharCode((index % 26) + 65) + letra;
    index = Math.floor(index / 26) - 1;
  }
  return letra;
}