// lib/database.js — Supabase data layer for all DiaPlate operations
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const db = {
  // ===== Users =====
  async getUser(phone) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
      .single();
    return data;
  },

  async createUser(phone) {
    const { data } = await supabase
      .from("users")
      .insert({
        phone,
        reminders_enabled: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    return data;
  },

  async updateUser(phone, updates) {
    const { data } = await supabase
      .from("users")
      .update(updates)
      .eq("phone", phone)
      .select()
      .single();
    return data;
  },

  // ===== Meals =====
  async logMeal(phone, analysis) {
    const { data } = await supabase.from("meals").insert({
      phone,
      description: analysis.description,
      items: analysis.items,
      calories: analysis.calories,
      glycemic_load: analysis.glycemicLoad,
      tplate_score: analysis.tplateScore,
      veg_percent: analysis.vegPercent,
      protein_percent: analysis.proteinPercent,
      carb_percent: analysis.carbPercent,
      suggestion: analysis.suggestion,
      logged_at: new Date().toISOString(),
    });
    return data;
  },

  async getTodayMealCount(phone) {
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase
      .from("meals")
      .select("*", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("logged_at", today + "T00:00:00")
      .lte("logged_at", today + "T23:59:59");
    return count || 0;
  },

  async getTodayCalories(phone) {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("meals")
      .select("calories")
      .eq("phone", phone)
      .gte("logged_at", today + "T00:00:00")
      .lte("logged_at", today + "T23:59:59");
    return (data || []).reduce((sum, m) => sum + (m.calories || 0), 0);
  },

  async getMealsInRange(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from("meals")
      .select("*")
      .eq("phone", phone)
      .gte("logged_at", since)
      .order("logged_at", { ascending: false });
    return data || [];
  },

  // ===== Sugar =====
  async logSugar(phone, value) {
    await supabase.from("sugar_readings").insert({
      phone,
      value,
      logged_at: new Date().toISOString(),
    });
  },

  async getSugarStats(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from("sugar_readings")
      .select("value, logged_at")
      .eq("phone", phone)
      .gte("logged_at", since)
      .order("logged_at", { ascending: true });

    const readings = data || [];
    if (readings.length === 0) return { average: 0, trend: "stable", readings: [] };

    const avg = Math.round(readings.reduce((s, r) => s + r.value, 0) / readings.length);

    // Trend: compare first half avg to second half avg
    let trend = "stable";
    if (readings.length >= 4) {
      const mid = Math.floor(readings.length / 2);
      const firstHalf = readings.slice(0, mid).reduce((s, r) => s + r.value, 0) / mid;
      const secondHalf = readings.slice(mid).reduce((s, r) => s + r.value, 0) / (readings.length - mid);
      if (secondHalf < firstHalf - 5) trend = "down";
      else if (secondHalf > firstHalf + 5) trend = "up";
    }

    return { average: avg, trend, readings };
  },

  // ===== Steps =====
  async logSteps(phone, value) {
    const today = new Date().toISOString().split("T")[0];
    // Upsert: one entry per day
    const { data: existing } = await supabase
      .from("steps")
      .select("id")
      .eq("phone", phone)
      .gte("logged_at", today + "T00:00:00")
      .lte("logged_at", today + "T23:59:59")
      .single();

    if (existing) {
      await supabase.from("steps").update({ value }).eq("id", existing.id);
    } else {
      await supabase.from("steps").insert({ phone, value, logged_at: new Date().toISOString() });
    }
  },

  async getStepsAvg(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from("steps")
      .select("value")
      .eq("phone", phone)
      .gte("logged_at", since);

    const entries = data || [];
    if (entries.length === 0) return 0;
    return Math.round(entries.reduce((s, e) => s + e.value, 0) / entries.length);
  },

  async getStepsInRange(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from("steps")
      .select("value, logged_at")
      .eq("phone", phone)
      .gte("logged_at", since)
      .order("logged_at", { ascending: true });
    return data || [];
  },

  // ===== Weight =====
  async logWeight(phone, value) {
    await supabase.from("weight").insert({
      phone,
      value,
      logged_at: new Date().toISOString(),
    });
  },

  async getPreviousWeight(phone) {
    const { data } = await supabase
      .from("weight")
      .select("value, logged_at")
      .eq("phone", phone)
      .order("logged_at", { ascending: false })
      .limit(2);

    // Return the second most recent (previous to what was just logged)
    if (data && data.length >= 2) {
      const daysAgo = Math.round((Date.now() - new Date(data[1].logged_at).getTime()) / 86400000);
      return { value: data[1].value, daysAgo };
    }
    return null;
  },

  async getWeightHistory(phone, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from("weight")
      .select("value, logged_at")
      .eq("phone", phone)
      .gte("logged_at", since)
      .order("logged_at", { ascending: true });
    return data || [];
  },
};

module.exports = { db, supabase };
