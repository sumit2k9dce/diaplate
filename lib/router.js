// lib/router.js — Enhanced: exercise, post-meal sugar, lab photos, export, smart plate response
const { analyzePlate } = require("./plate-analyzer");
const { askDiabetesQuestion } = require("./health-advisor");
const { db } = require("./database");
const { computeMetrics, formatWeeklySummary } = require("./metrics");

function detectIntent(message) {
  const text = message.text.toLowerCase().trim();
  if (message.hasImage) {
    if (/lab|report|blood\s*test|test\s*result/i.test(text)) return "LAB_REPORT";
    return "PLATE_PHOTO";
  }

  // Sugar: support types — "post-meal 180", "after lunch 165", "bedtime 130", "random 145", plain "110"
  const sugarTypes = [
    { pattern: /(?:post[\s-]*meal|after\s*(?:food|lunch|dinner|breakfast)|pp|post\s*prandial)\s*[:\-]?\s*(\d{2,3})/i, type: "post_meal" },
    { pattern: /(?:before\s*(?:food|lunch|dinner|breakfast)|pre[\s-]*meal|fasting|morning)\s*[:\-]?\s*(\d{2,3})/i, type: "fasting" },
    { pattern: /(?:bedtime|night|before\s*sleep)\s*[:\-]?\s*(\d{2,3})/i, type: "bedtime" },
    { pattern: /(?:random|anytime)\s*[:\-]?\s*(\d{2,3})/i, type: "random" },
    { pattern: /(?:sugar|bs|glucose|reading)\s*[:\-]?\s*(\d{2,3})/i, type: "fasting" },
    { pattern: /^(\d{2,3})\s*(?:mg|sugar|fasting|bs)?$/i, type: "fasting" },
  ];
  for (const { pattern, type } of sugarTypes) {
    const m = text.match(pattern);
    if (m) { const v = parseInt(m[1]); if (v >= 50 && v <= 500) return { type: "SUGAR", value: v, readingType: type }; }
  }

  // Steps
  for (const pat of [/(\d{3,5})\s*(?:steps?)/i, /(?:steps?|walked)\s*[:\-]?\s*(\d{3,5})/i]) {
    const m = text.match(pat); if (m) { const v = parseInt(m[1] || m[2]); if (v >= 100 && v <= 50000) return { type: "STEPS", value: v }; }
  }
  const kMatch = text.match(/(\d{1,2})[kK]\s*(?:steps?)/i);
  if (kMatch) return { type: "STEPS", value: parseInt(kMatch[1]) * 1000 };

  // Exercise: "walked 30 mins", "yoga 45 minutes", "swimming 1 hour", "cycled 20 min"
  const exMatch = text.match(/(?:walked|yoga|swimming|cycling|cycled|gym|exercise|jogged|running|ran|pilates|zumba|dance)\s*(?:for\s*)?(\d{1,3})\s*(?:min|mins|minutes|hr|hrs|hour|hours)/i);
  if (exMatch) {
    const type = text.match(/(walk|yoga|swim|cycl|gym|jog|run|pilates|zumba|dance)/i)?.[1] || "exercise";
    let mins = parseInt(exMatch[1]);
    if (/hr|hour/i.test(exMatch[0])) mins *= 60;
    return { type: "EXERCISE", exerciseType: type, duration: mins };
  }

  // Weight
  for (const pat of [/(?:weight|wt|weigh)\s*[:\-]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg)?/i, /^(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs)$/i]) {
    const m = text.match(pat); if (m) { const v = parseFloat(m[1]); if (v >= 30 && v <= 200) return { type: "WEIGHT", value: v }; }
  }

  // Height
  const hCm = text.match(/(?:height)\s*[:\-]?\s*(\d{2,3})\s*(?:cm)?/i);
  if (hCm) { const v = parseInt(hCm[1]); if (v >= 100 && v <= 250) return { type: "HEIGHT", value: v }; }
  const hFt = text.match(/(\d)['\s]*(?:ft|feet|foot)?\s*(\d{1,2})?\s*(?:"|in|inch)?/i);
  if (hFt) { const ft = parseInt(hFt[1]); if (ft >= 4 && ft <= 7) return { type: "HEIGHT", value: Math.round(ft * 30.48 + parseInt(hFt[2] || 0) * 2.54) }; }

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

  // ── Plate Photo ──
  if (intent === "PLATE_PHOTO") {
    if (!message.imageUrl) return "I couldn't access the image. Please try sending the photo again.";
    // Pass context for personalized analysis
    const todayMeals = await db.getTodayMealCount(phone);
    const todayCals = await db.getTodayCalories(phone);
    const enrichedUser = { ...user, today_meals: todayMeals, today_calories: todayCals };
    const a = await analyzePlate(message.imageUrl, message.imageType, enrichedUser);
    await db.logMeal(phone, a);

    const n = todayMeals + 1;
    const label = n === 1 ? "Breakfast" : n === 2 ? "Lunch" : n === 3 ? "Dinner" : `Meal #${n}`;

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

    // Post-meal sugar nudge (30 min context)
    if (a.glycemicLoad === "High") r += `\n\n👣 A short 10-15 min walk now can reduce the sugar spike from this meal by 15-30%.`;

    // Streak celebration
    const streak = user.streak_meals || 0;
    if (streak > 0 && streak % 7 === 0) r += `\n\n🔥 ${streak}-day meal logging streak! Keep going!`;

    return r;
  }

  // ── Lab Report Photo ──
  if (intent === "LAB_REPORT") {
    if (!message.imageUrl) return "Please send a photo of your lab report and I'll help you understand the results.";
    // Use plate analyzer infrastructure but with different prompt
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
      const response = await fetch(message.imageUrl, {
        headers: { Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64") },
      });
      const buf = await response.arrayBuffer();
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent([
        { text: "You are a diabetes health companion. The user sent a photo of their blood test / lab report. Read all values visible and explain each one simply. Compare against diabetic target ranges: HbA1c < 7%, Fasting sugar 80-130, LDL < 100, HDL > 40(M)/50(F), Triglycerides < 150, Creatinine 0.7-1.3, BP < 130/80. Flag anything concerning with ⚠️. Keep it friendly, not clinical. End with: 'Discuss these results with your doctor for personalized guidance.' IMPORTANT: never suggest medication changes." },
        { inlineData: { mimeType: message.imageType || "image/jpeg", data: Buffer.from(buf).toString("base64") } },
        { text: "Read and explain this lab report for a diabetic patient." },
      ]);
      return `🔬 *Lab Report Analysis*\n\n${result.response.text()}\n\n_Always discuss lab results with your doctor._`;
    } catch (err) {
      console.error("Lab report error:", err);
      return "I had trouble reading the report. Please send a clear, well-lit photo. For now, you can type specific values and ask about them (e.g. \"my HbA1c is 7.2, what does that mean?\").";
    }
  }

  // ── Sugar Reading (enhanced with types) ──
  if (intent.type === "SUGAR") {
    const v = intent.value;
    const rt = intent.readingType || "fasting";
    await db.logSugar(phone, v, rt);
    const s = await db.getSugarStats(phone, 7);

    // Different target ranges by reading type
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
    r += `📈 *7-day average:* ${s.average} mg/dL`;
    r += s.trend === "down" ? " (↓ improving!)" : s.trend === "up" ? " (↑ let's watch)" : " (stable)";
    r += `\n*In range:* ${s.inRangePct}% of readings`;

    r += `\n\n*${t.label} target:* ${t.low}–${t.ideal} mg/dL`;

    if (v >= t.danger) r += `\n\n⚠️ *This is significantly high. Please contact your doctor today.*`;
    else if (v < t.low) r += `\n\n⚠️ *Low sugar. Eat something sugary immediately. Recheck in 15 minutes.*`;

    // If post-meal sugar, relate to last meal
    if (rt === "post_meal") {
      r += `\n\n💡 Post-meal readings help identify which foods spike YOUR sugar. Keep pairing meals with post-meal checks!`;
    }

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

  // ── Exercise ──
  if (intent.type === "EXERCISE") {
    await db.logExercise(phone, intent.exerciseType, intent.duration);
    const weekExercise = await db.getExerciseInRange(phone, 7);
    const weekMins = weekExercise.reduce((s, e) => s + (e.duration_mins || 0), 0);
    const sessions = weekExercise.length;
    let r = `🏃 *Exercise logged:* ${intent.exerciseType} for ${intent.duration} minutes\n\n`;
    r += `📅 *This week:* ${sessions} sessions, ${weekMins} total minutes\n`;
    r += `*Recommended:* 150 mins/week of moderate exercise for diabetics\n`;
    const pct = Math.round((weekMins / 150) * 100);
    r += `*Progress:* ${pct}% of weekly goal`;
    if (pct >= 100) r += ` ✅`;
    r += `\n\n💡 Regular exercise improves insulin sensitivity for up to 48 hours after the session.`;
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
    r += `\n*Safe ranges for diabetics:*\n  HbA1c: < 7.0%  |  Fasting: 80–130\n  LDL: < 100  |  HDL: > 40/50\n  Triglycerides: < 150  |  BP: < 130/80`;
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
    if (!hba1c) return "I need at least 2 weeks of sugar readings to estimate HbA1c. Keep logging daily and check back!";
    let r = `🔬 *Estimated HbA1c: ~${hba1c}%*\n\n`;
    const val = parseFloat(hba1c);
    if (val < 5.7) r += "This is in the *normal* range. Excellent!";
    else if (val < 6.5) r += "This is in the *pre-diabetic* range. Lifestyle changes can bring this down.";
    else if (val < 7.0) r += "This is *at target* for most diabetics. Good management!";
    else if (val < 8.0) r += "This is *above target*. Focus on diet and activity — discuss with your doctor.";
    else r += "This is *significantly above target*. Please consult your doctor about your management plan.";
    r += `\n\n_(Estimated from your 90-day average sugar. Lab test is the gold standard.)_`;
    r += `\n\n_Consult your doctor for treatment decisions._`;
    return r;
  }

  // ── Food-Sugar Correlation ──
  if (intent === "CORRELATION") {
    const corr = await db.getFoodSugarCorrelation(phone);
    const actCorr = await db.getActivitySugarCorrelation(phone);
    let r = "📈 *Your Personal Food & Activity Impact*\n\n";
    if (corr && Object.keys(corr).length > 0) {
      r += "*Food → Post-meal sugar:*\n";
      const sorted = Object.entries(corr).sort((a, b) => b[1] - a[1]);
      for (const [food, avg] of sorted) r += `  ${food}: avg ${avg} mg/dL ${avg > 160 ? "⚠️" : avg < 140 ? "✅" : ""}\n`;
      r += "\n";
    } else { r += "Not enough data yet for food correlations. Log meals + post-meal sugar readings to unlock this!\n\n"; }
    if (actCorr) {
      r += "*Activity → Next-morning sugar:*\n";
      r += `  Active days (>${actCorr.avgSteps} steps): ${actCorr.highStepDaySugar} mg/dL\n`;
      r += `  Low-activity days: ${actCorr.lowStepDaySugar} mg/dL\n`;
      r += `  Difference: ${actCorr.lowStepDaySugar - actCorr.highStepDaySugar} mg/dL saved by walking!\n`;
    } else { r += "Not enough data for activity correlation yet. Keep logging steps and sugar!\n"; }
    r += "\n💡 *Tip:* Log \"post-meal 165\" after meals to build your personal food impact database.";
    return r;
  }

  // ── Summary ──
  if (intent === "SUMMARY") { const m = await computeMetrics(phone); return formatWeeklySummary(m, user); }

  // ── Doctor Share ──
  if (intent === "DOCTOR_SHARE") {
    const m = await computeMetrics(phone);
    let r = `📋 *DiaPlate Report for Doctor*\n${"─".repeat(28)}\nPatient phone: ${phone.slice(-4)}\nDate: ${new Date().toLocaleDateString()}\n\n`;
    r += `*Sugar (7-day):* Avg ${m.sugarAvg} mg/dL, Trend: ${m.sugarTrend}, In-range: ${m.sugarInRangePct}%\n`;
    if (m.hba1c) r += `*Est. HbA1c:* ~${m.hba1c}%\n`;
    r += `*Meals logged:* ${m.totalMeals}/week, Avg T-Plate: ${m.avgTplate || "—"}/10\n`;
    r += `*Activity:* ${m.stepsAvg.toLocaleString()} steps/day avg\n`;
    if (m.latestWeight) { r += `*Weight:* ${m.latestWeight.value} kg`; if (user.height_cm) { const bmi = (m.latestWeight.value / ((user.height_cm / 100) ** 2)).toFixed(1); r += ` (BMI: ${bmi})`; } r += `\n`; }
    r += `\n_Forward this message to your doctor on WhatsApp._`;
    return r;
  }

  // ── My Data ──
  if (intent === "MY_DATA") {
    const stats = await db.getLoggingStats(phone, 30);
    const daysSince = Math.max(1, Math.round((Date.now() - new Date(user.created_at).getTime()) / 86400000));
    let r = `📊 *Your DiaPlate Data (30 days)*\n\n`;
    r += `🍽️ Meals: ${stats.meals}\n🩸 Sugar readings: ${stats.sugars}\n👣 Step entries: ${stats.steps}\n⚖️ Weight entries: ${stats.weights}\n\n`;
    r += `📅 Member for ${daysSince} days\n`;
    r += `🔥 Meal streak: ${user.streak_meals || 0} days | Sugar streak: ${user.streak_sugar || 0} days\n\n`;
    r += `Type *summary* for weekly report\nType *hba1c* for estimated HbA1c\nType *correlation* for food-sugar insights\nType *share doctor* for doctor-ready report`;
    return r;
  }

  // ── Menu ──
  if (intent === "MENU") {
    const rem = user.reminders_enabled !== false ? "ON ✅" : "OFF";
    const pause = user.paused_until && new Date(user.paused_until) > new Date() ? ` (paused until ${new Date(user.paused_until).toLocaleDateString()})` : "";
    return `⚙️ *Settings & Controls*\n\n*Profile:*\n  Height: ${user.height_cm ? user.height_cm + " cm" : "Not set"}\n  Step target: ${user.step_target || 7000}/day\n  Weight day: ${(user.weight_day || "friday").charAt(0).toUpperCase() + (user.weight_day || "friday").slice(1)}\n  Reminders: ${rem}${pause}\n\n*Commands:*\n  *reminders on/off* — toggle nudges\n  *target 8000* — change step goal\n  *weight day monday* — change weigh-in day\n  *pause 3 days* — mute reminders\n  *resume* — unpause\n  *my data* — tracking stats\n  *hba1c* — estimated HbA1c\n  *correlation* — food-sugar insights\n  *share doctor* — doctor-ready report\n  *summary* — weekly health report\n\n*Pro tips:*\n  📸 Send meal photos for T-plate analysis\n  🔬 Send lab report photo for analysis\n  💬 Type \"post-meal 165\" for post-meal sugar\n  🏃 Type \"walked 30 mins\" to log exercise`;
  }

  // ── Reminders Toggle ──
  if (intent.type === "REMINDERS_TOGGLE") {
    const on = intent.value === "on";
    await db.updateUser(phone, { reminders_enabled: on, paused_until: null });
    return on ? "🔔 *Reminders ON.* I'll nudge you on missed meals, sugar, and steps." : "🔕 *Reminders OFF.* Type *reminders on* anytime to re-enable.";
  }

  // ── Step Target ──
  if (intent.type === "SET_STEP_TARGET") {
    if (intent.value < 1000 || intent.value > 30000) return "Step target should be 1,000–30,000. Try: *target 7000*";
    await db.updateUser(phone, { step_target: intent.value });
    return `🎯 *Step target: ${intent.value.toLocaleString()}/day.* I'll track against this.`;
  }

  // ── Weight Day ──
  if (intent.type === "SET_WEIGHT_DAY") {
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    if (!days.includes(intent.value)) return "Use a day name: *weight day friday*";
    await db.updateUser(phone, { weight_day: intent.value });
    return `📅 *Weigh-in day: ${intent.value.charAt(0).toUpperCase() + intent.value.slice(1)}.* I'll remind you.`;
  }

  // ── Pause / Resume ──
  if (intent.type === "PAUSE") {
    const d = Math.min(intent.value, 30);
    const until = new Date(Date.now() + d * 86400000);
    await db.updateUser(phone, { paused_until: until.toISOString() });
    return `⏸️ *Reminders paused ${d} days* (until ${until.toLocaleDateString()}). Type *resume* to unpause.`;
  }
  if (intent === "RESUME") {
    await db.updateUser(phone, { paused_until: null, reminders_enabled: true });
    return "▶️ *Reminders resumed!*";
  }

  // ── Welcome ──
  if (intent === "WELCOME") {
    return `👋 *Welcome to DiaPlate!*\n\nYour AI diabetes companion on WhatsApp.\n\n*What I can do:*\n📸 Send a *meal photo* → T-Plate analysis + calories\n🔬 Send a *lab report photo* → I'll explain your results\n🩸 Type a number like *110* → Log fasting sugar\n💉 Type *post-meal 165* → Log post-meal sugar\n👣 Type *5000 steps* → Track activity\n🏃 Type *walked 30 mins* → Log exercise\n⚖️ Type *73.5 kg* → Weight + BMI\n❓ Ask anything → "Can I eat mangoes?"\n📊 Type *summary* → Weekly report\n🔬 Type *hba1c* → Estimated HbA1c\n📈 Type *correlation* → Your food-sugar patterns\n⚙️ Type *menu* → Settings\n\n*Start:* type *height 170 cm*\n\n_DiaPlate is a lifestyle companion, not a medical device._`;
  }
  if (intent === "SETUP") return `⚙️ *Setup:*\n1. Type *height 170 cm*\n2. Start sharing meals, sugar, steps, weight!\n\n*Pro tip:* Log fasting sugar every morning — just type the number.`;

  // ── Question ──
  if (intent === "QUESTION") return await askDiabetesQuestion(message.text, user);

  return "I didn't understand that. Type *help* to see what I can do.";
}

module.exports = { handleIncomingMessage, detectIntent };
