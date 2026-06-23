// lib/reminders.js — Smart reminders: escalating nudges, celebrations, smart silence
const { db, supabase } = require("./database");
const twilio = require("twilio");

// Escalating messages based on days since last log
const ESCALATION = {
  sugar: [
    { days: 1, msg: "🌅 Good morning! Fasting sugar check — just type the number (e.g. \"105\")." },
    { days: 2, msg: "🩸 Haven't seen your sugar reading in 2 days. A quick check helps track your trend!" },
    { days: 5, msg: "Hey! It's been 5 days since your last sugar reading. Even one reading helps me give you better insights. Just type a number like \"110\"." },
    { days: 10, msg: "I've been quiet because you've been quiet 😊 Whenever you're ready, just type your fasting sugar number and we're back on track. No pressure, no backlog." },
  ],
  meals: [
    { days: 1, msg: "🍽️ Don't forget to share a meal photo today! Just snap your plate and send it." },
    { days: 3, msg: "It's been 3 days since your last meal photo. Even one meal a day builds the picture. Quick snap of dinner tonight? 📸" },
    { days: 7, msg: "Hey! I miss your plate photos 😄 Remember, tracking is the #1 habit for managing sugar. Send any meal photo to restart!" },
    { days: 14, msg: "I'm still here whenever you're ready. Send any meal photo or type Hi to restart. No judgment, no backlog 🙌" },
  ],
  steps: [
    { days: 1, msg: "👣 Don't forget to log your steps today! Just type something like \"6000 steps\"." },
    { days: 3, msg: "Haven't seen your step count in a few days. Even a rough number helps — type \"4000 steps\" or whatever you walked today!" },
  ],
};

// Celebration messages for streaks
const CELEBRATIONS = [
  { streak: 3, msg: "🔥 3-day streak! You've logged meals 3 days in a row. Keep it going!" },
  { streak: 7, msg: "🎉 1-week streak! 7 consecutive days of logging. That's real commitment — your data is getting powerful now." },
  { streak: 14, msg: "⭐ 2-week streak! 14 days straight. You're building a habit that will genuinely improve your health." },
  { streak: 30, msg: "🏆 30-DAY STREAK! One full month of consistent tracking. You're in the top 5% of DiaPlate users. Your doctor will love your data." },
];

async function sendDueReminders() {
  const { data: users } = await supabase.from("users").select("*").eq("reminders_enabled", true);
  if (!users || users.length === 0) return { sent: 0 };

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  let sent = 0;

  for (const user of users) {
    if (user.paused_until && new Date(user.paused_until) > new Date()) continue;

    try {
      const [daysSugar, daysMeal, daysSteps] = await Promise.all([
        db.getDaysSinceLastLog(user.phone, "sugar_readings"),
        db.getDaysSinceLastLog(user.phone, "meals"),
        db.getDaysSinceLastLog(user.phone, "steps"),
      ]);

      const messages = [];

      // Smart silence: if everything logged today, send nothing
      const allGood = daysSugar === 0 && daysMeal === 0 && daysSteps === 0;
      if (allGood) {
        // Check for streak celebration
        const streak = user.streak_meals || 0;
        const celebration = CELEBRATIONS.find(c => c.streak === streak);
        if (celebration) messages.push(celebration.msg);
      } else {
        // Find appropriate escalation message
        for (const [type, levels] of Object.entries(ESCALATION)) {
          const daysSince = type === "sugar" ? daysSugar : type === "meals" ? daysMeal : daysSteps;
          // Find the matching escalation level
          const level = [...levels].reverse().find(l => daysSince >= l.days);
          if (level) {
            // Don't repeat the same level — only send if this is the exact day
            if (daysSince === level.days) messages.push(level.msg);
          }
        }

        // Weight day reminder
        const today = new Date();
        const dayName = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][today.getDay()];
        if (dayName === (user.weight_day || "friday")) {
          const daysWeight = await db.getDaysSinceLastLog(user.phone, "weight");
          if (daysWeight > 0) messages.push("⚖️ It's your weigh-in day! Step on the scale and type your weight (e.g. \"73.5 kg\").");
        }
      }

      // Send all due messages (max 2 per user per run to avoid spam)
      for (const msg of messages.slice(0, 2)) {
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: `whatsapp:${user.phone}`,
          body: msg,
        });
        sent++;
      }
    } catch (err) {
      console.error(`[Reminders] Error for ${user.phone.slice(-4)}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { sendDueReminders };
