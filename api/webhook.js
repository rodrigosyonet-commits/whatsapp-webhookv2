export default async function handler(req, res) {

  // ============================
  // ✅ CORS (requerido para Monday App)
  // ============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const VERIFY_TOKEN = "rodrigo_token_123";

  // ✅ TOKEN FUNCIONAL (el de tu curl)
  const WHATSAPP_TOKEN = "EAAhYdCUaGewBRiUTEznZBYE5UbHvZChxxRcpPgUrHTrRTNZC7x0KrtttHv2IVZBYSx9SBB2TsKyk7DxamVmZCdiRdP1RZByQFWzEEZBzRbbv1NgavQxspESJP6Ji1dSgoCPLlWLA6gOmZCbeE72SEP7tzzkCdZAzZB3WqDCnpVYYXWsJDW735PRWqM8cM8jB6DTQjeMMDl3CcZBxZAh7kWKhpyrGDAsl9lIBl8bS4njZB6lYCZA79jq3rD55q2xtslZAmc59A7t5PZARG2oa7L7vneCO6IZABdpHoVC2JXYakexx2awZDZD";

  const PHONE_NUMBER_ID = "1114371845095549";

  // ============================
  // ✅ VERIFICACIÓN META
  // ============================
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Error");
  }

  // ============================
  // ✅ POST
  // ============================
  if (req.method === "POST") {
    try {

      console.log("📥 BODY COMPLETO:", req.body);

      // ======================================================
      // 📤 MENSAJE DESDE MONDAY → WHATSAPP
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {

        const { contactPhone, replyText } = req.body;

        // ✅ limpiar teléfono
        const clean = contactPhone.replace(/[^0-9]/g, "");
        const finalPhone = clean.startsWith("52") ? clean : "52" + clean;

        console.log("📤 Enviando mensaje:", {
          telefono: finalPhone,
          texto: replyText
        });

        // ======================================================
        // ✅ 1. INTENTO → TEXTO (si hay ventana abierta)
        // ======================================================
        let response = await fetch(
          `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: finalPhone,
              text: { body: replyText }, // ✅ usa el texto de Monday
            }),
          }
        );

        let data = await response.json();
        console.log("📡 RESPONSE TEXT:", data);

        // ======================================================
        // ✅ 2. FALLBACK → TEMPLATE (si no hay ventana)
        // ======================================================
        if (!response.ok) {

          console.log("⚠️ Ventana cerrada → usando template");

          response = await fetch(
            `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: finalPhone,
                type: "template",
                template: {
                  name: "hello_world",
                  language: { code: "en_US" }
                }
              }),
            }
          );

          data = await response.json();
          console.log("📡 RESPONSE TEMPLATE:", data);

          if (!response.ok) {
            throw new Error(JSON.stringify(data));
          }
        }

        console.log("✅ Mensaje enviado correctamente");

        return res.status(200).json({ success: true });
      }

      // ======================================================
      // 📥 EVENTO DE META → SOLO CONFIRMAR
      // ======================================================
      return res.status(200).send("EVENT_RECEIVED");

    } catch (error) {
      console.error("❌ ERROR GENERAL:", error);
      return res.status(500).send("Error");
    }
  }

  return res.status(405).send("Method not allowed");
}
