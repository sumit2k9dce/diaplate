// lib/health-advisor.js — Context-aware Gemini diabetes Q&A + lab report analysis
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { db } = require("./database");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are DiaPlate, a friendly diabetes lifestyle companion on WhatsApp.

RULES:
1. NEVER give medication advice. Say: "Please consult your doctor for medication decisions."
2. NEVER diagnose conditions.
3. Be culturally aware — most users are Indian. Know Indian foods, festivals, cooking methods.
4. Be warm, conversational. This is WhatsApp, not a medical report.
5. Keep responses under 200 words. Use simple language.
6. Use emojis sparingly but naturally.
7. Frame food as "better choices" not "forbidden." Nothing is off-limits — portion and pairing matter.
8. If sugar >300 or <60, urge IMMEDIATE doctor contact.
9. End food/diet answers with one specific actionable tip.
10. Support multi-language: if user writes in Hindi/Hinglish, respond in the same style.

INDIAN FOOD GI DATABASE:
White rice: 73, Brown rice: 50, Roti: 62, Idli: 65, Dosa: 77, Poha: 64, Upma: 65, Oats: 55, Millet roti: 54, Ragi roti: 55
Good combos: protein + fibre slow spikes. Curd with rice > plain rice. Dal + roti > rice alone.
Walking 15 min after meals reduces post-meal sugar by 15-30%.

For LAB REPORT queries: explain each value simply, compare to diabetic targets, flag concerning values, always say "discuss with your doctor."

Always end with: _DiaPlate is a lifestyle companion, not medical advice. Consult your doctor for treatment decisions._`;

async function askDiabetesQuestion(question, user) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Build rich user context from their data
    let context = "USER CONTEXT (use this to personalize your answer):\n";
    if (user?.height_cm) context += `Height: ${user.height_cm} cm. `;

    // Get recent sugar stats for context
    try {
      const sugarStats = await db.getSugarStats(user.phone, 7);
      if (sugarStats.average > 0) {
        context += `Recent avg fasting sugar: ${sugarStats.average} mg/dL (${sugarStats.trend}). `;
      }
      const hba1c = await db.getHbA1cEstimate(user.phone);
      if (hba1c) context += `Estimated HbA1c: ${hba1c}%. `;

      // Get today's meals for context
      const todayCalories = await db.getTodayCalories(user.phone);
      if (todayCalories > 0) context += `Calories eaten today: ${todayCalories}. `;

      const stepsAvg = await db.getStepsAvg(user.phone, 7);
      if (stepsAvg > 0) context += `Avg daily steps: ${stepsAvg}. `;

      // Food-sugar correlation
      const correlation = await db.getFoodSugarCorrelation(user.phone);
      if (correlation) {
        context += `Known food impacts: ${Object.entries(correlation).map(([f, v]) => `${f}→${v}mg/dL`).join(", ")}. `;
      }
    } catch (e) {
      // Context enrichment is best-effort
    }

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `${context}\n\nUser question: ${question}` },
    ]);

    let answer = result.response.text();
    if (!answer.includes("not medical advice") && !answer.includes("consult your doctor")) {
      answer += "\n\n_DiaPlate is a lifestyle companion, not medical advice. Consult your doctor for treatment decisions._";
    }
    return answer;
  } catch (err) {
    console.error("Health advisor error:", err);
    return "I'm having trouble answering right now. Please try again in a moment. For urgent medical questions, always contact your doctor directly.";
  }
}

module.exports = { askDiabetesQuestion };
