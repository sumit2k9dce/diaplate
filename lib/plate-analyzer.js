// lib/plate-analyzer.js — Gemini Flash vision for T-Plate meal analysis
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are DiaPlate, a diabetes-focused meal plate analyzer. You analyze food photos using the T-Plate (Diabetes Plate) method.

The T-Plate method divides a 9-inch plate:
- 50% high-fibre foods (salad, leafy greens, cucumber, tomato, bhindi/okra, lauki/bottle gourd, karela/bitter gourd, beans, cabbage, broccoli, capsicum, spinach, methi, mushroom, sprouts, cauliflower — any non-starchy vegetable rich in dietary fibre)
- 25% lean protein (dal, paneer, chicken, fish, egg, tofu, sprouts, curd/yogurt, soy chunks, rajma, chana, moong, cottage cheese, nuts in moderation)
- 25% complex carbohydrates (roti/chapati, rice, quinoa, oats, sweet potato, millet/bajra/jowar/ragi, brown rice, whole wheat bread, poha, upma, idli)

IMPORTANT RULES:
- You MUST know Indian foods: idli, dosa, poha, upma, paratha, dal, sabzi, roti, chapati, biryani, sambar, rasam, thepla, dhokla, vada, uttapam, khichdi, puri, chole, rajma, kadhi, pulao, raita, chutney, pickle
- Fibre category = non-starchy vegetables, salads, leafy greens, raw vegetables. NOT fruits (fruits have sugar).
- Estimate calories based on visible portion sizes
- Glycemic load: Low (< 10), Medium (10-20), High (> 20)
- Be encouraging, never judgmental
- If you see a sweet/dessert, acknowledge it kindly and suggest portion control

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "description": "Brief description of foods seen on the plate",
  "items": [{"name": "food item", "portion": "estimated portion", "calories": number, "category": "fibre|protein|carb|fat|sweet"}],
  "calories": total_estimated_calories,
  "glycemicLoad": "Low|Medium|High",
  "tplateScore": number_1_to_10,
  "vegPercent": percentage_of_plate_fibre_foods,
  "proteinPercent": percentage_of_plate_protein,
  "carbPercent": percentage_of_plate_carbs,
  "suggestion": "One specific, actionable tip to improve this meal for blood sugar management. If fibre is below 50%, suggest adding salad or vegetables."
}`;

async function analyzePlate(imageUrl, imageType, user) {
  try {
    // Fetch image from Twilio (requires auth)
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
    const mimeType = imageType || "image/jpeg";

    // Call Gemini Flash with vision
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
      { text: "Analyze this meal plate for a diabetic person. Respond with JSON only." },
    ]);

    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(cleaned);

    // Validate and sanitize
    return {
      description: analysis.description || "Meal plate",
      items: analysis.items || [],
      calories: Math.round(analysis.calories || 400),
      glycemicLoad: analysis.glycemicLoad || "Medium",
      tplateScore: Math.min(10, Math.max(1, Math.round(analysis.tplateScore || 5))),
      vegPercent: Math.round(analysis.vegPercent || 30),
      proteinPercent: Math.round(analysis.proteinPercent || 25),
      carbPercent: Math.round(analysis.carbPercent || 45),
      suggestion: analysis.suggestion || "Try adding more vegetables to fill half your plate.",
    };
  } catch (err) {
    console.error("Plate analysis error:", err);
    // Return a graceful fallback
    return {
      description: "I had trouble analyzing this image. Please try again with a clearer photo of your plate.",
      items: [],
      calories: 0,
      glycemicLoad: "Unknown",
      tplateScore: 0,
      vegPercent: 0,
      proteinPercent: 0,
      carbPercent: 0,
      suggestion: "Please send a clear, well-lit photo of your full plate from above for the best analysis.",
    };
  }
}

module.exports = { analyzePlate };
