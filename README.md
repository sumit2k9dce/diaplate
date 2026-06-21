# 🍽️ DiaPlate

**WhatsApp AI companion for diabetic meal and health management.**

Send meal photos, sugar readings, steps, and weight on WhatsApp. Get T-Plate analysis, health insights, and weekly reports — all for free.

![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=flat&logo=whatsapp&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini_Flash-4285F4?style=flat&logo=google&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?style=flat&logo=vercel&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=white)

---

## What It Does

| Send this on WhatsApp | DiaPlate responds with |
|---|---|
| 📸 Meal photo | T-Plate score (1-10), calorie estimate, glycemic load, veggie/protein/carb breakdown, improvement tip |
| `110` | Fasting sugar logged, 7-day trend, target range comparison |
| `5000 steps` | Activity tracked, weekly average, distance from goal |
| `73.5 kg` | Weight logged, BMI calculated, change since last weigh-in, safe lipid ranges |
| `Can I eat mangoes?` | Culturally-aware diabetes guidance with actionable tips |
| `summary` | Full weekly report: sugar trends, meal scores, step averages, weight progress |

### T-Plate Method
The diabetes plate method divides your plate:
- 🥬 **50%** non-starchy vegetables
- 🍗 **25%** lean protein
- 🍚 **25%** complex carbohydrates

DiaPlate scores every meal photo against this standard.

---

## Tech Stack (100% Free Tier)

| Component | Tool | Cost |
|---|---|---|
| WhatsApp gateway | Twilio Sandbox | Free (dev/testing) |
| AI (vision + text) | Google Gemini 2.0 Flash | Free (1,500 req/day) |
| Backend | Vercel Serverless Functions | Free tier |
| Database | Supabase (PostgreSQL) | Free (500MB) |

**Total cost: $0**

---

## Setup (15 minutes)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/diaplate.git
cd diaplate
npm install
```

### 2. Create free accounts

| Service | Sign up | What you need |
|---|---|---|
| [Twilio](https://www.twilio.com/try-twilio) | Free trial | Account SID + Auth Token |
| [Google AI Studio](https://aistudio.google.com/apikey) | Free | API Key |
| [Supabase](https://supabase.com/dashboard) | Free | Project URL + Service Role Key |
| [Vercel](https://vercel.com) | Free | GitHub integration |

### 3. Configure Twilio WhatsApp Sandbox

1. Go to [Twilio Console → WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn)
2. Note the sandbox number (usually `+14155238886`)
3. Send the join code from your WhatsApp to activate the sandbox
4. Set the webhook URL to: `https://your-vercel-app.vercel.app/api/webhook`
5. Set HTTP method to `POST`

### 4. Create database tables

Go to [Supabase Dashboard → SQL Editor](https://supabase.com/dashboard) and run:

```sql
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  height_cm INTEGER,
  step_target INTEGER DEFAULT 7000,
  weight_day TEXT DEFAULT 'friday',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS sugar_readings (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES users(phone),
  value INTEGER NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_meals_phone_date ON meals(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_sugar_phone_date ON sugar_readings(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_steps_phone_date ON steps(phone, logged_at);
CREATE INDEX IF NOT EXISTS idx_weight_phone_date ON weight(phone, logged_at);
```

### 5. Set environment variables

```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

### 6. Test locally

```bash
# Test Gemini connection
GEMINI_API_KEY=your_key node scripts/test-gemini.js

# Run local dev server
npx vercel dev
```

### 7. Deploy to Vercel

```bash
# Link to Vercel
npx vercel

# Set environment variables in Vercel dashboard
# Deploy to production
npx vercel --prod
```

### 8. Update Twilio webhook

Set your Twilio WhatsApp Sandbox webhook to:
```
https://your-app-name.vercel.app/api/webhook
```

**Done! Send "Hi" on WhatsApp to your sandbox number.**

---

## Architecture

```
User (WhatsApp)
    │
    ▼
Twilio (receives message, forwards to webhook)
    │
    ▼
Vercel Serverless Function (/api/webhook.js)
    │
    ├── lib/router.js (detects intent: photo/sugar/steps/weight/question)
    │
    ├── lib/plate-analyzer.js (Gemini Flash vision → T-Plate analysis)
    │
    ├── lib/health-advisor.js (Gemini Flash → diabetes Q&A)
    │
    ├── lib/database.js (Supabase CRUD for all health data)
    │
    ├── lib/metrics.js (BMI, trends, weekly summary computation)
    │
    ▼
Twilio (sends reply back to WhatsApp)
```

---

## Sample Conversations

**Morning sugar:**
```
User: 108
Bot:  🟢 Fasting Sugar: 108 mg/dL — Normal
      📈 7-day average: 112 mg/dL (trending ↓ — great progress!)
```

**Meal photo:**
```
User: [sends photo of lunch plate]
Bot:  🍽️ Lunch Analysis
      T-Plate Score: 7/10
      Estimated Calories: 520 kcal
      Glycemic Load: Medium
      What I see: Rice, dal, mixed vegetable sabzi, and curd
      T-Plate Breakdown:
        🥬 Vegetables: 30% (target: 50%)
        🍗 Protein: 25% (target: 25%)
        🍚 Carbs: 45% (target: 25%)
      💡 Tip: Try reducing rice to 1 cup and adding more sabzi.
```

**Health question:**
```
User: Can I eat mangoes?
Bot:  Yes, in moderation! Half a medium mango (~80g) has about
      60 calories and a medium glycemic index. Pair it with a
      handful of nuts to slow sugar absorption. Avoid mango
      juice or mango with rice — that combination spikes sugar.
```

---

## AI Concepts Demonstrated

This project covers these AI PM interview concepts:

- **Multimodal AI** — Gemini vision analyzes food plate photos
- **Conversational AI** — Natural language intent detection on WhatsApp
- **NLP parsing** — Extracts sugar values, steps, weight from free-text messages
- **Longitudinal tracking** — Trends over days/weeks/months
- **Health AI guardrails** — Never gives medication advice, flags dangerous readings
- **Feedback loops** — Every interaction improves context for future responses
- **Platform-native design** — WhatsApp as distribution (95%+ message open rate)
- **Eval-ready** — Golden set can test intent detection + plate analysis accuracy

---

## Medical Disclaimer

DiaPlate is a lifestyle companion, **not a medical device**. It does not diagnose, prescribe, or replace professional medical advice. Always follow your doctor's guidance for diabetes management.

---

## License

MIT
