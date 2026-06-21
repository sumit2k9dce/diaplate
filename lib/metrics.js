// lib/metrics.js — Health metrics computation and weekly summary
const { db } = require("./database");

async function computeMetrics(phone) {
  const [meals, sugarStats, steps, weights] = await Promise.all([
    db.getMealsInRange(phone, 7),
    db.getSugarStats(phone, 7),
    db.getStepsInRange(phone, 7),
    db.getWeightHistory(phone, 30),
  ]);

  // Meal metrics
  const totalMeals = meals.length;
  const avgCalories = totalMeals > 0
    ? Math.round(meals.reduce((s, m) => s + (m.calories || 0), 0) / Math.max(1, new Set(meals.map(m => m.logged_at.split("T")[0])).size))
    : 0;
  const avgTplate = totalMeals > 0
    ? (meals.reduce((s, m) => s + (m.tplate_score || 0), 0) / totalMeals).toFixed(1)
    : 0;
  const bestMeal = totalMeals > 0
    ? meals.reduce((best, m) => (m.tplate_score || 0) > (best.tplate_score || 0) ? m : best, meals[0])
    : null;

  // Sugar metrics
  const sugarAvg = sugarStats.average;
  const sugarTrend = sugarStats.trend;
  const sugarReadings = sugarStats.readings.length;
  const sugarInRange = sugarStats.readings.filter(r => r.value >= 80 && r.value <= 130).length;
  const sugarInRangePct = sugarReadings > 0 ? Math.round((sugarInRange / sugarReadings) * 100) : 0;

  // Steps metrics
  const stepsAvg = steps.length > 0
    ? Math.round(steps.reduce((s, e) => s + e.value, 0) / steps.length)
    : 0;
  const stepsDaysLogged = steps.length;
  const stepsTarget = 7000;
  const stepsTargetHitDays = steps.filter(s => s.value >= stepsTarget).length;

  // Weight metrics
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const earliestWeight = weights.length > 1 ? weights[0] : null;
  const weightChange = latestWeight && earliestWeight
    ? (latestWeight.value - earliestWeight.value).toFixed(1)
    : null;

  return {
    totalMeals,
    avgCalories,
    avgTplate,
    bestMeal,
    sugarAvg,
    sugarTrend,
    sugarReadings,
    sugarInRangePct,
    stepsAvg,
    stepsDaysLogged,
    stepsTargetHitDays,
    latestWeight,
    weightChange,
  };
}

function formatWeeklySummary(m, user) {
  const heightCm = user?.height_cm;
  let bmi = null;
  if (heightCm && m.latestWeight) {
    const heightM = heightCm / 100;
    bmi = (m.latestWeight.value / (heightM * heightM)).toFixed(1);
  }

  const trendEmoji = m.sugarTrend === "down" ? "↓ improving" : m.sugarTrend === "up" ? "↑ needs attention" : "→ stable";

  let report = `📊 *WEEKLY HEALTH SUMMARY*\n${"─".repeat(28)}\n\n`;

  // Sugar
  report += `🩸 *Blood Sugar*\n`;
  report += `  Average: ${m.sugarAvg || "—"} mg/dL (${trendEmoji})\n`;
  report += `  Readings logged: ${m.sugarReadings}/7 days\n`;
  report += `  In target range: ${m.sugarInRangePct}%\n\n`;

  // Meals
  report += `🍽️ *Meals*\n`;
  report += `  Meals logged: ${m.totalMeals} (target: 21/week)\n`;
  report += `  Avg daily calories: ${m.avgCalories || "—"} kcal\n`;
  report += `  Avg T-Plate score: ${m.avgTplate}/10\n`;
  if (m.bestMeal) {
    report += `  Best meal: ${m.bestMeal.description} (${m.bestMeal.tplate_score}/10)\n`;
  }
  report += `\n`;

  // Steps
  report += `👣 *Activity*\n`;
  report += `  Avg steps/day: ${m.stepsAvg.toLocaleString()}\n`;
  report += `  Days logged: ${m.stepsDaysLogged}/7\n`;
  report += `  Target (7K) hit: ${m.stepsTargetHitDays}/${m.stepsDaysLogged} days\n\n`;

  // Weight
  if (m.latestWeight) {
    report += `⚖️ *Weight*\n`;
    report += `  Current: ${m.latestWeight.value} kg`;
    if (bmi) report += ` (BMI: ${bmi})`;
    report += `\n`;
    if (m.weightChange) {
      const dir = m.weightChange > 0 ? `+${m.weightChange}` : m.weightChange;
      report += `  30-day change: ${dir} kg\n`;
    }
    report += `\n`;
  }

  // Recommendation
  report += `💡 *This week's focus:*\n`;
  const recs = [];
  if (m.avgTplate && m.avgTplate < 6) recs.push("Increase vegetables to fill half your plate at every meal.");
  if (m.sugarTrend === "up") recs.push("Sugar is trending up — try reducing rice/roti portions and adding a post-meal walk.");
  if (m.stepsAvg < 5000) recs.push("Aim for at least 5,000 steps daily. Start with a 10-minute walk after each meal.");
  if (m.sugarReadings < 5) recs.push("Log your fasting sugar more consistently — daily tracking reveals trends your doctor needs.");
  if (m.totalMeals < 14) recs.push("Try to log all 3 meals daily — the data helps me give you better insights.");
  if (recs.length === 0) recs.push("You're doing great! Keep up the consistency — that's the #1 predictor of long-term diabetes management.");

  report += recs.map(r => `  • ${r}`).join("\n");

  report += `\n\n_Share this summary with your doctor at your next visit._`;
  report += `\n_DiaPlate is a lifestyle companion, not medical advice._`;

  return report;
}

module.exports = { computeMetrics, formatWeeklySummary };
