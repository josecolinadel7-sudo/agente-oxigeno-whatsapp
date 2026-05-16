# Agente Oxígeno WhatsApp

Bot de WhatsApp para procesar lecturas de oxígeno, guardar los datos en Google Sheets y responder automáticamente al trabajador.

## Requisitos

- Node.js 18 o superior
- Cuenta de Meta WhatsApp Cloud API
- Proyecto de Google Cloud con Google Sheets API habilitada
- Cuenta de servicio de Google con acceso a la hoja

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

- `PORT`
- `WEBHOOK_VERIFY_TOKEN`
- `GEMINI_API_KEY`
- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `SPREADSHEET_ID`

## Desarrollo local

```bash
npm install
npm run dev
```

## Prueba local

```bash
node test.js
```

## Despliegue en Render

1. Sube este repositorio a GitHub.
2. Crea un servicio Web en Render usando `render.yaml`.
3. Agrega las variables de entorno en Render.
4. Copia la URL pública de Render.
5. En Meta, configura el webhook así:

```text
https://TU-APP.onrender.com/webhook
```

6. Usa como token de verificación el mismo valor de `WEBHOOK_VERIFY_TOKEN`.

## Webhook de Meta

- Método GET: verifica el webhook con `hub.mode`, `hub.verify_token` y `hub.challenge`.
- Método POST: recibe mensajes entrantes y responde automáticamente.

## Notas

- `npm run dev` ahora arranca sólo el servidor local.
- Si quieres túnel local, usa `npm run tunnel`.
