// api/webhook.js — Twilio WhatsApp webhook (Vercel serverless function)
const { handleIncomingMessage } = require("../lib/router");
const twilio = require("twilio");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (process.env.NODE_ENV === "production") {
    const sig = req.headers["x-twilio-signature"];
    const url = `https://${req.headers.host}/api/webhook`;
    if (!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body)) {
      return res.status(403).json({ error: "Invalid signature" });
    }
  }

  const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

  try {
    const message = {
      phone: From.replace("whatsapp:", ""),
      text: (Body || "").trim(),
      hasImage: parseInt(NumMedia || 0) > 0,
      imageUrl: MediaUrl0 || null,
      imageType: MediaContentType0 || null,
    };

    const reply = await handleIncomingMessage(message);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From,
      body: reply,
    });

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ status: "error", message: err.message });
  }
};
