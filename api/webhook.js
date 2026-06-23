// api/webhook.js — Twilio WhatsApp webhook (Vercel serverless function)
const { handleIncomingMessage } = require("../lib/router");
const twilio = require("twilio");

// Quick loader messages based on message type
function getLoaderMessage(body, hasImage) {
  if (hasImage) return "📸 Analyzing your plate...";
  const text = (body || "").toLowerCase().trim();
  if (/^(hi|hello|hey|start|help|menu|setup|profile|settings|controls|summary|weekly|report)$/i.test(text)) return null; // instant responses, no loader
  if (/^(reminders?\s|target\s|weight\s*day|pause\s|resume|unpause|my\s*data|stats)$/i.test(text)) return null; // instant
  if (/^\d{2,3}$/.test(text)) return null; // sugar reading — fast
  if (/steps?/i.test(text)) return null; // steps — fast
  if (/kg/i.test(text) || /^(weight|wt)/i.test(text)) return null; // weight — fast
  if (/^height/i.test(text)) return null; // height — fast
  // Everything else is likely a question → slow (Gemini call)
  return "🤔 Thinking...";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });


  const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;
  const hasImage = parseInt(NumMedia || 0) > 0;

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // Send instant loader for slow operations
    const loader = getLoaderMessage(Body, hasImage);
    if (loader) {
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From,
        body: loader,
      });
    }

    // Process the actual message
    const message = {
      phone: From.replace("whatsapp:", ""),
      text: (Body || "").trim(),
      hasImage,
      imageUrl: MediaUrl0 || null,
      imageType: MediaContentType0 || null,
    };

    const reply = await handleIncomingMessage(message);

    // Send the real response
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
