// POST /api/create-preference
//
// Recibe el carrito confirmado desde app.js (catálogo Primera Mano) y crea
// una preferencia de pago en Mercado Pago Checkout Pro. Devuelve la URL
// (init_point) a la que el navegador del cliente redirige para pagar.
//
// Variables de entorno necesarias en Vercel (Project → Settings → Environment
// Variables):
//   MP_ACCESS_TOKEN   — Access Token de PRODUCCIÓN de tu cuenta de Mercado
//                        Pago (Developers → Tus integraciones → Credenciales).
//   SITE_URL          — https://primeramano.github.io (sin barra al final).
//
// CORS: como app.js corre en primeramano.github.io y esta función en otro
// dominio (vercel.app o el que conectes), hay que permitir explícitamente
// ese origen — si no, el navegador bloquea la respuesta.

import { MercadoPagoConfig, Preference } from "mercadopago";

const ALLOWED_ORIGIN = process.env.SITE_URL || "https://primeramano.github.io";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  try {
    const { orderId, items, buyer } = req.body || {};

    if (!orderId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "faltan orderId o items" });
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const mpItems = items.map((it) => ({
      id: String(it.id || ""),
      title: String(it.title || "Producto").slice(0, 250),
      quantity: Math.max(1, parseInt(it.qty, 10) || 1),
      unit_price: Number(it.price) || 0,
      currency_id: "ARS",
    }));

    const result = await preference.create({
      body: {
        items: mpItems,
        payer: buyer && buyer.nombre ? { name: buyer.nombre, phone: { number: buyer.telefono || "" } } : undefined,
        external_reference: orderId, // así el webhook sabe a qué pedido de Firestore corresponde
        back_urls: {
          success: `${ALLOWED_ORIGIN}/?mp=success`,
          failure: `${ALLOWED_ORIGIN}/?mp=failure`,
          pending: `${ALLOWED_ORIGIN}/?mp=pending`,
        },
        auto_return: "approved",
        notification_url: `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : ""}/api/webhook`,
      },
    });

    return res.status(200).json({ init_point: result.init_point, id: result.id });
  } catch (err) {
    console.error("create-preference error", err);
    return res.status(500).json({ error: "no se pudo crear la preferencia de pago" });
  }
}
