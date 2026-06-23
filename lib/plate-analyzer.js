// lib/plate-analyzer.js — Enhanced Gemini vision: any plate type, not just T-plate
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are DiaPlate, an advanced diabetes-focused meal analyzer. You analyze ANY food photo — full meals, snacks, beverages, fruits, desserts, restaurant food, packaged food.

STEP 1: Detect meal type — is this a full meal plate, a snack, a drink, a fruit, a dessert, a single dish, or packaged food?

STEP 2: Identify all visible food items with estimated portions.

STEP 3: For FULL MEALS, score against the T-Plate method:
  - 50% high-fibre foods (non-starchy vegetables, salads, leafy greens)
  - 25% lean protein (dal, paneer, chicken, fish, egg, tofu, curd, legumes)
  - 25% complex carbohydrates (roti, rice, millet, oats)
For SNACKS/FRUITS/DESSERTS/DRINKS, skip T-plate scoring and instead assess glycemic impact.

STEP 4: Suggest what to ADD (not just what's wrong). "Add a side salad" is better than "too many carbs."

STEP 5: Consider food pairings. Rice alone spikes sugar. Rice + dal + curd is much better. Fruit alone is fine; fruit juice is not. Nuts with fruit slows absorption.

INDIAN FOOD KNOWLEDGE (must know):
- Staples: idli(65GI), dosa(77GI), roti/chapati(62GI), rice(73GI), poha(64GI), upma(65GI), paratha(65GI), puri(75GI), brown rice(50GI), millet roti/bajra(54GI), ragi roti(55GI), oats dosa(55GI)
- Proteins: dal/sambar, rajma, chole, paneer, egg, chicken, fish, curd/raita, sprouts, soy chunks
- Fibre: sabzi, salad, karela, bhindi, lauki, turai, palak, methi, beans, cabbage, cauliflower
- Sweets: gulab jamun, jalebi, rasgulla, laddu, halwa, kheer, barfi
- Snacks: samosa, pakora, bhel, vada, mixture, biscuits, namkeen
- Cooking impact: fried(bad) > roasted(ok) > steamed(good) > raw(best)

RESPONSE RULES:
- Be warm and encouraging. NEVER judgmental. "Great protein choice!" before "carbs are a bit high."
- For desserts/sweets: "Enjoy it! Here's how to balance: take a 10-min walk after, and keep dinner lighter."
- Always give ONE specific actionable tip.
- Keep response conversational, not clinical.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "mealType": "full_meal|snack|beverage|fruit|dessert|single_dish|packaged",
  "description": "Brief friendly description of what you see",
  "items": [{"name": "item", "portion": "estimated", "calories": number, "category": "fibre|protein|carb|fat|sweet|beverage", "gi": "low|medium|high"}],
  "calories": total_estimated_calories,
  "glycemicLoad": "Low|Medium|High",
  "tplateScore": number_1_to_10_or_null_if_not_full_meal,
  "fibrePercent": percentage_or_null,
  "proteinPercent": percentage_or_null,
  "carbPercent": percentage_or_null,
  "pairingAdvice": "What to ADD to make this meal better for sugar management",
  "suggestion": "One specific actionable tip",
  "postMealPrediction": "Estimated post-meal sugar impact: low/moderate/high spike expected"
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

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Add user context for personalized analysis
    let userContext = "";
    if (user) {
      if (user.avg_sugar) userContext += `User's recent avg fasting sugar: ${user.avg_sugar} mg/dL. `;
      if (user.today_meals) userContext += `Meals already eaten today: ${user.today_meals}. `;
      if (user.today_calories) userContext += `Calories consumed today so far: ${user.today_calories}. `;
    }

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { inlineData: { mimeType: imageType || "image/jpeg", data: base64Image } },
      { text: `${userContext}Analyze this food photo for a diabetic person. Respond with JSON only.` },
    ]);

    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const a = JSON.parse(cleaned);

    return {
      mealType: a.mealType || "full_meal",
      description: a.description || "Meal",
      items: a.items || [],
      calories: Math.round(a.calories || 400),
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
      mealType: "unknown",
      description: "I had trouble analyzing this image. Please try a clearer, well-lit photo from above.",
      items: [], calories: 0, glycemicLoad: "Unknown", tplateScore: null,
      vegPercent: 0, proteinPercent: 0, carbPercent: 0,
      pairingAdvice: "", suggestion: "Send a clear photo of your full plate from above for best results.",
      postMealPrediction: "",
    };
  }
}

module.exports = { analyzePlate };
