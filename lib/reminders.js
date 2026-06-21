// lib/reminders.js — Proactive reminder engine
const { db, supabase } = require("./database");
const twilio = require("twilio");

const REMINDERS = {
  morning_sugar: {
    checkHour: 8, // 8 AM IST
    message: "🌅 Good morning! Time for your fasting sugar reading. Just type the number (e.g. \"105\").",
    check: async (phone) => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("sugar_readings").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", today + "T00:00:00");
      return count > 0; // true = already logged
    },
  },
  breakfast: {
    checkHour: 10, // 10 AM IST
    message: "🍳 Had breakfast? Share a photo of your plate and I'll give you a T-Plate score!",
    check: async (phone) => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("meals").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", today + "T00:00:00")
        .lte("logged_at", today + "T11:00:00");
      return count > 0;
    },
  },
  lunch: {
    checkHour: 14, // 2 PM IST
    message: "🍽️ Lunch time! Share your plate photo for a quick T-Plate analysis.",
    check: async (phone) => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("meals").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", today + "T11:00:00")
        .lte("logged_at", today + "T16:00:00");
      return count > 0;
    },
  },
  dinner: {
    checkHour: 21, // 9 PM IST
    message: "🌙 Had dinner? Share your plate photo — last meal of the day!",
    check: async (phone) => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("meals").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", today + "T16:00:00");
      return count > 0;
    },
  },
  steps: {
    checkHour: 21, // 9 PM IST (same window as dinner)
    message: "👣 Don't forget to log your steps today! Just type something like \"6000 steps\".",
    check: async (phone) => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("steps").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", today + "T00:00:00");
      return count > 0;
    },
  },
  weight: {
    checkHour: 9, // 9 AM on weight day only
    message: "⚖️ It's your weigh-in day! Step on the scale and type your weight (e.g. \"73.5 kg\").",
    check: async (phone, user) => {
      // Only trigger on the user's chosen weight day
      const today = new Date();
      const dayName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][today.getDay()];
      if (dayName !== (user.weight_day || "friday")) return true; // not weight day, skip
      const todayStr = today.toISOString().split("T")[0];
      const { count } = await supabase
        .from("weight").select("*", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("logged_at", todayStr + "T00:00:00");
      return count > 0;
    },
  },
};

// Get current IST hour
function getISTHour() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  return ist.getUTCHours();
}

// Main function called by cron — checks all users and sends due reminders
async function sendDueReminders() {
  const currentHour = getISTHour();
  console.log(`[Reminders] Running at IST hour ${currentHour}`);

  // Get all active users with reminders enabled
  const { data: users } = await supabase
    .from("users")
    .select("phone, reminders_enabled, weight_day, paused_until")
    .eq("reminders_enabled", true);

  if (!users || users.length === 0) {
    console.log("[Reminders] No users with reminders enabled");
    return { sent: 0 };
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  let sent = 0;

  for (const user of users) {
    // Skip if paused
    if (user.paused_until && new Date(user.paused_until) > new Date()) continue;

    for (const [key, reminder] of Object.entries(REMINDERS)) {
      // Only run reminders for the current hour
      if (reminder.checkHour !== currentHour) continue;

      try {
        const alreadyLogged = await reminder.check(user.phone, user);
        if (alreadyLogged) continue; // Already done, no reminder needed

        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: `whatsapp:${user.phone}`,
          body: reminder.message,
        });

        sent++;
        console.log(`[Reminders] Sent ${key} reminder to ${user.phone.slice(-4)}`);
      } catch (err) {
        console.error(`[Reminders] Error for ${user.phone.slice(-4)} ${key}:`, err.message);
      }
    }
  }

  console.log(`[Reminders] Done. Sent ${sent} reminders.`);
  return { sent };
}

module.exports = { sendDueReminders, REMINDERS };
