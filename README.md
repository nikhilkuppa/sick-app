# 🐻 Sick? - Drug Recommendation App (Redis-Free!)

> **Phase 1 Complete!** No more Redis dependencies. Lightweight, cost-effective, ready for free hosting!

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- pip

### Installation

```bash
# 1. Create and activate virtual environment
python -m venv sickEnv
source sickEnv/bin/activate  # On Windows: sickEnv\Scripts\activate

# 2. Install dependencies (NO REDIS NEEDED!)
pip install -r req.txt

# 3. Set up your secrets
cp .env.example .env.local
# Edit .env.local and add your API keys:
#   - SUPABASE_URL
#   - SUPABASE_SERVICE_ROLE_KEY
#   - SUPABASE_ANON_KEY
#   - GEMINI_API_KEY
#   - GOOGLE_MAPS_API_KEY
#   - JWT_SECRET

# 4. Run the app
python run.py

# 5. In another terminal, run the worker
source sickEnv/bin/activate
python worker_run.py
```

Visit `http://localhost:3000` 🎉

---

## ✨ What's New (Phase 1 Refactor)

### ❌ Removed
- **Redis** - No external cache needed!
- **RQ (Redis Queue)** - Replaced with SQLite task queue
- **Redis Cloud subscription** - $0/month savings!

### ✅ Added
- **In-Memory LRU Cache** - Faster than remote Redis
- **SQLite Task Queue** - Lightweight job processing
- **Custom Task Worker** - Background job system
- **Secure Secrets Management** - `.env.local` for private keys

### 🐻 Protected
- **Bear Mascot** - Safe and sound in bottom-left corner!

---

## 📁 Project Structure

```
sick-app/
├── app/
│   ├── __init__.py              # Flask app factory
│   ├── config.py                # Configuration (loads .env + .env.local)
│   │
│   ├── api/                     # API endpoints
│   │   ├── routes.py            # Main API routes
│   │   └── validators.py        # Input validation
│   │
│   ├── auth/                    # Authentication
│   │   ├── routes.py            # Auth endpoints
│   │   ├── services.py          # Auth logic
│   │   ├── middleware.py        # Auth decorators
│   │   └── rate_limiter.py      # In-memory rate limiting
│   │
│   ├── core/                    # Core systems
│   │   ├── caching.py           # In-memory LRU cache (NO REDIS!)
│   │   ├── task_queue.py        # SQLite-based job queue
│   │   ├── task_worker.py       # Background worker
│   │   └── recommender.py       # Gemini AI integration
│   │
│   ├── db/                      # Database
│   │   └── supabase_client.py   # Supabase (PostgreSQL)
│   │
│   ├── workers/                 # Background tasks
│   │   └── tasks.py             # Task definitions
│   │
│   ├── utils/                   # Utilities
│   │   ├── metrics.py           # In-memory metrics
│   │   ├── security.py          # Input sanitization
│   │   └── timezone.py          # Timezone utilities
│   │
│   └── static/                  # Frontend
│       ├── index.html           # Main UI
│       ├── css/
│       │   └── modern-styles.css  # Styling (with 🐻!)
│       └── js/
│           ├── app.js           # Main app logic
│           ├── auth.js          # Authentication
│           ├── medications.js   # Medication tracking
│           └── apiService.js    # HTTP client
│
├── data/                        # Static data
│   ├── medlineplus_data_v1.tsv # Drug information
│   └── drug_embeddings_symptoms.npy  # Embeddings
│
├── .env                         # Public config
├── .env.local                   # Private secrets (git-ignored)
├── .env.example                 # Template
├── run.py                       # Flask app entry point
├── worker_run.py                # Worker entry point
├── req.txt                      # Dependencies (NO REDIS!)
└── Procfile                     # Deployment config
```

---

## 🔧 Architecture

### Before (Phase 0)
```
Flask App ──→ Redis Cloud ──→ RQ Worker
                ↓
          Cache + Queue
```

**Problems:**
- External Redis dependency
- Monthly costs
- Maintenance overhead
- Free tier requires activity

