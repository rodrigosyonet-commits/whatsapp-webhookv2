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

  const WHATSAPP_TOKEN = "EAAhYdCUaGewBRh55dxYd5Nq5QlzwVerE2RjxVnLI21uOb8MqufGYAMuBZB9Bz2UKaoZBVHUMdOLtZCRzCN3G74GiX45gZBigXTewLo8VIVOZAQq6nJ4rMJZCEZB5bcXAPvTVxwkEx4hTW6dWQaGeAKSkaITnEkXf0rDVmZBA7HRsrWTWyOZCZC0vdZA9jRTeLTPQedYJxlxZAGJQeNZBZCbuomLl27ZB5IlhgcVj2evG54Ymm1yCM71Smb9oGhZBBVoAAeCZAGlsecKZCPqebZADf2ZCfDzGjeUxxnKCRPY7Pf15OYEOYgZDZD";

  const PHONE_NUMBER_ID = "1114371845095549";

  const MONDAY_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY2Mjc0MDM4OCwiYWFpIjoxMSwidWlkIjoxMDMyMTE3MDQsImlhZCI6IjIwMjYtMDUtMjVUMjI6NDE6NDAuMDAwWiIsInBlciI6Im1lOndyaXRlIiwiYWN0aWQiOjgzMjY0MTAsInJnbiI6InVzZTEifQ.aCSoGeqhkzLvJ_TUn4xuIisR3seqR5VGbaBSR-2Os3w";

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
      // ✅ 1. MONDAY → WHATSAPP
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {

        const { contactPhone, replyText } = req.body;

        const clean = contactPhone.replace(/[^0-9]/g, "");
        const finalPhone = clean.startsWith("52") ? clean : "52" + clean;

        console.log("📤 Enviando:", finalPhone, replyText);

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
        console.log("📡 WA TEXT:", data);

        // fallback template
        if (!response.ok) {

          console.log("⚠️ Usando template fallback");

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
          console.log("📡 WA TEMPLATE:", data);

          if (!response.ok) {
            throw new Error(JSON.stringify(data));
          }
        }

        return res.status(200).json({ success: true });
      }

      // ======================================================
      // ✅ 2. WHATSAPP → MONDAY
      // ======================================================
      if (req.body.object === "whatsapp_business_account") {

        for (const entry of req.body.entry || []) {
          for (const change of entry.changes || []) {

            const messages = change.value.messages || [];

            for (const msg of messages) {

              const phone = msg.from;
              const text = msg.text?.body || "";

              console.log("📩 WA:", phone, text);

              // ============================
              // ✅ 1. CONTACTO
              // ============================
              let contact = await findContact(phone);

              if (!contact) {
                contact = await createContact(phone);
              }

              // ============================
              // ✅ 2. CONVERSACIÓN
              // ============================
              let conversation = await findConversation(contact.id);

              if (!conversation) {
                conversation = await createConversation(contact.id);
              }

              // ============================
              // ✅ 3. UPDATE = MENSAJE
              // ============================
              await createUpdate(conversation.id, `📥 Cliente:\n${text}`);
            }
          }
        }

        return res.status(200).send("EVENT_RECEIVED");
      }

      return res.status(200).send("OK");

    } catch (error) {
      console.error("❌ ERROR:", error);
      return res.status(500).json(error.message);
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
  // 💬 CONVERSACIÓN
  // ============================

  async function findConversation(contactId) {
    const query = `
      query {
        items_page_by_column_values(
          board_id: ${MESSAGES_BOARD_ID},
          columns: [{
            column_id: "board_relation_mm45a2gp",
            column_values: ["${contactId}"]
          }]
        ) {
          items { id }
        }
      }
    `;
    const data = await mondayQuery(query);
    return data.items_page_by_column_values.items[0] || null;
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
  // 📨 MENSAJES (UPDATES)
  // ============================

  async function createUpdate(itemId, text) {
    const query = `
      mutation {
        create_update(
          item_id: ${itemId},
          body: ${JSON.stringify(text)}
        ) { id }
      }
    `;
    await mondayQuery(query);
  }
}
