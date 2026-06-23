// lib/metrics.js — Enhanced: HbA1c estimate, correlations, streaks, best/worst meals
const { db } = require("./database");

async function computeMetrics(phone) {
  const [meals, sugarStats, steps, weights, lastWeekSugar, exercise, hba1c, foodCorrelation, activityCorrelation] = await Promise.all([
    db.getMealsInRange(phone, 7),
    db.getSugarStats(phone, 7),
    db.getStepsInRange(phone, 7),
    db.getWeightHistory(phone, 30),
    db.getSugarStats(phone, 14), // for comparison
    db.getExerciseInRange(phone, 7),
    db.getHbA1cEstimate(phone),
    db.getFoodSugarCorrelation(phone),
    db.getActivitySugarCorrelation(phone),
  ]);

  const totalMeals = meals.length;
  const daysWithMeals = new Set(meals.map(m => m.logged_at.split("T")[0])).size;
  const avgCalories = daysWithMeals > 0
    ? Math.round(meals.reduce((s, m) => s + (m.calories || 0), 0) / daysWithMeals) : 0;
  const scoredMeals = meals.filter(m => m.tplate_score != null);
  const avgTplate = scoredMeals.length > 0
    ? (scoredMeals.reduce((s, m) => s + m.tplate_score, 0) / scoredMeals.length).toFixed(1) : null;
  const bestMeal = scoredMeals.length > 0
    ? scoredMeals.reduce((b, m) => (m.tplate_score > (b.tplate_score || 0)) ? m : b, scoredMeals[0]) : null;
  const worstMeal = scoredMeals.length > 1
    ? scoredMeals.reduce((w, m) => (m.tplate_score < (w.tplate_score || 10)) ? m : w, scoredMeals[0]) : null;

  // Last week comparison for sugar
  const prevWeekReadings = lastWeekSugar.readings.filter(r => {
    const d = new Date(r.logged_at);
    const daysAgo = (Date.now() - d.getTime()) / 86400000;
    return daysAgo >= 7 && daysAgo < 14;
  });
  const prevWeekAvg = prevWeekReadings.length > 0
    ? Math.round(prevWeekReadings.reduce((s, r) => s + r.value, 0) / prevWeekReadings.length) : null;

  const stepsAvg = steps.length > 0 ? Math.round(steps.reduce((s, e) => s + e.value, 0) / steps.length) : 0;
  const stepsTargetHit = steps.filter(s => s.value >= 7000).length;
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const earliestWeight = weights.length > 1 ? weights[0] : null;
  const weightChange = latestWeight && earliestWeight ? (latestWeight.value - earliestWeight.value).toFixed(1) : null;

  // Streaks
  const user = await db.getUser(phone);
  const mealStreak = user?.streak_meals || 0;
  const sugarStreak = user?.streak_sugar || 0;

  return {
    totalMeals, daysWithMeals, avgCalories, avgTplate, bestMeal, worstMeal,
    sugarAvg: sugarStats.average, sugarTrend: sugarStats.trend, sugarReadings: sugarStats.readings.length,
    sugarInRangePct: sugarStats.inRangePct, prevWeekAvg,
    stepsAvg, stepsDaysLogged: steps.length, stepsTargetHit,
    latestWeight, weightChange, hba1c,
    foodCorrelation, activityCorrelation, exercise,
    mealStreak, sugarStreak,
  };
}

