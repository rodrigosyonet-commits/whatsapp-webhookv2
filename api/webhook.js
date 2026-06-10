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

  const WHATSAPP_TOKEN = "EAAhYdCUaGewBRubkyXTfkDBT6gssr8PsAkBBJKVjTe8TNTeEyUSn7HIM9ZBHOulQd3WVjKCy4ZCAsVqeae0rajs3DOlyD3YgoNT0UcilkNhTFAkG9iOVNZBbcZAKMNfjftZB39goHfOj9jZBs8XRMXGiZCZA6TwtYRgIZBqE8BoV9JtDJKlWqsawNcYlo1eZC81Hxik6slkg7WyoZAbqVBZCYlFCDZCAZBlcSVjgi4bBkgSBK8ZCwbxE9wSn25ihwZBhvN9vAOklVoHYGSP4ktGDcLVuyIfbZAO3VeGywH18ntOZAj9gZDZD";

  const PHONE_NUMBER_ID = "1114371845095549";
  const MONDAY_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY2Mjc0MDM4OCwiYWFpIjoxMSwidWlkIjoxMDMyMTE3MDQsImlhZCI6IjIwMjYtMDUtMjVUMjI6NDE6NDAuMDAwWiIsInBlciI6Im1lOndyaXRlIiwiYWN0aWQiOjgzMjY0MTAsInJnbiI6InVzZTEifQ.aCSoGeqhkzLvJ_TUn4xuIisR3seqR5VGbaBSR-2Os3w";

  const CONTACTS_BOARD_ID = 18416910309;
  const MESSAGES_BOARD_ID = 18416910311;

  // ============================
  // ✅ NORMALIZAR TELÉFONO (TU CASO)
  // ============================
  function normalizePhone(phoneRaw) {
    const clean = String(phoneRaw).replace(/\D/g, "");

    if (clean.startsWith("521") && clean.length === 13) {
      return "52" + clean.slice(3);
    }

    if (clean.startsWith("52") && clean.length === 12) {
      return clean;
    }

    if (clean.length === 10) {
      return "52" + clean;
    }

    return clean;
  }

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

      // ======================================================
      // ✅ MONDAY → WHATSAPP
      // ======================================================
      if (req.body.replyText && req.body.contactPhone) {

        const finalPhone = normalizePhone(req.body.contactPhone);

        console.log("📤 Enviando:", finalPhone, req.body.replyText);

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
              text: { body: req.body.replyText },
            }),
          }
        );

        let data = await response.json();
        console.log("📡 WA TEXT:", data);

        if (!response.ok) {

          console.log("⚠️ fallback template");

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
      // ✅ WHATSAPP → MONDAY
      // ======================================================
      if (req.body.object === "whatsapp_business_account") {

        for (const entry of req.body.entry || []) {
          for (const change of entry.changes || []) {

            const contactName =
              change.value.contacts?.[0]?.profile?.name || "Cliente";

            const messages = change.value.messages || [];

            for (const msg of messages) {

              const phone = normalizePhone(msg.from);
              const text = msg.text?.body || "";
              const messageId = msg.id;

              console.log("📩 WA:", contactName, phone);

              let contact = await findContact(phone);

              if (!contact) {
                contact = await createContact(phone, contactName);
              }

              let conversation = await findConversationByPhone(phone);

              if (!conversation) {
                conversation = await createConversation(contact.id, phone, contactName);
              }

              await createUpdate(
                conversation.id,
                `📥 ${contactName}:\n${text}`
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

  return res.status(405).send("Method not allowed");

  // ============================
  // 🔧 MONDAY HELPERS
  // ============================

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

  async function createContact(phone, name) {
    const values = JSON.stringify({
      phone_mm45s5qs: { phone, countryShortName: "MX" }
    });

    const q = `
      mutation {
        create_item(
          board_id: ${CONTACTS_BOARD_ID},
          item_name: "${name}",
          column_values: ${JSON.stringify(values)}
        ) { id }
      }
    `;
    const d = await mondayQuery(q);
    return d.create_item;
  }

  async function findConversationByPhone(phone) {

    const shortPhone = phone.replace(/^52/, "");

    const query = `
      query {
        items_page_by_column_values(
          board_id: ${MESSAGES_BOARD_ID},
          columns: [{
            column_id: "text_mm46jm2k",
            column_values: ["${phone}", "${shortPhone}"]
          }]
        ) {
          items { id }
        }
      }
    `;

    const data = await mondayQuery(query);
    const items = data.items_page_by_column_values.items;

    if (!items || items.length === 0) return null;

    return items.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  async function createConversation(contactId, phone, name) {

    const values = JSON.stringify({
      board_relation_mm45a2gp: {
        item_ids: [parseInt(contactId)]
      },
      text_mm46jm2k: phone,
      color_mm459sn8: { label: "Open" }
    });

    const query = `
      mutation {
        create_item(
          board_id: ${MESSAGES_BOARD_ID},
          item_name: "${name}",
          column_values: ${JSON.stringify(values)}
        ) { id }
      }
    `;

    const data = await mondayQuery(query);
    return data.create_item;
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
}