### After (Phase 1)
```
Flask App ──→ In-Memory Cache (LRU)
          ──→ SQLite Queue ──→ Custom Worker
```

**Benefits:**
- ✅ Zero external dependencies
- ✅ $0/month
- ✅ Faster cache (local memory)
- ✅ Perfect for free hosting

---

## 🎯 Features

### Current Features
- ✅ **AI-Powered Recommendations** - Gemini API integration
- ✅ **User Authentication** - Email + OAuth (Google)
- ✅ **Medication Tracking** - Add, edit, delete medications
- ✅ **Adherence Tracking** - Log taken/skipped doses
- ✅ **Pharmacy Locator** - Find nearby pharmacies by ZIP
- ✅ **Search History** - View past queries
- ✅ **Profile Management** - Age, allergies, conditions

### Coming Soon (Phase 2-3)
- 🚧 **Enhanced Symptom Interpreter** - Severity levels, red flags
- 🚧 **Contraindication Checker** - Safety filters
- 🚧 **Interaction Heatmap** - Visual drug interactions
- 🚧 **Dynamic Treatment Plans** - Day-by-day recommendations
- 🚧 **"What You Can Mix" Advisor** - Safe combinations
- 🚧 **Digital Medicine Cabinet** - Expiration tracking
- 🚧 **Smart Shopping Mode** - Price comparison
- 🚧 **Recovery Timeline** - Predicted improvement time

---

## 🛠️ Development

### Running Tests
```bash
# Coming soon!
pytest tests/
```

### Database Migrations
```bash
# Supabase migrations are handled via SQL scripts
# See database schema in Supabase dashboard
```

### Environment Variables

**`.env` (public config)**
- `FLASK_APP`, `FLASK_ENV`, `PORT`
- `CACHE_EXPIRATION`, `MAX_CACHE_SIZE`
- `WORKER_CONCURRENCY`, `MAX_RETRIES`
- `RATE_LIMIT_DEFAULT`

**`.env.local` (private secrets, git-ignored)**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`
- `JWT_SECRET`
- `FOUNDER_EMAIL`

---

## 🚢 Deployment

### Option 1: Railway (Recommended)
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set environment variables in Railway dashboard
# Both web and worker will auto-deploy from Procfile
```

### Option 2: Render
```yaml
# render.yaml
services:
  - type: web
    name: sick-app
    env: python
    buildCommand: "pip install -r req.txt"
    startCommand: "gunicorn -w 4 -b 0.0.0.0:$PORT run:app"

  - type: worker
    name: sick-app-worker
    env: python
    buildCommand: "pip install -r req.txt"
    startCommand: "python worker_run.py"
```

### Option 3: fly.io
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch
fly deploy
```

---

## 📊 Database Schema (Supabase)

### Tables

**`recommendations`**
- `job_id` (UUID, PK)
- `user_id` (UUID, nullable)
- `user_query` (TEXT)
- `user_profile` (JSON)
- `status` (ENUM: queued, processing, done, failed)
- `result` (JSON)
- `subscription_tier` (VARCHAR)
- `created_at`, `updated_at`

**`user_profiles`**
- `user_id` (UUID, PK)
- `name`, `email`
- `age`, `gender`
- `allergies` (JSON array)
- `medication_history` (JSON array)
- `zip_code`, `timezone`
- `subscription_tier`

**`user_medications`**
- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `medication_data` (JSON)

**`medication_status`**
- `user_id`, `medication_id`
- `status_date`, `status_time`
- `status` (ENUM: taken, skipped, none)

---

## 🤝 Contributing

Phase 2 (UI/UX) and Phase 3 (Features) in progress!

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

- **MedlinePlus** - Drug information database
- **Google Gemini** - AI recommendations
- **Supabase** - Database & auth
- **Flask** - Web framework

---

## 🐻 About the Bear

Our mascot lives in the bottom-left corner of the app. He's built with pure CSS and waves when you hover! Protected through all refactors. 🐻✨

---

**Built with ❤️ and zero Redis dependencies**
