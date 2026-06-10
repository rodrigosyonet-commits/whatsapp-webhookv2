export default async function handler(req, res) {

  // ============================
  // ✅ CORS
  // ============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ============================
  // ✅ ENV VARS (usa Vercel)
  // ============================
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

  const CONTACTS_BOARD_ID = 18416910309;
  const MESSAGES_BOARD_ID = 18416910311;

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

      console.log("📥 BODY:", JSON.stringify(req.body));

      // ======================================================
      // ✅ 1. MONDAY → WHATSAPP (YA FUNCIONA)
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {

        const clean = req.body.contactPhone.replace(/[^0-9]/g, "");
        const phone = clean.startsWith("52") ? clean : "52" + clean;

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
              to: phone,
              text: { body: req.body.replyText },
            }),
          }
        );

        let data = await response.json();
        console.log("📡 TEXT RESPONSE:", data);

        // fallback template
        if (!response.ok) {

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
                to: phone,
                type: "template",
                template: {
                  name: "hello_world",
                  language: { code: "en_US" }
                }
              }),
            }
          );

          data = await response.json();
          console.log("📡 TEMPLATE RESPONSE:", data);

          if (!response.ok) {
            throw new Error(JSON.stringify(data));
          }
        }

        return res.status(200).json({ success: true });
      }

      // ======================================================
      // ✅ 2. WHATSAPP → MONDAY (CORREGIDO)
      // ======================================================
      if (req.body.object === "whatsapp_business_account") {

        for (const entry of req.body.entry || []) {
          for (const change of entry.changes || []) {

            const messages = change.value.messages || [];

            for (const msg of messages) {

              const phone = msg.from;
              const text = msg.text?.body || "";
              const timestamp = new Date(parseInt(msg.timestamp) * 1000);

              console.log("📩 WA IN:", phone, text);

              // ====================================
              // 1. Buscar contacto
              // ====================================
              let contact = await findContact(phone);

              if (!contact) {
                contact = await createContact(phone);
              }

              // ====================================
              // 2. Buscar conversación
              // ====================================
              let conversation = await findConversation(contact.id);

              if (!conversation) {
                conversation = await createConversation(contact.id);
              }

              // ====================================
              // 3. Crear UPDATE (mensaje real)
              // ====================================
              await createUpdate(conversation.id, text);

            }
          }
        }

        return res.status(200).send("EVENT_RECEIVED");
      }

      return res.status(200).send("OK");

    } catch (error) {
      console.error("❌ ERROR:", error);
      return res.status(500).send("Error");
    }
  }

  return res.status(405).send("Method not allowed");

  // ============================================================
  // 🔧 HELPERS MONDAY
  // ============================================================

  async function mondayQuery(query) {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query }),
    });

    const data = await res.json();

    if (data.errors) {
      throw new Error(JSON.stringify(data.errors));
    }

    return data.data;
  }

  // ============================
  // 👤 CONTACTOS
  // ============================

  async function findContact(phone) {
    const query = `
      query {
        items_page_by_column_values(
          board_id: ${CONTACTS_BOARD_ID},
          columns: [{column_id: "phone_mm45s5qs", column_values: ["${phone}"]}]
        ) {
          items { id name }
        }
      }
    `;
    const data = await mondayQuery(query);
    return data.items_page_by_column_values.items[0] || null;
  }

  async function createContact(phone) {
    const columnValues = JSON.stringify({
      phone_mm45s5qs: { phone, countryShortName: "MX" }
    });

    const query = `
      mutation {
        create_item(
          board_id: ${CONTACTS_BOARD_ID},
          item_name: "${phone}",
          column_values: ${JSON.stringify(columnValues)}
        ) { id }
      }
    `;
    const data = await mondayQuery(query);
    return data.create_item;
  }

  // ============================
  // 💬 CONVERSACIONES
  // ============================

  async function findConversation(contactId) {
    const query = `
      query {
        items_page(board_id: ${MESSAGES_BOARD_ID}, limit: 50) {
          items {
            id
            column_values {
              id
              value
            }
          }
        }
      }
    `;

    const data = await mondayQuery(query);

    return data.items_page.items.find(item =>
      item.column_values.some(col =>
        col.id === "board_relation_mm45a2gp" &&
        col.value &&
        col.value.includes(contactId)
      )
    );
  }

  async function createConversation(contactId) {
    const columnValues = JSON.stringify({
      board_relation_mm45a2gp: {
        item_ids: [parseInt(contactId)]
      },
      color_mm459sn8: { label: "Open" }
    });

    const query = `
      mutation {
        create_item(
          board_id: ${MESSAGES_BOARD_ID},
          item_name: "Chat activo",
          column_values: ${JSON.stringify(columnValues)}
        ) { id }
      }
    `;

    const data = await mondayQuery(query);
    return data.create_item;
  }

  // ============================
  // 📨 MENSAJES = UPDATES ✅
  // ============================

  async function createUpdate(itemId, text) {

    const query = `
      mutation {
        create_update(
          item_id: ${itemId},
          body: ${JSON.stringify(text)}
        ) {
          id
        }
      }
    `;

    await mondayQuery(query);
  }
}
``
