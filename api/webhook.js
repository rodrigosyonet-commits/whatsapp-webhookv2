export default async function handler(req, res) {

  // ============================
  // ✅ CORS (OBLIGATORIO)
  // ============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const VERIFY_TOKEN = "rodrigo_token_123";

  const MONDAY_API_KEY = "TU_API_KEY";
  const CONTACTS_BOARD_ID = 18416910309;
  const MESSAGES_BOARD_ID = 18416910311;

  const WHATSAPP_TOKEN = "TU_TOKEN_BUENO"; // 🔥 el que sí funciona (como tu curl)
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
      // 📤 1. MENSAJE DESDE MONDAY → WHATSAPP
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {

        const { contactPhone, replyText } = req.body;

        // ✅ limpiar teléfono
        const clean = contactPhone.replace(/[^0-9]/g, "");
        const finalPhone = clean.startsWith("52") ? clean : "52" + clean;

        console.log("📤 Enviando desde Monday:", {
          telefono: finalPhone,
          texto: replyText
        });

        // ✅ 1. INTENTO: MENSAJE NORMAL
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
              text: { body: replyText },
            }),
          }
        );

        let data = await response.json();
        console.log("📡 Response TEXT:", data);

        // ======================================================
        // ✅ FALLBACK → TEMPLATE (CLAVE)
        // ======================================================
        if (!response.ok) {
          console.log("⚠️ Fallback a TEMPLATE...");

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
          console.log("📡 Response TEMPLATE:", data);

          if (!response.ok) {
            throw new Error(JSON.stringify(data));
          }
        }

        console.log("✅ Mensaje enviado correctamente");

        return res.status(200).json({ success: true });
      }

      // ======================================================
      // 📥 2. MENSAJE ENTRANTE (META → MONDAY)
      // ======================================================
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (value?.messages) {

        const msg = value.messages[0];
        const contact = value.contacts?.[0];

        const phone = msg.from;
        const text = msg.text?.body || "";
        const name = contact?.profile?.name || "Lead WhatsApp";

        console.log("📩 Mensaje recibido:", { name, phone, text });

        // ======================================================
        // 🔎 BUSCAR CONTACTO
        // ======================================================
        const query = `
          query {
            boards(ids: ${CONTACTS_BOARD_ID}) {
              items_page(limit: 100) {
                items {
                  id
                  column_values(ids: ["phone_mm4455sp"]) {
                    id
                    text
                  }
                }
              }
            }
          }
        `;

        const searchRes = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: MONDAY_API_KEY,
          },
          body: JSON.stringify({ query }),
        });

        const searchData = await searchRes.json();

        const items = searchData.data?.boards?.[0]?.items_page?.items || [];

        let contactId = null;

        for (const item of items) {
          const col = item.column_values.find(c => c.id === "phone_mm4455sp");

          if (col?.text?.includes(phone)) {
            contactId = item.id;
            break;
          }
        }

        // ======================================================
        // 🆕 CREAR CONTACTO
        // ======================================================
        if (!contactId) {
          console.log("🆕 Creando contacto...");

          const mutation = `
            mutation {
              create_item(
                board_id: ${CONTACTS_BOARD_ID},
                item_name: "${name.replace(/"/g, '\\"')}",
                column_values: "{\\"phone_mm4455sp\\":{\\"phone\\":\\"${phone}\\"}}"
              ) {
                id
              }
            }
          `;

          const resC = await fetch("https://api.monday.com/v2", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: MONDAY_API_KEY,
            },
            body: JSON.stringify({ query: mutation }),
          });

          const dataC = await resC.json();
          contactId = dataC.data?.create_item?.id;
        }

        // ======================================================
        // 📝 CREAR MENSAJE
        // ======================================================
        const today = new Date().toISOString().split("T")[0];

        const createMessage = `
          mutation {
            create_item(
              board_id: ${MESSAGES_BOARD_ID},
              item_name: "Mensaje ${name.replace(/"/g, '\\"')}",
              column_values: "{\\"board_relation_mm44y3sx\\":{\\"item_ids\\":[${contactId}]},\\"date_mm444s0k\\":{\\"date\\":\\"${today}\\"}}"
            ) {
              id
            }
          }
        `;

        const msgRes = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: MONDAY_API_KEY,
          },
          body: JSON.stringify({ query: createMessage }),
        });

        const msgData = await msgRes.json();
        const messageId = msgData.data?.create_item?.id;

        // ======================================================
        // 💬 GUARDAR TEXTO
        // ======================================================
        if (messageId) {
          await fetch("https://api.monday.com/v2", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: MONDAY_API_KEY,
            },
            body: JSON.stringify({
              query: `
                mutation {
                  create_update(
                    item_id: ${messageId},
                    body: "${text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
                  ) {
                    id
                  }
                }
              `,
            }),
          });
        }
      }

      return res.status(200).send("EVENT_RECEIVED");

    } catch (error) {
      console.error("❌ ERROR GENERAL:", error);
      return res.status(500).send("Error");
    }
  }

  return res.status(405).send("Method not allowed");
}
``
