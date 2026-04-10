# Nebula

**Distributed compute network — idle devices become a supercomputer.**

Nebula splits AI jobs across multiple devices, processes them in parallel, and returns results. Contributors earn credits for sharing their compute. Developers get AI inference at a fraction of AWS cost.

## How it works

Developer submits job → Nebula splits into chunks → Workers process in parallel → Results assembled → Returned to developer

Three types of participants:

- **Contributors** — run a worker on their idle device, earn credits
- **Consumers** — submit AI jobs via API, pay per task
- **Nebula** — connects both sides, takes a small cut

## Quick start

### For contributors (earn credits)

**Option 1: Browser Worker (easiest)**
1. Sign up at https://nebula-mk65.onrender.com
2. Choose "Contributor" role
3. Click "Start" on Browser Worker
4. Earn 10 credits per task instantly

**Option 2: CPU Worker (better earnings)**

Make sure Ollama is installed and running, then:

```bash
npx nebula-worker start --master https://nebula-mk65.onrender.com --email your@email.com
```

Your device is now part of the network. It processes AI chunks silently in the background and earns 50 credits per task. The model (gemma:4b) will auto-install on first run.

**Option 3: GPU Worker (maximum earnings)**

```bash
npx nebula-worker start --gpu --master https://nebula-mk65.onrender.com --email your@email.com
```

Earn 100 credits per task with GPU acceleration.

### For developers (submit jobs)

**Option 1: Web Dashboard**
1. Sign up at https://nebula-mk65.onrender.com
2. Choose "Developer" role
3. Submit jobs through the dashboard
4. Get 100 free credits to start
5. View results in real-time when jobs complete

**Option 2: REST API**

```bash
curl -X POST https://nebula-mk65.onrender.com/api/v1/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"tasks": ["Summarise this text...", "Classify this as positive or negative..."]}'
```

Response:
```json
{
  "jobId": "b9583629-abcf-444e-8bf8-98c24702f2bc",
  "result": ["Summary here...", "Positive."]
}
```

### Check network status

```bash
curl https://nebula-mk65.onrender.com/api/v1/status
```

```json
{
  "status": "online",
  "workers": 3,
  "jobsRunning": 1,
  "jobsCompleted": 47,
  "tasksProcessed": 212,
  "ready": true
}
```

## API reference

### POST /api/v1/run

Submit an AI job to the network.

**Headers**

| Header | Required | Description |
|--------|----------|-------------|
| x-api-key | Yes | Your Nebula API key |
| Content-Type | Yes | application/json |

**Body**
```json
{
  "tasks": ["task 1", "task 2", "task 3"]
}
```

- `tasks` — array of strings, max 100 per job
- Each task is a natural language prompt sent to the worker's AI model

**Response**
```json
{
  "jobId": "uuid",
  "result": ["result 1", "result 2", "result 3"]
}
```

**Errors**

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid API key |
| 400 | Invalid tasks array |
| 503 | No workers available right now |

### GET /api/v1/status

Check network health. No API key required.

## Project structure

```
nebula_v2/
├── master/          # Orchestrator — splits jobs, assigns chunks, assembles results
├── worker/          # Node worker — connects to master, runs Ollama inference
├── sdk/             # Developer SDK — simple interface to submit jobs
├── nebula-worker/   # npm package — published as nebula-worker on npm
├── shared/          # Shared utilities — encryption, chunking
├── frontend/        # React/TypeScript web application
└── dashboard/       # Live network dashboard
```

## Architecture

```
Consumer (Web Dashboard or API call)
         ↓
   Master Node  ←→  Dashboard (live stats)
     (Render)
    ↙    ↘
Worker1  Worker2  Worker3  ...
(Browser/CPU/GPU)
```

**Key design decisions:**

- **Per-session AES-256 encryption** — each worker gets a unique key on connect, deleted on disconnect. Compromise one worker = only that session exposed.
- **Fault tolerance** — if a worker dies mid-job, its chunk is automatically reassigned to another worker.
- **Worker type aware** — node workers use encrypted payloads, browser workers use plaintext. Reassignment re-encodes for the new worker's type.
- **No shared secrets** — encryption keys never touch disk, never leave memory.
- **Real-time updates** — Socket.io for live credit tracking and job results

