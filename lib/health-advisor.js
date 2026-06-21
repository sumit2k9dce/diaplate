// lib/health-advisor.js — Gemini-powered diabetes Q&A
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are DiaPlate, a friendly and knowledgeable diabetes lifestyle companion on WhatsApp. You help Type 2 diabetics and pre-diabetics manage their condition through diet, exercise, and lifestyle.

RULES:
1. NEVER give medication advice. If asked about medication, say: "Please consult your doctor for medication decisions. I can help with diet, exercise, and lifestyle."
2. NEVER diagnose. You track and inform, not diagnose.
3. Be culturally aware — most users are Indian. Know Indian foods, festivals, cooking methods.
4. Be warm, encouraging, and conversational. This is WhatsApp, not a medical report.
5. Keep responses under 200 words. Use simple language.
6. Use emojis sparingly but naturally.
7. When discussing food, always frame it as "better choices" not "forbidden foods". Nothing is completely off-limits — portion and pairing matter.
8. If a user reports dangerously high sugar (>300) or low sugar (<60), urge them to contact their doctor IMMEDIATELY.
9. End every food/diet answer with one specific, actionable tip.
10. Know the glycemic index of common Indian foods.

KEY KNOWLEDGE:
- Indian foods GI: White rice (73), Brown rice (50), Roti/chapati (62), Idli (65), Dosa (77), Poha (64), Upma (65), Oats (55), Millet roti (54)
- Good combinations: Protein + fiber slow sugar spikes. Curd with rice is better than plain rice. Dal + roti > rice alone.
- Walking 15 min after meals reduces post-meal sugar by 15-30%.
- Indian festivals: Diwali sweets, Holi gujiya, Eid biryani — help users enjoy in moderation, not abstain entirely.
- HbA1c target: < 7% for most, < 6.5% for younger patients
- Safe lipid levels: LDL < 100, HDL > 40/50, Triglycerides < 150

Always end with: _DiaPlate is a lifestyle companion, not medical advice. Consult your doctor for treatment decisions._`;

async function askDiabetesQuestion(question, user) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Add user context if available
    let userContext = "";
    if (user && user.height_cm) {
      userContext += `User height: ${user.height_cm} cm. `;
    }

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `${userContext}\n\nUser question: ${question}` },
    ]);

    let answer = result.response.text();

    // Ensure disclaimer is present
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
