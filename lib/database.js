// lib/database.js — Enhanced Supabase data layer with correlations, streaks, exercise
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const db = {
  // ===== Users =====
  async getUser(phone) {
    const { data } = await supabase.from("users").select("*").eq("phone", phone).single();
    return data;
  },
  async createUser(phone) {
    const { data } = await supabase.from("users")
      .insert({ phone, reminders_enabled: true, streak_meals: 0, streak_sugar: 0, last_active: new Date().toISOString(), created_at: new Date().toISOString() })
      .select().single();
    return data;
  },
  async updateUser(phone, updates) {
    updates.last_active = new Date().toISOString();
    const { data } = await supabase.from("users").update(updates).eq("phone", phone).select().single();
    return data;
  },

  // ===== Meals =====
  async logMeal(phone, analysis) {
    await supabase.from("meals").insert({
      phone, meal_type: analysis.mealType, description: analysis.description, items: analysis.items,
      calories: analysis.calories, glycemic_load: analysis.glycemicLoad, tplate_score: analysis.tplateScore,
      veg_percent: analysis.vegPercent, protein_percent: analysis.proteinPercent, carb_percent: analysis.carbPercent,
      suggestion: analysis.suggestion, pairing_advice: analysis.pairingAdvice, logged_at: new Date().toISOString(),
    });
    // Update streak
    await this.updateMealStreak(phone);
  },
  async getTodayMealCount(phone) {
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase.from("meals").select("*", { count: "exact", head: true })
      .eq("phone", phone).gte("logged_at", today + "T00:00:00").lte("logged_at", today + "T23:59:59");
    return count || 0;
  },
  async getTodayCalories(phone) {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase.from("meals").select("calories")
      .eq("phone", phone).gte("logged_at", today + "T00:00:00").lte("logged_at", today + "T23:59:59");
    return (data || []).reduce((s, m) => s + (m.calories || 0), 0);
  },
  async getMealsInRange(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("meals").select("*").eq("phone", phone)
      .gte("logged_at", since).order("logged_at", { ascending: false });
    return data || [];
  },
  async updateMealStreak(phone) {
    // Count consecutive days with at least 1 meal logged
    const { data } = await supabase.from("meals").select("logged_at").eq("phone", phone)
      .order("logged_at", { ascending: false }).limit(90);
    if (!data || data.length === 0) return;
    const days = new Set(data.map(m => m.logged_at.split("T")[0]));
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 90; i++) {
      const ds = d.toISOString().split("T")[0];
      if (days.has(ds)) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    await supabase.from("users").update({ streak_meals: streak }).eq("phone", phone);
    return streak;
  },

  // ===== Sugar (enhanced: supports types) =====
  async logSugar(phone, value, readingType = "fasting") {
    await supabase.from("sugar_readings").insert({
      phone, value, reading_type: readingType, logged_at: new Date().toISOString(),
    });
    await this.updateSugarStreak(phone);
  },
  async getSugarStats(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("sugar_readings").select("value, reading_type, logged_at")
      .eq("phone", phone).gte("logged_at", since).order("logged_at", { ascending: true });
    const readings = data || [];
    if (readings.length === 0) return { average: 0, trend: "stable", readings: [], inRangePct: 0 };
    const avg = Math.round(readings.reduce((s, r) => s + r.value, 0) / readings.length);
    let trend = "stable";
    if (readings.length >= 4) {
      const mid = Math.floor(readings.length / 2);
      const first = readings.slice(0, mid).reduce((s, r) => s + r.value, 0) / mid;
      const second = readings.slice(mid).reduce((s, r) => s + r.value, 0) / (readings.length - mid);
      if (second < first - 5) trend = "down";
      else if (second > first + 5) trend = "up";
    }
    const inRange = readings.filter(r => r.value >= 80 && r.value <= 130).length;
    const inRangePct = Math.round((inRange / readings.length) * 100);
    return { average: avg, trend, readings, inRangePct };
  },
  async getHbA1cEstimate(phone) {
    const stats = await this.getSugarStats(phone, 90);
    if (stats.readings.length < 14) return null; // Need at least 2 weeks of data
    // Standard formula: HbA1c = (average_sugar + 46.7) / 28.7
    return ((stats.average + 46.7) / 28.7).toFixed(1);
  },
  async updateSugarStreak(phone) {
    const { data } = await supabase.from("sugar_readings").select("logged_at").eq("phone", phone)
      .order("logged_at", { ascending: false }).limit(90);
    if (!data) return;
    const days = new Set(data.map(r => r.logged_at.split("T")[0]));
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 90; i++) {
      if (days.has(d.toISOString().split("T")[0])) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    await supabase.from("users").update({ streak_sugar: streak }).eq("phone", phone);
    return streak;
  },

  // ===== Food-to-Sugar Correlation =====
  async getFoodSugarCorrelation(phone) {
    // Get meals and the sugar reading that followed (within 1-3 hours)
    const meals = await this.getMealsInRange(phone, 30);
    const { data: sugars } = await supabase.from("sugar_readings").select("value, reading_type, logged_at")
      .eq("phone", phone).gte("logged_at", new Date(Date.now() - 30 * 86400000).toISOString());
    if (!meals.length || !sugars || !sugars.length) return null;

    // Group meals by high-carb items
    const carbImpact = {};
    for (const meal of meals) {
      if (!meal.items) continue;
      const mealTime = new Date(meal.logged_at).getTime();
      // Find sugar reading 1-3 hours after this meal
      const postSugar = sugars.find(s => {
        const sTime = new Date(s.logged_at).getTime();
        const diff = (sTime - mealTime) / 3600000;
        return diff >= 1 && diff <= 3;
      });
      if (!postSugar) continue;
      for (const item of meal.items) {
        if (item.category === "carb") {
          if (!carbImpact[item.name]) carbImpact[item.name] = [];
          carbImpact[item.name].push(postSugar.value);
        }
      }
    }
    // Average post-meal sugar per carb type
    const result = {};
    for (const [food, values] of Object.entries(carbImpact)) {
      if (values.length >= 2) {
        result[food] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  },

  // ===== Steps =====
  async logSteps(phone, value) {
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase.from("steps").select("id")
      .eq("phone", phone).gte("logged_at", today + "T00:00:00").lte("logged_at", today + "T23:59:59").single();
    if (existing) await supabase.from("steps").update({ value }).eq("id", existing.id);
    else await supabase.from("steps").insert({ phone, value, logged_at: new Date().toISOString() });
  },
  async getStepsAvg(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("steps").select("value").eq("phone", phone).gte("logged_at", since);
    const entries = data || [];
    if (entries.length === 0) return 0;
    return Math.round(entries.reduce((s, e) => s + e.value, 0) / entries.length);
  },
  async getStepsInRange(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("steps").select("value, logged_at").eq("phone", phone)
      .gte("logged_at", since).order("logged_at", { ascending: true });
    return data || [];
  },
  // Activity-sugar correlation
  async getActivitySugarCorrelation(phone) {
    const steps = await this.getStepsInRange(phone, 30);
    const { data: sugars } = await supabase.from("sugar_readings").select("value, logged_at")
      .eq("phone", phone).eq("reading_type", "fasting")
      .gte("logged_at", new Date(Date.now() - 30 * 86400000).toISOString());
    if (steps.length < 7 || !sugars || sugars.length < 7) return null;
    // Compare avg sugar on high-step days vs low-step days
    const avgSteps = steps.reduce((s, e) => s + e.value, 0) / steps.length;
    const highDays = new Set(steps.filter(s => s.value >= avgSteps).map(s => s.logged_at.split("T")[0]));
    const lowDays = new Set(steps.filter(s => s.value < avgSteps).map(s => s.logged_at.split("T")[0]));
    // Next-morning fasting sugar for each group
    const highSugars = sugars.filter(s => {
      const prev = new Date(s.logged_at); prev.setDate(prev.getDate() - 1);
      return highDays.has(prev.toISOString().split("T")[0]);
    });
    const lowSugars = sugars.filter(s => {
      const prev = new Date(s.logged_at); prev.setDate(prev.getDate() - 1);
      return lowDays.has(prev.toISOString().split("T")[0]);
    });
    if (highSugars.length < 3 || lowSugars.length < 3) return null;
    return {
      highStepDaySugar: Math.round(highSugars.reduce((s, r) => s + r.value, 0) / highSugars.length),
      lowStepDaySugar: Math.round(lowSugars.reduce((s, r) => s + r.value, 0) / lowSugars.length),
      avgSteps: Math.round(avgSteps),
    };
  },

  // ===== Exercise =====
  async logExercise(phone, type, durationMins) {
    await supabase.from("exercise").insert({
      phone, exercise_type: type, duration_mins: durationMins, logged_at: new Date().toISOString(),
    });
  },
  async getExerciseInRange(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("exercise").select("*").eq("phone", phone).gte("logged_at", since);
    return data || [];
  },

  // ===== Weight =====
  async logWeight(phone, value) {
    await supabase.from("weight").insert({ phone, value, logged_at: new Date().toISOString() });
  },
  async getPreviousWeight(phone) {
    const { data } = await supabase.from("weight").select("value, logged_at").eq("phone", phone)
      .order("logged_at", { ascending: false }).limit(2);
    if (data && data.length >= 2) {
      const daysAgo = Math.round((Date.now() - new Date(data[1].logged_at).getTime()) / 86400000);
      return { value: data[1].value, daysAgo };
    }
    return null;
  },
  async getWeightHistory(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from("weight").select("value, logged_at").eq("phone", phone)
      .gte("logged_at", since).order("logged_at", { ascending: true });
    return data || [];
  },

  // ===== Streaks & Engagement =====
  async getDaysSinceLastLog(phone, table) {
    const { data } = await supabase.from(table).select("logged_at").eq("phone", phone)
      .order("logged_at", { ascending: false }).limit(1).single();
    if (!data) return 999;
    return Math.round((Date.now() - new Date(data.logged_at).getTime()) / 86400000);
  },
  async getLoggingStats(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const [meals, sugars, steps, weights] = await Promise.all([
      supabase.from("meals").select("logged_at", { count: "exact" }).eq("phone", phone).gte("logged_at", since),
      supabase.from("sugar_readings").select("logged_at", { count: "exact" }).eq("phone", phone).gte("logged_at", since),
      supabase.from("steps").select("logged_at", { count: "exact" }).eq("phone", phone).gte("logged_at", since),
      supabase.from("weight").select("logged_at", { count: "exact" }).eq("phone", phone).gte("logged_at", since),
    ]);
    return { meals: meals.count || 0, sugars: sugars.count || 0, steps: steps.count || 0, weights: weights.count || 0 };
  },
};

module.exports = { db, supabase };
