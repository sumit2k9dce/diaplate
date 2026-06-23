// scripts/setup-db.js — V2 schema with exercise, streaks, sugar types, meal types
// Run in Supabase SQL Editor

const SQL = `
-- V2: Enhanced users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  height_cm INTEGER,
  step_target INTEGER DEFAULT 7000,
  weight_day TEXT DEFAULT 'friday',
  reminders_enabled BOOLEAN DEFAULT true,
  paused_until TIMESTAMPTZ,
  streak_meals INTEGER DEFAULT 0,
  streak_sugar INTEGER DEFAULT 0,
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2: Enhanced meals with meal_type and pairing advice
CREATE TABLE IF NOT EXISTS meals (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  meal_type TEXT DEFAULT 'full_meal',
  description TEXT,
  items JSONB,
  calories INTEGER,
  glycemic_load TEXT,
  tplate_score INTEGER,
  veg_percent INTEGER,
  protein_percent INTEGER,
  carb_percent INTEGER,
  suggestion TEXT,
  pairing_advice TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2: Sugar with reading types
CREATE TABLE IF NOT EXISTS sugar_readings (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value INTEGER NOT NULL,
  reading_type TEXT DEFAULT 'fasting',
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steps (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value INTEGER NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weight (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value DECIMAL(5,2) NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2 NEW: Exercise tracking
CREATE TABLE IF NOT EXISTS exercise (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  exercise_type TEXT NOT NULL,
  duration_mins INTEGER NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meals_phone_date ON meals(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_sugar_phone_date ON sugar_readings(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_sugar_type ON sugar_readings(phone, reading_type, logged_at);
CREATE INDEX IF NOT EXISTS idx_steps_phone_date ON steps(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_weight_phone_date ON weight(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_exercise_phone_date ON exercise(phone, logged_at);

-- V2: Add new columns to existing tables (safe: IF NOT EXISTS via DO blocks)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_meals INTEGER DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_sugar INTEGER DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ;
  ALTER TABLE meals ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'full_meal';
  ALTER TABLE meals ADD COLUMN IF NOT EXISTS pairing_advice TEXT;
  ALTER TABLE sugar_readings ADD COLUMN IF NOT EXISTS reading_type TEXT DEFAULT 'fasting';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
`;

console.log("Copy this SQL into Supabase Dashboard → SQL Editor → Run:\n");
console.log("═".repeat(60));
console.log(SQL);
console.log("═".repeat(60));
console.log("\nThis creates/updates all tables for DiaPlate V2.");
