// POST /api/webhook
//
// Mercado Pago llama a esta URL solo (nunca la llama el navegador del
// cliente) cada vez que cambia el estado de un pago: se aprueba, se
// rechaza, queda pendiente, etc. Acá se confirma el pago real contra la
// API de Mercado Pago (nunca confiar en el estado que viene en la propia
// notificación, se puede falsificar) y, opcionalmente, se deja registro en
// la misma planilla de Google Sheets que ya usa el catálogo para pedidos
// entregados.
//
// Variables de entorno necesarias en Vercel:
//   MP_ACCESS_TOKEN        — el mismo Access Token de create-preference.js
//   SHEET_SYNC_ENDPOINT    — (opcional) el mismo Google Apps Script Web App
//                             que ya usa app.js para volcar pedidos entregados
//   SHEET_SYNC_SECRET      — (opcional) el mismo secret que ya usa app.js
//
// Si no configurás las dos últimas, el webhook igual funciona: solo deja
// de dejar registro en la planilla y únicamente escribe en los logs de
// Vercel (Project → Logs) — desde ahí podés ver cada pago confirmado.

import { MercadoPagoConfig, Payment } from "mercadopago";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const paymentId = req.body?.data?.id || req.query["data.id"];
    if (!paymentId) return res.status(200).end(); // notificación que no es de pago, se ignora

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = await new Payment(client).get({ id: paymentId });

    const status = payment.status; // approved | rejected | pending | ...
    const orderId = payment.external_reference;

    console.log(`[MP webhook] pago ${paymentId} — pedido ${orderId} — estado: ${status}`);

    if (status === "approved" && process.env.SHEET_SYNC_ENDPOINT && process.env.SHEET_SYNC_SECRET) {
      await fetch(process.env.SHEET_SYNC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          secret: process.env.SHEET_SYNC_SECRET,
          orderId,
          metodoPago: "Mercado Pago",
          notas: `Pago aprobado por Mercado Pago — payment_id ${paymentId}`,
        }),
      }).catch((e) => console.error("no se pudo avisar a la planilla", e));
    }

    return res.status(200).end();
  } catch (err) {
    console.error("webhook error", err);
    // Devolver 200 igual: si Mercado Pago recibe error, reintenta la
    // notificación muchas veces seguidas — mejor loguear y cortar acá.
    return res.status(200).end();
  }
}
