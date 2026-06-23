// lib/plate-analyzer.js — Enhanced: detects non-food images, any plate type
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are DiaPlate, an advanced diabetes-focused meal analyzer.

STEP 0 (CRITICAL): First determine if this image contains FOOD. If it shows a pet, person, landscape, document, screenshot, meme, selfie, or anything that is NOT food — respond with:
{"isFood": false, "description": "Brief description of what you see instead"}

STEP 1: If it IS food, detect meal type — full_meal, snack, beverage, fruit, dessert, single_dish, or packaged.

STEP 2: Identify all visible food items with estimated portions.

STEP 3: For FULL MEALS, score against T-Plate method:
  - 50% high-fibre (non-starchy vegetables, salads, leafy greens)
  - 25% lean protein (dal, paneer, chicken, fish, egg, tofu, curd, legumes)
  - 25% complex carbs (roti, rice, millet, oats)
For SNACKS/FRUITS/DESSERTS/DRINKS, skip T-plate. Assess glycemic impact instead.

STEP 4: Suggest what to ADD, not just what's wrong.

STEP 5: Consider food pairings. Rice alone spikes sugar. Rice + dal + curd is better.

INDIAN FOOD KNOWLEDGE:
Staples GI: idli(65), dosa(77), roti(62), rice(73), poha(64), upma(65), paratha(65), puri(75), brown rice(50), millet roti(54), ragi(55), oats dosa(55)
Cooking impact: fried(bad) > roasted(ok) > steamed(good) > raw(best)

RULES:
- Be warm, encouraging. NEVER judgmental.
- For desserts: "Enjoy it! Here's how to balance..."
- Always give ONE specific actionable tip.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "isFood": true,
  "mealType": "full_meal|snack|beverage|fruit|dessert|single_dish|packaged",
  "description": "Brief friendly description",
  "items": [{"name": "item", "portion": "estimated", "calories": number, "category": "fibre|protein|carb|fat|sweet|beverage", "gi": "low|medium|high"}],
  "calories": total_estimated_calories,
  "glycemicLoad": "Low|Medium|High",
  "tplateScore": number_1_to_10_or_null,
  "fibrePercent": percentage_or_null,
  "proteinPercent": percentage_or_null,
  "carbPercent": percentage_or_null,
  "pairingAdvice": "What to ADD to improve this meal",
  "suggestion": "One specific actionable tip",
  "postMealPrediction": "Estimated sugar impact: low/moderate/high spike"
}`;

async function analyzePlate(imageUrl, imageType, user) {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        Authorization: "Basic " + Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
      },
    });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);

    const imageBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.5-flash" });

    let userContext = "";
    if (user) {
      if (user.today_meals) userContext += `Meals eaten today: ${user.today_meals}. `;
      if (user.today_calories) userContext += `Calories so far today: ${user.today_calories}. `;
    }

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { inlineData: { mimeType: imageType || "image/jpeg", data: base64Image } },
      { text: `${userContext}Analyze this image. If it's not food, say so. If it is food, analyze for a diabetic person. JSON only.` },
    ]);

    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const a = JSON.parse(cleaned);

    // Non-food detection
    if (a.isFood === false) {
      return { isFood: false, description: a.description || "This doesn't look like food." };
    }

    return {
      isFood: true,
      mealType: a.mealType || "full_meal",
      description: a.description || "Meal",
      items: a.items || [],
      calories: Math.round(a.calories || 0),
      glycemicLoad: a.glycemicLoad || "Medium",
      tplateScore: a.tplateScore,
      vegPercent: Math.round(a.fibrePercent || 0),
      proteinPercent: Math.round(a.proteinPercent || 0),
      carbPercent: Math.round(a.carbPercent || 0),
      pairingAdvice: a.pairingAdvice || "",
      suggestion: a.suggestion || "Try adding more vegetables to your next meal.",
      postMealPrediction: a.postMealPrediction || "",
    };
  } catch (err) {
    console.error("Plate analysis error:", err);
    return {
      isFood: false,
      description: "I had trouble analyzing this image. Please send a clear, well-lit food photo from above.",
    };
  }
}

module.exports = { analyzePlate };
