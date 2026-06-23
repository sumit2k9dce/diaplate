// lib/router.js — V2.1: edge cases, junk handling, meal timing, smart disambiguation
const { analyzePlate } = require("./plate-analyzer");
const { askDiabetesQuestion } = require("./health-advisor");
const { db } = require("./database");
const { computeMetrics, formatWeeklySummary } = require("./metrics");

// IST hour helper
function getISTHour() {
  const now = new Date();
  return (now.getUTCHours() + 5 + (now.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
}

// Auto-detect meal from IST time
function guessMealFromTime() {
  const h = getISTHour();
  if (h >= 5 && h < 11) return "Breakfast";
  if (h >= 11 && h < 16) return "Lunch";
  if (h >= 16 && h < 18) return "Evening Snack";
  if (h >= 18 && h < 23) return "Dinner";
  return "Late Night Snack";
}

function detectIntent(message) {
  const text = message.text.toLowerCase().trim();

  // Empty or whitespace-only
  if (!text && !message.hasImage) return "EMPTY";

  // Image handling
  if (message.hasImage) {
    if (/lab|report|blood\s*test|test\s*result/i.test(text)) return "LAB_REPORT";
    return "PLATE_PHOTO";
  }

  // Very short gibberish (single chars, random symbols)
  if (text.length === 1 && !/\d/.test(text)) return "GIBBERISH";

  // Sugar: STRICT validation — only 50-500 range
  const sugarTypes = [
    { pattern: /(?:post[\s-]*meal|after\s*(?:food|lunch|dinner|breakfast)|pp)\s*[:\-]?\s*(\d{2,3})/i, type: "post_meal" },
    { pattern: /(?:before\s*(?:food|lunch|dinner|breakfast)|pre[\s-]*meal|fasting|morning)\s*[:\-]?\s*(\d{2,3})/i, type: "fasting" },
    { pattern: /(?:bedtime|night|before\s*sleep)\s*[:\-]?\s*(\d{2,3})/i, type: "bedtime" },
    { pattern: /(?:random|anytime)\s*[:\-]?\s*(\d{2,3})/i, type: "random" },
    { pattern: /(?:sugar|bs|glucose|reading)\s*[:\-]?\s*(\d{2,3})/i, type: "fasting" },
  ];
  for (const { pattern, type } of sugarTypes) {
    const m = text.match(pattern);
    if (m) { const v = parseInt(m[1]); if (v >= 50 && v <= 500) return { type: "SUGAR", value: v, readingType: type }; }
  }

  // Bare number: ONLY 50-500 = sugar. Anything else = reject or ask
  const bareNum = text.match(/^(\d+)$/);
  if (bareNum) {
    const v = parseInt(bareNum[1]);
    if (v >= 50 && v <= 500) return { type: "SUGAR", value: v, readingType: "fasting" };
    // Outside sugar range = junk number
    return { type: "JUNK_NUMBER", value: v };
  }

  // Steps: MUST have "steps" or "walked" keyword
  for (const pat of [/(\d{3,5})\s*(?:steps?)/i, /(?:steps?|walked)\s*[:\-]?\s*(\d{3,5})/i]) {
    const m = text.match(pat);
    if (m) { const v = parseInt(m[1] || m[2]); if (v >= 100 && v <= 50000) return { type: "STEPS", value: v }; }
  }
  const kMatch = text.match(/(\d{1,2})[kK]\s*(?:steps?)/i);
  if (kMatch) return { type: "STEPS", value: parseInt(kMatch[1]) * 1000 };

  // Exercise
  const exMatch = text.match(/(?:walked|yoga|swimming|cycling|cycled|gym|exercise|jogged|running|ran|pilates|zumba|dance)\s*(?:for\s*)?(\d{1,3})\s*(?:min|mins|minutes|hr|hrs|hour|hours)/i);
  if (exMatch) {
    const etype = text.match(/(walk|yoga|swim|cycl|gym|jog|run|pilates|zumba|dance)/i)?.[1] || "exercise";
    let mins = parseInt(exMatch[1]);
    if (/hr|hour/i.test(exMatch[0])) mins *= 60;
    return { type: "EXERCISE", exerciseType: etype, duration: mins };
  }

  // Weight: MUST have "kg" or "weight/wt" keyword to avoid ambiguity
  for (const pat of [/(?:weight|wt|weigh)\s*[:\-]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg)?/i, /^(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs)$/i]) {
    const m = text.match(pat);
    if (m) { const v = parseFloat(m[1]); if (v >= 30 && v <= 200) return { type: "WEIGHT", value: v }; }
  }

  // Height
  const hCm = text.match(/(?:height)\s*[:\-]?\s*(\d{2,3})\s*(?:cm)?/i);
  if (hCm) { const v = parseInt(hCm[1]); if (v >= 100 && v <= 250) return { type: "HEIGHT", value: v }; }
  const hFt = text.match(/(\d)['\s]*(?:ft|feet|foot)?\s*(\d{1,2})?\s*(?:"|in|inch)?/i);
  if (hFt && !bareNum) { const ft = parseInt(hFt[1]); if (ft >= 4 && ft <= 7) return { type: "HEIGHT", value: Math.round(ft * 30.48 + parseInt(hFt[2] || 0) * 2.54) }; }

  // Commands
  if (/^(?:summary|weekly|report)$/i.test(text)) return "SUMMARY";
  if (/^(?:hi|hello|hey|start|help)$/i.test(text)) return "WELCOME";
  if (/^(?:setup|profile)$/i.test(text)) return "SETUP";
  if (/^(?:menu|settings|controls)$/i.test(text)) return "MENU";
  if (/^reminders?\s+(on|off)$/i.test(text)) return { type: "REMINDERS_TOGGLE", value: text.match(/on|off/i)[0].toLowerCase() };
  if (/^(?:target|goal)\s*(?:steps?)?\s*(\d{3,5})$/i.test(text)) return { type: "SET_STEP_TARGET", value: parseInt(text.match(/(\d{3,5})/)[1]) };
  if (/^weight\s*day\s+(\w+)$/i.test(text)) return { type: "SET_WEIGHT_DAY", value: text.match(/day\s+(\w+)/i)[1].toLowerCase() };
  if (/^pause\s+(\d{1,2})\s*(?:days?)?$/i.test(text)) return { type: "PAUSE", value: parseInt(text.match(/(\d{1,2})/)[1]) };
  if (/^(?:resume|unpause)$/i.test(text)) return "RESUME";
  if (/^(?:my\s*data|my\s*stats|stats)$/i.test(text)) return "MY_DATA";
  if (/^(?:export|download|csv)$/i.test(text)) return "EXPORT";
  if (/^(?:share\s*(?:with\s*)?doctor|doctor\s*report|for\s*doctor)$/i.test(text)) return "DOCTOR_SHARE";
  if (/^(?:hba1c|a1c|estimated\s*a1c)$/i.test(text)) return "HBA1C";
  if (/^(?:correlation|food\s*impact|what\s*spikes)/i.test(text)) return "CORRELATION";

  return "QUESTION";
}

async function handleIncomingMessage(message) {
  const { phone } = message;
  let user = await db.getUser(phone);
  if (!user) user = await db.createUser(phone);

  const intent = detectIntent(message);

  // ── Empty / Gibberish ──
  if (intent === "EMPTY") return "I didn't receive any text or image. Send a meal photo, a sugar reading, or type *help* to see what I can do.";
  if (intent === "GIBBERISH") return "I didn't understand that. Type *help* to see what I can do, or send a meal photo 📸";

  // ── Junk Number ──
  if (intent.type === "JUNK_NUMBER") {
    const v = intent.value;
    if (v < 50) return `${v} seems too low for a sugar reading (normal fasting range is 80\u2013100). Did you mean something else? For sugar, type a number between 50\u2013500. For weight, type *${v} kg*. For steps, type *${v} steps*.`;
    if (v > 500 && v < 1000) return `${v} is out of range. Sugar readings are typically 50\u2013500. Did you mean *${v} steps*?`;
    if (v >= 1000) return `That number is too large for a sugar reading. Did you mean *${v} steps*? Or type *help* to see all commands.`;
    return "I'm not sure what that number means. For sugar, type a number like *110*. For steps, type *5000 steps*. For weight, type *73.5 kg*.";
  }

  // ── Plate Photo ──
  if (intent === "PLATE_PHOTO") {
    if (!message.imageUrl) return "I couldn't access the image. Please try sending the photo again.";

    const todayMeals = await db.getTodayMealCount(phone);
    const todayCals = await db.getTodayCalories(phone);
    const enrichedUser = { ...user, today_meals: todayMeals, today_calories: todayCals };
    const a = await analyzePlate(message.imageUrl, message.imageType, enrichedUser);

    // Non-food image — don't log!
    if (!a.isFood) {
      return `That doesn't look like food to me 😄\n\n_${a.description}_\n\nPlease send a photo of your meal plate, snack, or drink and I'll analyze it for you!`;
    }

    // Food detected — log it
    await db.logMeal(phone, a);
    const n = todayMeals + 1;
    const mealGuess = message.text && /breakfast|lunch|dinner|snack/i.test(message.text)
      ? message.text.match(/breakfast|lunch|dinner|snack/i)[0]
      : guessMealFromTime();
    const label = a.mealType === "snack" || a.mealType === "fruit" || a.mealType === "dessert"
      ? a.mealType.charAt(0).toUpperCase() + a.mealType.slice(1)
      : mealGuess;

    let r = `🍽️ *${label} Analysis*\n\n`;
    r += `*What I see:* ${a.description}\n\n`;

    if (a.mealType === "full_meal" && a.tplateScore != null) {
      r += `*T-Plate Score:* ${a.tplateScore}/10\n`;
      r += `  🥬 Fibre: ${a.vegPercent}% (target: 50%)\n`;
      r += `  🍗 Protein: ${a.proteinPercent}% (target: 25%)\n`;
      r += `  🍚 Carbs: ${a.carbPercent}% (target: 25%)\n\n`;
    }

    r += `*Calories:* ~${a.calories} kcal\n`;
    r += `*Glycemic Load:* ${a.glycemicLoad}\n`;
    if (a.postMealPrediction) r += `*Sugar Impact:* ${a.postMealPrediction}\n`;
    r += `\n`;

    if (a.pairingAdvice) r += `🔄 *Try adding:* ${a.pairingAdvice}\n`;
    r += `💡 *Tip:* ${a.suggestion}`;

    if (n >= 3) r += `\n\n📊 *Today's total:* ~${todayCals + a.calories} kcal across ${n} meals.`;
    if (a.glycemicLoad === "High") r += `\n\n👣 A 10-15 min walk now can reduce the sugar spike by 15-30%.`;

    const streak = user.streak_meals || 0;
    if (streak > 0 && streak % 7 === 0) r += `\n\n🔥 ${streak}-day meal logging streak!`;

    // Prompt for post-meal sugar later
    r += `\n\n_Tip: Type "post-meal" + your sugar reading 2 hrs after eating (e.g. "post-meal 155") to track how this meal affects your sugar._`;

    return r;
  }

  // ── Lab Report Photo ──
  if (intent === "LAB_REPORT") {
    if (!message.imageUrl) return "Please send a photo of your lab report and I'll help you understand the results.";
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI2 = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
      const response = await fetch(message.imageUrl, {
        headers: { Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64") },
      });
      const buf = await response.arrayBuffer();
      const model = genAI2.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent([
        { text: "You are a diabetes health companion. Read this lab report photo. Explain each value simply. Compare against diabetic targets: HbA1c < 7%, Fasting 80-130, LDL < 100, HDL > 40(M)/50(F), Triglycerides < 150, Creatinine 0.7-1.3, BP < 130/80. Flag concerning values with ⚠️. Be friendly. End with: 'Discuss with your doctor for personalized guidance.' NEVER suggest medication changes. If this is NOT a lab report, say so." },
        { inlineData: { mimeType: message.imageType || "image/jpeg", data: Buffer.from(buf).toString("base64") } },
        { text: "Read and explain this for a diabetic patient." },
      ]);
      return `🔬 *Lab Report Analysis*\n\n${result.response.text()}\n\n_Always discuss lab results with your doctor._`;
    } catch (err) {
      console.error("Lab report error:", err);
      return "I had trouble reading the report. Please send a clear, well-lit photo. You can also type specific values like \"my HbA1c is 7.2, what does that mean?\"";
    }
  }

  // ── Sugar Reading ──
  if (intent.type === "SUGAR") {
    const v = intent.value;
    const rt = intent.readingType || "fasting";
    await db.logSugar(phone, v, rt);
    const s = await db.getSugarStats(phone, 7);

    const targets = {
      fasting: { low: 70, ideal: 100, high: 130, danger: 250, label: "Fasting" },
      post_meal: { low: 70, ideal: 140, high: 180, danger: 300, label: "Post-meal (2hr)" },
      bedtime: { low: 90, ideal: 120, high: 150, danger: 250, label: "Bedtime" },
      random: { low: 70, ideal: 140, high: 200, danger: 300, label: "Random" },
    };
    const t = targets[rt] || targets.fasting;

    let zone, emoji;
    if (v < t.low) { zone = "LOW ⚠️"; emoji = "🔴"; }
    else if (v <= t.ideal) { zone = "Normal"; emoji = "🟢"; }
    else if (v <= t.high) { zone = "Slightly elevated"; emoji = "🟡"; }
    else if (v < t.danger) { zone = "High"; emoji = "🟠"; }
    else { zone = "VERY HIGH ⚠️"; emoji = "🔴"; }

    let r = `${emoji} *${t.label} Sugar: ${v} mg/dL* — ${zone}\n\n`;
    r += `📈 *7-day avg:* ${s.average} mg/dL`;
    r += s.trend === "down" ? " (↓ improving!)" : s.trend === "up" ? " (↑ let's watch)" : " (stable)";
    r += `\n*In range:* ${s.inRangePct}% of readings`;
    r += `\n*${t.label} target:* ${t.low}\u2013${t.ideal} mg/dL`;

    if (v >= t.danger) r += `\n\n⚠️ *This is significantly high. Please contact your doctor today.*`;
    else if (v < t.low) r += `\n\n⚠️ *Low sugar. Eat something sugary immediately. Recheck in 15 minutes.*`;
    if (rt === "post_meal") r += `\n\n💡 Post-meal readings help identify which foods spike YOUR sugar. Keep it up!`;
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
    r += pct >= 100 ? "\n✅ Target hit! Walking lowers post-meal sugar by 15-30%." : `\n💡 ${(target - v).toLocaleString()} more to go. A 15-min post-dinner walk adds ~1,500 steps.`;
    return r;
  }

  // ── Exercise ──
  if (intent.type === "EXERCISE") {
    await db.logExercise(phone, intent.exerciseType, intent.duration);
    const weekExercise = await db.getExerciseInRange(phone, 7);
    const weekMins = weekExercise.reduce((s, e) => s + (e.duration_mins || 0), 0);
    const pct = Math.round((weekMins / 150) * 100);
    let r = `🏃 *Exercise logged:* ${intent.exerciseType} for ${intent.duration} min\n\n`;
    r += `📅 *This week:* ${weekExercise.length} sessions, ${weekMins} min total (${pct}% of 150 min goal${pct >= 100 ? " ✅" : ""})\n`;
    r += `\n💡 Regular exercise improves insulin sensitivity for up to 48 hours.`;
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
    if (prev) { const d = (v - prev.value).toFixed(1); r += `*Since last weigh-in (${prev.daysAgo}d ago):* ${d > 0 ? "+" + d : d} kg\n`; if (d < 0) r += `\n👏 Weight loss improves insulin sensitivity!\n`; }
    r += `\n*Safe ranges for diabetics:*\n  HbA1c: < 7.0%  |  Fasting: 80\u2013130\n  LDL: < 100  |  HDL: > 40/50\n  Triglycerides: < 150  |  BP: < 130/80`;
    return r;
  }

  // ── Height ──
  if (intent.type === "HEIGHT") {
    await db.updateUser(phone, { height_cm: intent.value });
    const ft = `${Math.floor(intent.value / 30.48)}'${Math.round((intent.value % 30.48) / 2.54)}"`;
    return `✅ Height set: ${intent.value} cm (${ft}). Now share your weight for BMI.`;
  }

  // ── HbA1c Estimate ──
  if (intent === "HBA1C") {
    const hba1c = await db.getHbA1cEstimate(phone);
    if (!hba1c) return "I need at least 2 weeks of daily sugar readings to estimate HbA1c. Keep logging and check back!";
    const val = parseFloat(hba1c);
    let r = `🔬 *Estimated HbA1c: ~${hba1c}%*\n\n`;
    if (val < 5.7) r += "This is in the *normal* range. Excellent!";
    else if (val < 6.5) r += "This is in the *pre-diabetic* range. Lifestyle changes can bring this down.";
    else if (val < 7.0) r += "This is *at target* for most diabetics. Good management!";
    else if (val < 8.0) r += "This is *above target*. Focus on diet and activity.";
    else r += "This is *significantly above target*. Please consult your doctor.";
    r += `\n\n_(Estimated from 90-day avg sugar. Lab test is the gold standard.)_\n_Consult your doctor for treatment decisions._`;
    return r;
  }

  // ── Food-Sugar Correlation ──
  if (intent === "CORRELATION") {
    const corr = await db.getFoodSugarCorrelation(phone);
    const actCorr = await db.getActivitySugarCorrelation(phone);
    let r = "📈 *Your Personal Food & Activity Impact*\n\n";
    if (corr && Object.keys(corr).length > 0) {
      r += "*Food → Post-meal sugar:*\n";
      for (const [food, avg] of Object.entries(corr).sort((a, b) => b[1] - a[1])) r += `  ${food}: avg ${avg} mg/dL ${avg > 160 ? "⚠️" : avg < 140 ? "✅" : ""}\n`;
      r += "\n";
    } else { r += "Not enough data for food correlations yet. Log meals + \"post-meal\" sugar to unlock this!\n\n"; }
    if (actCorr) {
      const diff = actCorr.lowStepDaySugar - actCorr.highStepDaySugar;
      if (diff > 5) { r += `*Activity → Next-morning sugar:*\n  Active days: ${actCorr.highStepDaySugar} mg/dL\n  Low-activity: ${actCorr.lowStepDaySugar} mg/dL\n  Walking saves ~${diff} mg/dL!\n`; }
    } else { r += "Keep logging steps and sugar for activity insights!\n"; }
    r += "\n💡 Type \"post-meal 165\" after meals to build your personal food database.";
    return r;
  }

  // ── Summary ──
  if (intent === "SUMMARY") { const m = await computeMetrics(phone); return formatWeeklySummary(m, user); }

  // ── Doctor Share ──
  if (intent === "DOCTOR_SHARE") {
    const m = await computeMetrics(phone);
    let r = `📋 *DiaPlate Report for Doctor*\n${"─".repeat(28)}\nDate: ${new Date().toLocaleDateString()}\n\n`;
    r += `*Sugar (7-day):* Avg ${m.sugarAvg} mg/dL, Trend: ${m.sugarTrend}, In-range: ${m.sugarInRangePct}%\n`;
    if (m.hba1c) r += `*Est. HbA1c:* ~${m.hba1c}%\n`;
    r += `*Meals logged:* ${m.totalMeals}/week, Avg T-Plate: ${m.avgTplate || "—"}/10\n`;
    r += `*Activity:* ${m.stepsAvg.toLocaleString()} steps/day avg\n`;
    if (m.latestWeight) { r += `*Weight:* ${m.latestWeight.value} kg`; if (user.height_cm) r += ` (BMI: ${(m.latestWeight.value / ((user.height_cm / 100) ** 2)).toFixed(1)})`; r += `\n`; }
    r += `\n_Forward this message to your doctor on WhatsApp._`;
    return r;
  }

  // ── My Data ──
  if (intent === "MY_DATA") {
    const stats = await db.getLoggingStats(phone, 30);
    const daysSince = Math.max(1, Math.round((Date.now() - new Date(user.created_at).getTime()) / 86400000));
    return `📊 *Your DiaPlate Data (30 days)*\n\n🍽️ Meals: ${stats.meals}\n🩸 Sugar: ${stats.sugars}\n👣 Steps: ${stats.steps}\n⚖️ Weight: ${stats.weights}\n\n📅 Member for ${daysSince} days\n🔥 Meal streak: ${user.streak_meals || 0} days | Sugar streak: ${user.streak_sugar || 0} days\n\nType *summary* for weekly report\nType *hba1c* for estimated HbA1c\nType *correlation* for food-sugar insights`;
  }

  // ── Menu ──
  if (intent === "MENU") {
    const rem = user.reminders_enabled !== false ? "ON ✅" : "OFF";
    const pause = user.paused_until && new Date(user.paused_until) > new Date() ? ` (paused until ${new Date(user.paused_until).toLocaleDateString()})` : "";
    return `⚙️ *Settings & Controls*\n\n*Profile:*\n  Height: ${user.height_cm ? user.height_cm + " cm" : "Not set"}\n  Step target: ${user.step_target || 7000}/day\n  Weight day: ${(user.weight_day || "friday").charAt(0).toUpperCase() + (user.weight_day || "friday").slice(1)}\n  Reminders: ${rem}${pause}\n\n*Commands:*\n  *reminders on/off* — toggle nudges\n  *target 8000* — change step goal\n  *weight day monday* — change weigh-in day\n  *pause 3 days* — mute reminders\n  *resume* — unpause\n  *my data* — tracking stats\n  *hba1c* — estimated HbA1c\n  *correlation* — food-sugar insights\n  *share doctor* — doctor-ready report\n  *summary* — weekly health report\n\n*Tips:*\n  📸 Send meal photo for analysis\n  🔬 Send lab report photo with "lab report"\n  💬 Type "post-meal 165" for post-meal sugar\n  🏃 Type "walked 30 mins" for exercise`;
  }

  // ── Reminders ──
  if (intent.type === "REMINDERS_TOGGLE") { const on = intent.value === "on"; await db.updateUser(phone, { reminders_enabled: on, paused_until: null }); return on ? "🔔 *Reminders ON.* I'll nudge you on missed meals and sugar." : "🔕 *Reminders OFF.* Type *reminders on* anytime."; }
  if (intent.type === "SET_STEP_TARGET") { if (intent.value < 1000 || intent.value > 30000) return "Step target should be 1,000\u201330,000. Try: *target 7000*"; await db.updateUser(phone, { step_target: intent.value }); return `🎯 *Step target: ${intent.value.toLocaleString()}/day.*`; }
  if (intent.type === "SET_WEIGHT_DAY") { const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]; if (!days.includes(intent.value)) return "Use a day name: *weight day friday*"; await db.updateUser(phone, { weight_day: intent.value }); return `📅 *Weigh-in day: ${intent.value.charAt(0).toUpperCase() + intent.value.slice(1)}.*`; }
  if (intent.type === "PAUSE") { const d = Math.min(intent.value, 30); const until = new Date(Date.now() + d * 86400000); await db.updateUser(phone, { paused_until: until.toISOString() }); return `⏸️ *Reminders paused ${d} days.* Type *resume* to unpause.`; }
  if (intent === "RESUME") { await db.updateUser(phone, { paused_until: null, reminders_enabled: true }); return "▶️ *Reminders resumed!*"; }

  // ── Welcome ──
  if (intent === "WELCOME") {
    const daysSince = Math.round((Date.now() - new Date(user.created_at).getTime()) / 86400000);
    if (daysSince > 0 && user.streak_meals > 0) {
      // Returning user — shorter welcome
      return `👋 *Welcome back!*\n\n🔥 Meal streak: ${user.streak_meals} days\n📊 Type *summary* for your weekly report\n\nSend a meal photo, sugar reading, or ask me anything!\n\nType *help* for all commands.`;
    }
    return `👋 *Welcome to DiaPlate!*

Your AI-powered diabetes companion — right here on WhatsApp. No app to install, no forms to fill. Just chat.

━━━━━━━━━━━━━━━━━━━━

📸 *Meal Analysis*
Send any food photo — full plate, snack, fruit, restaurant meal. I'll analyze calories, glycemic load, and score full meals against the T-Plate method (50% fibre, 25% protein, 25% carbs).

🩸 *Sugar Tracking*
Type a number → fasting sugar (e.g. *110*)
Type *post-meal 165* → after-meal reading

👣 *Activity & Exercise*
Type *5000 steps* or *walked 30 mins*

⚖️ *Weight & BMI*
Type *73.5 kg* → weekly weigh-in with BMI tracking.

━━━━━━━━━━━━━━━━━━━━

🧠 *Smart Features*
🔬 *hba1c* → Estimated HbA1c from your data
📈 *correlation* → Which foods spike YOUR sugar
🔬 Send *lab report* photo → I'll explain your blood test
📋 *share doctor* → Report to forward to your doctor
📊 *summary* → Weekly health report

⚙️ Type *menu* for settings

━━━━━━━━━━━━━━━━━━━━

*Get started:* type *height 170 cm*

_DiaPlate is a lifestyle companion, not a medical device. Always follow your doctor's advice._`;
  }
  if (intent === "SETUP") return `⚙️ *Setup:*\n\n1️⃣ Type *height 170 cm*\n2️⃣ Type your fasting sugar (e.g. *105*)\n3️⃣ Send a meal photo\n\nType *menu* for all commands.`;

  // ── Question (catch-all) ──
  if (intent === "QUESTION") return await askDiabetesQuestion(message.text, user);

  return "I didn't understand that. Type *help* to see what I can do, or send a meal photo 📸";
}

module.exports = { handleIncomingMessage, detectIntent };
