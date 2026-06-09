export default async function handler(req, res) {
  const VERIFY_TOKEN = "rodrigo_token_123";

  const MONDAY_API_KEY = "TU_API_KEY";
  const CONTACTS_BOARD_ID = 18416910309;
  const MESSAGES_BOARD_ID = 18416910311;
  const WHATSAPP_TOKEN = "TU_TOKEN";
  const PHONE_NUMBER_ID = "1114371845095549";

  // ============================
  // ✅ VERIFICACIÓN META (GET)
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
  // ✅ POST (SALIDA + ENTRADA)
  // ============================
  if (req.method === "POST") {
    try {

      // ======================================================
      // 📤 1. MENSAJE SALIENTE (DESDE MONDAY)
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {
        const { contactPhone, replyText } = req.body;

        console.log("📤 Enviando mensaje desde Monday:", {
          contactPhone,
          replyText,
        });

        await fetch(
          `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: contactPhone.replace(/[^0-9]/g, ""),
              text: { body: replyText },
            }),
          }
        );

        console.log("✅ Mensaje enviado desde Monday a WhatsApp");

        return res.status(200).json({ success: true });
      }

      // ======================================================
      // 📥 2. MENSAJE ENTRANTE (DESDE META)
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
        const searchQuery = `
          query {
            boards(ids: ${CONTACTS_BOARD_ID}) {
              items_page(limit: 200) {
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
          body: JSON.stringify({ query: searchQuery }),
        });

        const searchData = await searchRes.json();
        const items = searchData.data?.boards?.[0]?.items_page?.items || [];

        let contactId = null;

        for (const item of items) {
          const phoneCol = item.column_values.find(
            (c) => c.id === "phone_mm4455sp"
          );

          if (phoneCol?.text?.includes(phone)) {
            contactId = item.id;
            break;
          }
        }

        // ======================================================
        // 🆕 CREAR CONTACTO SI NO EXISTE
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

          const resCreate = await fetch("https://api.monday.com/v2", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: MONDAY_API_KEY,
            },
            body: JSON.stringify({ query: mutation }),
          });

          const data = await resCreate.json();
          contactId = data.data?.create_item?.id;
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
        // 💬 AGREGAR UPDATE
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
                    body: "${text.replace(/"/g, '\\"')}"
                  ) {
                    id
                  }
                }
              `,
            }),
          });
        }

        // ======================================================
        // 📤 RESPUESTA AUTOMÁTICA
        // ======================================================
        await fetch(
          `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              text: {
                body: "¡Gracias por tu mensaje! Pronto te contactaremos.",
              },
            }),
          }
        );
      }

      return res.status(200).send("EVENT_RECEIVED");

    } catch (error) {
      console.error("❌ Error:", error);
      return res.status(500).send("Error");
    }
  }

  return res.status(405).send("Method not allowed");
}
