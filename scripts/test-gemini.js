// scripts/test-gemini.js — Test Gemini API connection
// Usage: GEMINI_API_KEY=xxx node scripts/test-gemini.js

const { GoogleGenerativeAI } = require("@google/generative-ai");

async function test() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  console.log("Testing Gemini Flash...\n");

  // Test 1: Text question
  const result1 = await model.generateContent(
    "In 2 sentences, what is the T-plate method for diabetics?"
  );
  console.log("✅ Text test:", result1.response.text().substring(0, 200));

  // Test 2: JSON response
  const result2 = await model.generateContent(
    'Analyze this meal for a diabetic: "2 rotis, dal, mixed veg sabzi, and curd". Respond ONLY with JSON: {"calories": number, "tplateScore": number_1_to_10, "glycemicLoad": "Low|Medium|High", "suggestion": "one tip"}'
  );
  const text = result2.response.text().replace(/```json|```/g, "").trim();
  const json = JSON.parse(text);
  console.log("\n✅ JSON test:", JSON.stringify(json, null, 2));

  console.log("\n🎉 Gemini is working! Ready to analyze plates.");
}

test().catch(err => {
  console.error("❌ Gemini test failed:", err.message);
  console.log("\nMake sure GEMINI_API_KEY is set. Get one free at: https://aistudio.google.com/apikey");
});
