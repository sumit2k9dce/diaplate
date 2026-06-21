// api/cron/reminders.js — Vercel cron job: runs every hour, sends due reminders
const { sendDueReminders } = require("../../lib/reminders");

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // In dev, allow without auth
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const result = await sendDueReminders();
    res.status(200).json({ status: "ok", ...result });
  } catch (err) {
    console.error("Cron error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
};
