// POST /api/github-proxy
//
// Reemplaza el token de GitHub que antes se pedía en el navegador. Ahora el
// admin solo necesita loguearse con su cuenta de Google (Firebase Auth) en
// el catálogo; esta función verifica esa sesión en el servidor y, si el
// email coincide con la lista de administradores, reenvía la operación a la
// API de GitHub usando un token que queda guardado acá, nunca en el celular
// ni la compu del admin.
//
// Variables de entorno necesarias en Vercel (Project → Settings → Environment
// Variables):
//   GITHUB_ADMIN_TOKEN — Fine-grained personal access token de GitHub,
//                         creado por el admin en github.com/settings/tokens,
//                         con acceso SOLO al repo primeramano.github.io y
//                         permiso "Contents: Read and write".
//   SITE_URL            — https://primeramano.github.io (sin barra al final).
//
// Seguridad: esta función verifica la firma del ID token de Firebase contra
// las claves públicas de Google (sin necesitar ningún secreto de Firebase),
// y solo deja pasar operaciones si el email del token está en ADMIN_EMAILS.
// Nunca expone el GITHUB_ADMIN_TOKEN al navegador.

import jwt from "jsonwebtoken";

const GH_OWNER = "primeramano";
const GH_REPO = "primeramano.github.io";
const FIREBASE_PROJECT_ID = "primeramano-catalogo";
const ADMIN_EMAILS = ["belfioresantiago@gmail.com"];
const ALLOWED_ORIGIN = process.env.SITE_URL || "https://primeramano.github.io";

let certsCache = null;
let certsCacheAt = 0;

async function getGoogleCerts() {
  const now = Date.now();
  if (certsCache && now - certsCacheAt < 5 * 60 * 1000) return certsCache;
  const res = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
  );
  if (!res.ok) throw new Error("no se pudieron obtener las claves públicas de Google");
  certsCache = await res.json();
  certsCacheAt = now;
  return certsCache;
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") throw new Error("falta el token");
  const headerJson = Buffer.from(idToken.split(".")[0], "base64").toString();
  const decodedHeader = JSON.parse(headerJson);
  const certs = await getGoogleCerts();
  const cert = certs[decodedHeader.kid];
  if (!cert) throw new Error("certificado no encontrado para este token");
  return jwt.verify(idToken, cert, {
    algorithms: ["RS256"],
    audience: FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ message: "method not allowed" });

  try {
    const { idToken, path, method, body } = req.body || {};

    const payload = await verifyFirebaseIdToken(idToken);
    const email = (payload.email || "").toLowerCase();
    if (!payload.email_verified || !ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)) {
      return res.status(403).json({ message: "No autorizado" });
    }

    if (!path || typeof path !== "string" || !path.startsWith("/")) {
      return res.status(400).json({ message: "path inválido" });
    }

    if (!process.env.GITHUB_ADMIN_TOKEN) {
      return res.status(500).json({ message: "falta configurar GITHUB_ADMIN_TOKEN en el servidor" });
    }

    const ghRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}${path}`, {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_ADMIN_TOKEN}`,
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await ghRes.text();
    res.status(ghRes.status);
    res.setHeader("Content-Type", ghRes.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (err) {
    console.error("github-proxy error", err);
    return res.status(401).json({ message: "Token inválido o expirado — volvé a iniciar sesión" });
  }
}
