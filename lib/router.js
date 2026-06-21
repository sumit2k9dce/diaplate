// lib/router.js — Message intent detection and routing
const { analyzePlate } = require("./plate-analyzer");
const { askDiabetesQuestion } = require("./health-advisor");
const { db } = require("./database");
const { computeMetrics, formatWeeklySummary } = require("./metrics");

function detectIntent(message) {
  const text = message.text.toLowerCase().trim();
  if (message.hasImage) return "PLATE_PHOTO";

  // Sugar reading: number 50-500, or "sugar 110", "fasting 95"
  for (const pat of [/^(\d{2,3})$/, /(?:sugar|fasting|bs|glucose)\s*[:\-]?\s*(\d{2,3})/i, /^(\d{2,3})\s*(?:mg|sugar|fasting)/i]) {
    const m = text.match(pat);
    if (m) { const v = parseInt(m[1] || m[2]); if (v >= 50 && v <= 500) return { type: "SUGAR", value: v }; }
  }

  // Steps: "5000 steps", "steps 8200", "walked 6k"
  for (const pat of [/(\d{3,5})\s*(?:steps?)/i, /(?:steps?|walked)\s*[:\-]?\s*(\d{3,5})/i]) {
    const m = text.match(pat);
    if (m) { const v = parseInt(m[1] || m[2]); if (v >= 100 && v <= 50000) return { type: "STEPS", value: v }; }
  }
  const kMatch = text.match(/(\d{1,2})[kK]\s*(?:steps?)/i);
  if (kMatch) return { type: "STEPS", value: parseInt(kMatch[1]) * 1000 };

  // Weight: "73.5 kg", "weight 74", "wt 73"
  for (const pat of [/(?:weight|wt|weigh)\s*[:\-]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg)?/i, /^(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs)$/i]) {
    const m = text.match(pat);
    if (m) { const v = parseFloat(m[1]); if (v >= 30 && v <= 200) return { type: "WEIGHT", value: v }; }
  }

  // Height: "height 170 cm" or "5'8"
  const hCm = text.match(/(?:height)\s*[:\-]?\s*(\d{2,3})\s*(?:cm)?/i);
  if (hCm) { const v = parseInt(hCm[1]); if (v >= 100 && v <= 250) return { type: "HEIGHT", value: v }; }
  const hFt = text.match(/(\d)['\s]*(?:ft|feet|foot)?\s*(\d{1,2})?\s*(?:"|in|inch)?/i);
  if (hFt) { const ft = parseInt(hFt[1]); if (ft >= 4 && ft <= 7) return { type: "HEIGHT", value: Math.round(ft * 30.48 + parseInt(hFt[2] || 0) * 2.54) }; }

  if (/^(?:summary|weekly|report)$/i.test(text)) return "SUMMARY";
  if (/^(?:hi|hello|hey|start|help)$/i.test(text)) return "WELCOME";
  if (/^(?:setup|profile)$/i.test(text)) return "SETUP";
  if (/^(?:menu|settings|controls)$/i.test(text)) return "MENU";
  if (/^reminders?\s+(on|off)$/i.test(text)) return { type: "REMINDERS_TOGGLE", value: text.match(/on|off/i)[0].toLowerCase() };
  if (/^(?:target|goal)\s*(?:steps?)?\s*(\d{3,5})$/i.test(text)) { const m = text.match(/(\d{3,5})/); return { type: "SET_STEP_TARGET", value: parseInt(m[1]) }; }
  if (/^weight\s*day\s+(\w+)$/i.test(text)) { const d = text.match(/day\s+(\w+)/i); return { type: "SET_WEIGHT_DAY", value: d[1].toLowerCase() }; }
  if (/^pause\s+(\d{1,2})\s*(?:days?)?$/i.test(text)) { const m = text.match(/(\d{1,2})/); return { type: "PAUSE", value: parseInt(m[1]) }; }
  if (/^(?:resume|unpause)$/i.test(text)) return "RESUME";
  if (/^(?:my\s*data|my\s*stats|stats)$/i.test(text)) return "MY_DATA";
  return "QUESTION";
}

async function handleIncomingMessage(message) {
  const { phone } = message;
  let user = await db.getUser(phone);
  if (!user) user = await db.createUser(phone);

  const intent = detectIntent(message);

  // ── Plate Photo ──
  if (intent === "PLATE_PHOTO") {
    if (!message.imageUrl) return "I couldn't access the image. Please try sending the photo again.";
    const a = await analyzePlate(message.imageUrl, message.imageType, user);
    await db.logMeal(phone, a);
    const n = await db.getTodayMealCount(phone);
    const label = n === 1 ? "Breakfast" : n === 2 ? "Lunch" : n === 3 ? "Dinner" : `Meal #${n}`;
    let r = `🍽️ *${label} Analysis*\n\n*T-Plate Score:* ${a.tplateScore}/10\n*Estimated Calories:* ${a.calories} kcal\n*Glycemic Load:* ${a.glycemicLoad}\n\n*What I see:* ${a.description}\n\n*T-Plate Breakdown:*\n  🥬 Fibre: ${a.vegPercent}% (target: 50%)\n  🍗 Protein: ${a.proteinPercent}% (target: 25%)\n  🍚 Carbs: ${a.carbPercent}% (target: 25%)\n\n💡 *Tip:* ${a.suggestion}`;
    if (n >= 3) { const cal = await db.getTodayCalories(phone); r += `\n\n📊 *Today's total:* ${cal} kcal across ${n} meals.`; }
    return r;
  }

  // ── Sugar Reading ──
  if (intent.type === "SUGAR") {
    const v = intent.value;
    await db.logSugar(phone, v);
    const s = await db.getSugarStats(phone, 7);
    let zone, emoji;
    if (v < 70) { zone = "LOW ⚠️"; emoji = "🔴"; }
    else if (v <= 100) { zone = "Normal"; emoji = "🟢"; }
    else if (v <= 125) { zone = "Slightly elevated"; emoji = "🟡"; }
    else if (v <= 180) { zone = "High"; emoji = "🟠"; }
    else { zone = "VERY HIGH ⚠️"; emoji = "🔴"; }
    let r = `${emoji} *Fasting Sugar: ${v} mg/dL* — ${zone}\n\n📈 *7-day average:* ${s.average} mg/dL`;
    r += s.trend === "down" ? " (trending ↓ great!)" : s.trend === "up" ? " (trending ↑ let's watch)" : " (stable)";
    r += `\n\n*Target ranges:*\n  Fasting: 80–100 mg/dL (ideal)\n  Before meals: 80–130 mg/dL\n  2hrs after meals: < 180 mg/dL`;
    if (v > 250) r += `\n\n⚠️ *Reading is significantly high. Please consult your doctor today.*`;
    if (v < 70) r += `\n\n⚠️ *Low sugar. Eat something with sugar immediately (juice, glucose tablet). Recheck in 15 minutes.*`;
    return r;
  }

  // ── Steps ──
  if (intent.type === "STEPS") {
    const v = intent.value;
    await db.logSteps(phone, v);
    const avg = await db.getStepsAvg(phone, 7);
    const target = user.step_target || 7000;
    const pct = Math.round((v / target) * 100);
    let r = `${pct >= 100 ? "🎉" : "👣"} *Steps: ${v.toLocaleString()}* (${pct}% of ${target.toLocaleString()} target)\n\n📈 *7-day avg:* ${avg.toLocaleString()} steps/day\n`;
    r += pct >= 100 ? "\n✅ Target hit! Walking helps lower post-meal sugar by 15-30%." : `\n💡 ${(target - v).toLocaleString()} more to go. A 15-min post-dinner walk adds ~1,500 steps.`;
    return r;
  }

  // ── Weight ──
  if (intent.type === "WEIGHT") {
    const v = intent.value;
    await db.logWeight(phone, v);
    let r = `⚖️ *Weight: ${v} kg*\n\n`;
    if (user.height_cm) {
      const bmi = (v / ((user.height_cm / 100) ** 2)).toFixed(1);
      const cat = bmi < 18.5 ? "Underweight" : bmi < 23 ? "Normal (Asian)" : bmi < 25 ? "Overweight" : "Obese";
      r += `*BMI:* ${bmi} — ${cat}\n_(Asian standard: Normal < 23)_\n\n`;
    } else { r += `_Set height for BMI: type "height 170 cm"_\n\n`; }
    const prev = await db.getPreviousWeight(phone);
    if (prev) { const d = (v - prev.value).toFixed(1); r += `*Since last weigh-in (${prev.daysAgo}d ago):* ${d > 0 ? "+" + d : d} kg\n`; }
    r += `\n*Safe ranges for diabetics:*\n  HbA1c: < 7.0%\n  Fasting sugar: 80–130 mg/dL\n  LDL: < 100 mg/dL\n  HDL: > 40 (M) / > 50 (F)\n  Triglycerides: < 150 mg/dL\n  BP: < 130/80 mmHg`;
    return r;
  }

  // ── Height ──
  if (intent.type === "HEIGHT") {
    await db.updateUser(phone, { height_cm: intent.value });
    const ft = `${Math.floor(intent.value / 30.48)}'${Math.round((intent.value % 30.48) / 2.54)}"`;
    return `✅ Height set: ${intent.value} cm (${ft}). Now share your weight for BMI.`;
  }

  // ── Summary ──
  if (intent === "SUMMARY") {
    const m = await computeMetrics(phone);
    return formatWeeklySummary(m, user);
  }

  // ── Welcome ──
  if (intent === "WELCOME") {
    return `👋 *Welcome to DiaPlate!*\n\nYour AI companion for diabetes management on WhatsApp.\n\n*What I can do:*\n📸 *Send a meal photo* → T-Plate analysis (50% fibre, 25% protein, 25% carbs) + calories\n🩸 *Type a number (e.g. "110")* → Log fasting sugar + trends\n👣 *Type "5000 steps"* → Track activity\n⚖️ *Type "73.5 kg"* → Weight + BMI\n❓ *Ask anything* → "Can I eat mangoes?"\n📊 *Type "summary"* → Weekly health report\n⚙️ *Type "menu"* → Settings & controls\n\n*First step:* type "height 170 cm"\n\n_DiaPlate is a lifestyle companion, not a medical device. Always follow your doctor's advice._`;
  }

  if (intent === "SETUP") {
    return `⚙️ *Setup:*\n1. Set height: type "height 170 cm" or "height 5'8"\n2. Start sharing meal photos, sugar readings, steps, and weight.\n\n*Tip:* Share fasting sugar every morning — just type the number like "105".`;
  }

  // ── Menu / Settings ──
  if (intent === "MENU") {
    const remStatus = user.reminders_enabled !== false ? "ON ✅" : "OFF";
    const pauseStatus = user.paused_until && new Date(user.paused_until) > new Date()
      ? `PAUSED until ${new Date(user.paused_until).toLocaleDateString()}`
      : "";
    return `⚙️ *Settings & Controls*\n\n` +
      `📋 *Your Profile:*\n` +
      `  Height: ${user.height_cm ? user.height_cm + " cm" : "Not set"}\n` +
      `  Step target: ${user.step_target || 7000}/day\n` +
      `  Weight day: ${(user.weight_day || "friday").charAt(0).toUpperCase() + (user.weight_day || "friday").slice(1)}\n` +
      `  Reminders: ${remStatus} ${pauseStatus}\n\n` +
      `🎛️ *Commands:*\n` +
      `  *reminders on* / *reminders off*\n` +
      `  *target 8000* — change step goal\n` +
      `  *weight day monday* — change weigh-in day\n` +
      `  *height 170 cm* — set/update height\n` +
      `  *pause 3 days* — mute reminders temporarily\n` +
      `  *resume* — unpause reminders\n` +
      `  *my data* — see your tracking stats\n` +
      `  *summary* — weekly health report\n` +
      `  *help* — show all features`;
  }

  // ── Reminders Toggle ──
  if (intent.type === "REMINDERS_TOGGLE") {
    const enabled = intent.value === "on";
    await db.updateUser(phone, { reminders_enabled: enabled, paused_until: null });
    return enabled
      ? "🔔 *Reminders turned ON.* I'll nudge you if you miss meals, sugar, or steps.\n\nType *menu* to see all settings."
      : "🔕 *Reminders turned OFF.* I won't send any nudges. You can still log everything manually.\n\nType *reminders on* to re-enable anytime.";
  }

  // ── Set Step Target ──
  if (intent.type === "SET_STEP_TARGET") {
    const target = intent.value;
    if (target < 1000 || target > 30000) return "Step target should be between 1,000 and 30,000. Try: *target 7000*";
    await db.updateUser(phone, { step_target: target });
    return `🎯 *Step target updated: ${target.toLocaleString()} steps/day.*\n\nI'll track your progress against this new goal.`;
  }

  // ── Set Weight Day ──
  if (intent.type === "SET_WEIGHT_DAY") {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const day = intent.value;
    if (!days.includes(day)) return `Please use a day name: *weight day monday* or *weight day friday*`;
    await db.updateUser(phone, { weight_day: day });
    return `📅 *Weigh-in day set to ${day.charAt(0).toUpperCase() + day.slice(1)}.*\n\nI'll remind you to weigh in every ${day.charAt(0).toUpperCase() + day.slice(1)} morning.`;
  }

  // ── Pause Reminders ──
  if (intent.type === "PAUSE") {
    const days = Math.min(intent.value, 30); // max 30 days
    const until = new Date(Date.now() + days * 86400000);
    await db.updateUser(phone, { paused_until: until.toISOString() });
    return `⏸️ *Reminders paused for ${days} day${days > 1 ? "s" : ""}* (until ${until.toLocaleDateString()}).\n\nType *resume* to unpause earlier. You can still log everything manually.`;
  }

  // ── Resume Reminders ──
  if (intent === "RESUME") {
    await db.updateUser(phone, { paused_until: null, reminders_enabled: true });
    return "▶️ *Reminders resumed!* I'll nudge you on missed readings and meals.";
  }

  // ── My Data ──
  if (intent === "MY_DATA") {
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ count: mealCount }, { count: sugarCount }, { count: stepsCount }, { count: weightCount }] = await Promise.all([
      supabase.from("meals").select("*", { count: "exact", head: true }).eq("phone", phone).gte("logged_at", since30),
      supabase.from("sugar_readings").select("*", { count: "exact", head: true }).eq("phone", phone).gte("logged_at", since30),
      supabase.from("steps").select("*", { count: "exact", head: true }).eq("phone", phone).gte("logged_at", since30),
      supabase.from("weight").select("*", { count: "exact", head: true }).eq("phone", phone).gte("logged_at", since30),
    ]);
    const daysSinceJoin = Math.max(1, Math.round((Date.now() - new Date(user.created_at).getTime()) / 86400000));
    return `📊 *Your DiaPlate Data (last 30 days)*\n\n` +
      `🍽️ Meals logged: ${mealCount || 0}\n` +
      `🩸 Sugar readings: ${sugarCount || 0}\n` +
      `👣 Step entries: ${stepsCount || 0}\n` +
      `⚖️ Weight entries: ${weightCount || 0}\n\n` +
      `📅 Member for ${daysSinceJoin} day${daysSinceJoin > 1 ? "s" : ""}\n\n` +
      `Type *summary* for your detailed weekly health report.`;
  }

  // ── Question ──
  if (intent === "QUESTION") return await askDiabetesQuestion(message.text, user);

  return "I didn't understand that. Type *help* to see what I can do.";
}

module.exports = { handleIncomingMessage, detectIntent };