function formatWeeklySummary(m, user) {
  const heightCm = user?.height_cm;
  let bmi = null;
  if (heightCm && m.latestWeight) bmi = (m.latestWeight.value / ((heightCm / 100) ** 2)).toFixed(1);

  const trendEmoji = m.sugarTrend === "down" ? "↓ improving" : m.sugarTrend === "up" ? "↑ needs attention" : "→ stable";
  let r = `📊 *WEEKLY HEALTH SUMMARY*\n${"─".repeat(28)}\n\n`;

  // Sugar
  r += `🩸 *Blood Sugar*\n`;
  r += `  Average: ${m.sugarAvg || "—"} mg/dL (${trendEmoji})\n`;
  if (m.prevWeekAvg) {
    const diff = m.sugarAvg - m.prevWeekAvg;
    r += `  vs last week: ${diff > 0 ? "+" : ""}${diff} mg/dL\n`;
  }
  r += `  In target range: ${m.sugarInRangePct}%\n`;
  r += `  Readings logged: ${m.sugarReadings}/7 days\n`;
  if (m.hba1c) r += `  Est. HbA1c: ~${m.hba1c}% _(based on 90-day avg)_\n`;
  r += `\n`;

  // Meals
  r += `🍽️ *Meals*\n`;
  r += `  Logged: ${m.totalMeals} meals in ${m.daysWithMeals} days\n`;
  r += `  Avg daily calories: ${m.avgCalories || "—"} kcal\n`;
  if (m.avgTplate) r += `  Avg T-Plate score: ${m.avgTplate}/10\n`;
  if (m.bestMeal) r += `  ⭐ Best: ${m.bestMeal.description.substring(0, 40)} (${m.bestMeal.tplate_score}/10)\n`;
  if (m.worstMeal && m.worstMeal !== m.bestMeal) r += `  ⚠️ Improve: ${m.worstMeal.description.substring(0, 40)} (${m.worstMeal.tplate_score}/10)\n`;
  r += `\n`;

  // Activity
  r += `👣 *Activity*\n`;
  r += `  Avg steps: ${m.stepsAvg.toLocaleString()}/day\n`;
  r += `  Target (7K) hit: ${m.stepsTargetHit}/${m.stepsDaysLogged} days\n`;
  if (m.exercise.length > 0) {
    const totalMins = m.exercise.reduce((s, e) => s + (e.duration_mins || 0), 0);
    r += `  Exercise: ${m.exercise.length} sessions, ${totalMins} mins total\n`;
  }
  r += `\n`;

  // Weight
  if (m.latestWeight) {
    r += `⚖️ *Weight*\n`;
    r += `  Current: ${m.latestWeight.value} kg`;
    if (bmi) r += ` (BMI: ${bmi})`;
    r += `\n`;
    if (m.weightChange) r += `  30-day change: ${m.weightChange > 0 ? "+" : ""}${m.weightChange} kg\n`;
    r += `\n`;
  }

  // Streaks
  if (m.mealStreak >= 3 || m.sugarStreak >= 3) {
    r += `🔥 *Streaks*\n`;
    if (m.mealStreak >= 3) r += `  Meal logging: ${m.mealStreak} days straight!\n`;
    if (m.sugarStreak >= 3) r += `  Sugar tracking: ${m.sugarStreak} days straight!\n`;
    r += `\n`;
  }

  // Correlations (if enough data)
  if (m.activityCorrelation) {
    const c = m.activityCorrelation;
    const diff = c.lowStepDaySugar - c.highStepDaySugar;
    if (diff > 5) {
      r += `📈 *Insight: Activity-Sugar Link*\n`;
      r += `  Active days → fasting sugar: ${c.highStepDaySugar} mg/dL\n`;
      r += `  Low-activity days → fasting sugar: ${c.lowStepDaySugar} mg/dL\n`;
      r += `  Walking more saves you ~${diff} mg/dL!\n\n`;
    }
  }
  if (m.foodCorrelation && Object.keys(m.foodCorrelation).length > 0) {
    r += `🍚 *Insight: Food-Sugar Impact*\n`;
    const sorted = Object.entries(m.foodCorrelation).sort((a, b) => b[1] - a[1]);
    for (const [food, avg] of sorted.slice(0, 3)) {
      r += `  ${food}: avg post-meal sugar ${avg} mg/dL\n`;
    }
    r += `\n`;
  }

  // Recommendation
  r += `💡 *This week's focus:*\n`;
  const recs = [];
  if (m.avgTplate && m.avgTplate < 6) recs.push("Increase fibre — add salad, sabzi, or raw veggies to fill half your plate.");
  if (m.sugarTrend === "up") recs.push("Sugar trending up — try reducing rice/roti portions and adding a post-meal walk.");
  if (m.stepsAvg < 5000) recs.push("Aim for 5,000+ steps daily. Start with a 10-min walk after each meal.");
  if (m.sugarReadings < 5) recs.push("Log fasting sugar more consistently — daily tracking reveals trends.");
  if (m.totalMeals < 14) recs.push("Log all 3 meals daily — better data = better insights.");
  if (recs.length === 0) recs.push("Great consistency! Keep it up — that's the #1 predictor of long-term diabetes management. 💪");
  r += recs.map(x => `  • ${x}`).join("\n");

  r += `\n\n_Share this with your doctor at your next visit._`;
  r += `\n_DiaPlate is a lifestyle companion, not medical advice._`;
  return r;
}

module.exports = { computeMetrics, formatWeeklySummary };
