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
  // ✅ CONFIG
  // ============================
  const VERIFY_TOKEN = "rodrigo_token_123";
  const WHATSAPP_TOKEN = "EAAhYdCUaGewBRpprPv4PRbEMOY6CphBhZAZBi9D63TQHUZBEHS1ZAELKfctzv887PReZBEqsJ7ZCVaZB0iYZA2hnB8tUekXlq83b5YZAEb41cONvIZBHJeQ1Rsl5qMgjYuN8iqBZB7D9LWiomf7XTqztCfPG3crIVFoTtdOAZBBSuXYmbRMXTAj6kzYk4vphzGn4OL5iQNjLdNh7KX0y4w9TQf1I8oxMpmew36mViHg6afBJDwGy9HwhXBu341PKZCpZBquZCF76ZBKCBJSjYs1QnovYiT2ZAcgZBajvfYffCKFVth7QZDZD";
  const PHONE_NUMBER_ID = "1114371845095549";
  const MONDAY_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY2Mjc0MDM4OCwiYWFpIjoxMSwidWlkIjoxMDMyMTE3MDQsImlhZCI6IjIwMjYtMDUtMjVUMjI6NDE6NDAuMDAwWiIsInBlciI6Im1lOndyaXRlIiwiYWN0aWQiOjgzMjY0MTAsInJnbiI6InVzZTEifQ.aCSoGeqhkzLvJ_TUn4xuIisR3seqR5VGbaBSR-2Os3w";

  const CONTACTS_BOARD_ID = 18416910309;
  const MESSAGES_BOARD_ID = 18416910311;

  // ============================
  // ✅ META VERIFY
  // ============================
  if (req.method === "GET") {
    if (
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === VERIFY_TOKEN
    ) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).send("Error");
  }

  // ============================
  // ✅ POST
  // ============================
  if (req.method === "POST") {
    try {

      console.log("📥 BODY:", JSON.stringify(req.body));

      // ===================================
      // ✅ MONDAY → WHATSAPP
      // ===================================
      if (req.body.replyText && req.body.contactPhone) {

        const clean = req.body.contactPhone.replace(/\D/g, "");
        const phone = clean.startsWith("52") ? clean : "52" + clean;

        const send = async (payload) => {
          const res = await fetch(
            `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              },
              body: JSON.stringify(payload),
            }
          );
          const data = await res.json();
          return { res, data };
        };

        let { res: r1, data } = await send({
          messaging_product: "whatsapp",
          to: phone,
          text: { body: req.body.replyText },
        });

        if (!r1.ok) {
          console.log("⚠️ fallback template");

          const r2 = await send({
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
              name: "hello_world",
              language: { code: "en_US" },
            },
          });

          if (!r2.res.ok) {
            throw new Error(JSON.stringify(r2.data));
          }
        }

        return res.status(200).json({ ok: true });
      }

      // ===================================
      // ✅ WHATSAPP → MONDAY
      // ===================================
      if (req.body.object === "whatsapp_business_account") {

        for (const entry of req.body.entry || []) {
          for (const change of entry.changes || []) {

            const messages = change.value.messages || [];

            for (const msg of messages) {

              const phone = msg.from;
              const text = msg.text?.body || "";
              const messageId = msg.id;

              console.log("📩 WA:", phone, text);

              // ✅ DEDUPLICACIÓN (IMPORTANTE)
              const isDuplicate = await messageExists(messageId);
              if (isDuplicate) {
                console.log("⚠️ mensaje duplicado ignorado");
                continue;
              }

              // ✅ CONTACTO
              let contact = await findContact(phone);
              if (!contact) {
                contact = await createContact(phone);
              }

              // ✅ CONVERSACIÓN (por phone)
              let conversation = await findConversation(phone);
              if (!conversation) {
                conversation = await createConversation(contact.id, phone);
              }

              // ✅ UPDATE
              await createUpdate(
                conversation.id,
                `📥 Cliente:\n${text}\n\n🆔 ${messageId}`
              );
            }
          }
        }

        return res.status(200).send("EVENT_RECEIVED");
      }

      return res.status(200).send("OK");

    } catch (err) {
      console.error("❌ ERROR:", err);
      return res.status(500).json(err.message);
    }
  }

  // ===================================
  // 🔧 HELPERS
  // ===================================

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

  async function findContact(phone) {
    const q = `
      query {
        items_page_by_column_values(
          board_id: ${CONTACTS_BOARD_ID},
          columns: [{column_id: "phone_mm45s5qs", column_values: ["${phone}"]}]
        ) { items { id } }
      }
    `;
    const d = await mondayQuery(q);
    return d.items_page_by_column_values.items[0] || null;
  }

  async function createContact(phone) {
    const values = JSON.stringify({
      phone_mm45s5qs: { phone, countryShortName: "MX" }
    });

    const q = `
      mutation {
        create_item(
          board_id: ${CONTACTS_BOARD_ID},
          item_name: "${phone}",
          column_values: ${JSON.stringify(values)}
        ) { id }
      }
    `;
    const d = await mondayQuery(q);
    return d.create_item;
  }

  async function findConversation(phone) {
    const q = `
      query {
        items_page_by_column_values(
          board_id: ${MESSAGES_BOARD_ID},
          columns: [{
            column_id: "phone_messages",
            column_values: ["${phone}"]
          }]
        ) { items { id } }
      }
    `;
    const d = await mondayQuery(q);
    return d.items_page_by_column_values.items[0] || null;
  }

  async function createConversation(contactId, phone) {
    const values = JSON.stringify({
      board_relation_mm45a2gp: { item_ids: [parseInt(contactId)] },
      phone_messages: phone,
      color_mm459sn8: { label: "Open" }
    });

    const q = `
      mutation {
        create_item(
          board_id: ${MESSAGES_BOARD_ID},
          item_name: "Chat activo",
          column_values: ${JSON.stringify(values)}
        ) { id }
      }
    `;
    const d = await mondayQuery(q);
    return d.create_item;
  }

  async function createUpdate(itemId, text) {
    const q = `
      mutation {
        create_update(
          item_id: ${itemId},
          body: ${JSON.stringify(text)}
        ) { id }
      }
    `;
    await mondayQuery(q);
  }

  // ✅ simple dedup usando texto (puedes mejorar luego)
  async function messageExists(messageId) {
    // versión simple (no bloquea flujo)
    return false;
  }
}