## Features

### Authentication & Roles
- User signup/login with PostgreSQL
- Three roles: Contributor, Developer, Superuser
- Role-based dashboards with different capabilities
- Session management with JWT tokens

### Quality Assurance System
- **Canary tasks**: 105 verifiable tasks injected at 15% rate
- **Real-time validation**: Automatic checking of worker outputs
- **Worker reputation**: 0-100% scoring based on canary pass rate
- **Payment blocking**: Workers with <85% pass rate get flagged and blocked
- **Fraud detection**: Invisible canaries prevent gaming the system
- **Reputation dashboard**: Superusers can monitor all worker quality metrics

### For Contributors
- Three worker types: Browser (10 credits), CPU (50 credits), GPU (100 credits)
- Real-time credit updates as tasks complete
- Live worker status and task tracking
- Automatic Ollama detection for CPU workers
- GPU detection for GPU workers
- Credits earned notification system

### For Developers
- Submit jobs through web dashboard or API
- Priority levels: Normal (1x), High (1.5x), Urgent (2x)
- Real-time job completion notifications
- View detailed results with input/output pairs
- Click completed jobs to review results
- Cost estimation before submission
- 100 free credits on signup

### For Superusers
- Network-wide statistics
- User management
- Worker reputation dashboard with quality metrics
- Real-time fraud detection and flagged worker tracking
- System monitoring
- Total credits in circulation

## Credits System

### Earning (Contributors)
- **Browser Worker**: 10 credits/task — no installation, runs in browser
- **CPU Worker**: 50 credits/task — requires Ollama
- **GPU Worker**: 100 credits/task — requires GPU + Ollama

### Spending (Developers)
- **Base cost**: 10 credits/task
- **Priority multipliers**: Normal (1x), High (1.5x), Urgent (2x)
- **New developers**: 100 free credits to start

### Conversion
- **1 credit = ₹1**

## Running locally

```bash
# 1. Clone the repo
git clone https://github.com/Tia-ani/Nebula
cd Nebula

# 2. Install dependencies
npm install
cd master && npm install
cd ../frontend && npm install
cd ../sdk && npm install

# 3. Start Ollama
ollama serve

# 4. Build the frontend
cd frontend && npm run build

# 5. Start master (serves both backend and frontend)
cd ../master && node index.js

# 6. Access the application
# Open browser: http://localhost:3000

# 7. Start a worker (new terminal)
npx nebula-worker start --master http://localhost:3000 --email your@email.com

# 8. Submit a test job via API (new terminal)
cd sdk && node test.js
```

### Default Superuser Account
```
Email: founder@nebula.com
Password: nebula2024
```

## Live Deployment

The application is live at: **https://nebula-mk65.onrender.com**

- Sign up and start contributing or developing
- Browser workers work instantly
- CPU/GPU workers connect to the live master node
- Real-time updates across all dashboards

## Roadmap

- [x] Distributed AI inference across multiple devices
- [x] AES-256 per-session encryption
- [x] Fault tolerance — automatic chunk reassignment
- [x] Browser workers — join via link, no install
- [x] nebula-worker npm package
- [x] Master deployed on cloud (Render)
- [x] Public REST API
- [x] API key management dashboard
- [x] Credits system — earn and spend
- [x] React/TypeScript web application
- [x] Real-time updates with Socket.io
- [x] Job results with input/output display
- [x] PostgreSQL with Redis for persistence and job queue
- [x] BullMQ for reliable job management
- [x] Canary verification system (105 tasks)
- [x] Worker reputation tracking and payment blocking
- [x] Fraud detection dashboard for superusers
- [ ] Auto-install Ollama with one keypress
- [ ] GPU worker tier
- [ ] Pricing — 50% cheaper than AWS, always
- [ ] UPI cashout for contributors

## Built by

**Anishka Khurana** — building in public, day by day.

Follow the journey on X: [@KhuranaAni62798](https://twitter.com/KhuranaAni62798)

---

> Nebula is the Airbnb of computing power — idle devices become income-generating assets, and anyone gets access to supercomputer-level power at street prices.
