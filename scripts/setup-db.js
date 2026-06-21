// scripts/setup-db.js — Run this once to create tables in Supabase
// Usage: SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node scripts/setup-db.js

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SQL = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  height_cm INTEGER,
  step_target INTEGER DEFAULT 7000,
  weight_day TEXT DEFAULT 'friday',
  reminders_enabled BOOLEAN DEFAULT true,
  paused_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meal logs with T-plate analysis
CREATE TABLE IF NOT EXISTS meals (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  description TEXT,
  items JSONB,
  calories INTEGER,
  glycemic_load TEXT,
  tplate_score INTEGER,
  veg_percent INTEGER,
  protein_percent INTEGER,
  carb_percent INTEGER,
  suggestion TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fasting sugar readings
CREATE TABLE IF NOT EXISTS sugar_readings (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value INTEGER NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily step counts
CREATE TABLE IF NOT EXISTS steps (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value INTEGER NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weight entries
CREATE TABLE IF NOT EXISTS weight (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value DECIMAL(5,2) NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_meals_phone_date ON meals(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_sugar_phone_date ON sugar_readings(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_steps_phone_date ON steps(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_weight_phone_date ON weight(phone, logged_at);
`;

async function setup() {
  console.log("Setting up DiaPlate database tables...\n");

  // Execute each statement separately
  const statements = SQL.split(";").filter(s => s.trim().length > 5);

  for (const stmt of statements) {
    const cleaned = stmt.trim();
    const name = cleaned.match(/(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
    try {
      const { error } = await supabase.rpc("exec_sql", { query: cleaned + ";" });
      if (error) {
        // Try direct query via REST - Supabase may not have exec_sql
        console.log(`  ⚠️  ${name?.[1] || "statement"}: Use Supabase SQL Editor instead`);
      } else {
        console.log(`  ✅ ${name?.[1] || "statement"}: created`);
      }
    } catch (e) {
      console.log(`  ⚠️  ${name?.[1] || "statement"}: ${e.message}`);
    }
  }

  console.log("\n─────────────────────────────────────────");
  console.log("If any tables failed, copy the SQL below");
  console.log("into Supabase Dashboard → SQL Editor → Run:");
  console.log("─────────────────────────────────────────\n");
  console.log(SQL);
}

setup().catch(console.error);
