# Nebula

**Distributed compute network — idle devices become a supercomputer.**

Nebula splits AI jobs across multiple devices, processes them in parallel, and returns results. Contributors earn credits for sharing their compute. Developers get AI inference at a fraction of AWS cost.

---

## How it works

```
Developer submits job → Nebula splits into chunks → Workers process in parallel → Results assembled → Returned to developer
```

Three types of participants:

- **Contributors** — run a worker on their idle device, earn credits
- **Consumers** — submit AI jobs via API, pay per task
- **Nebula** — connects both sides, takes a small cut

---

## Quick start

### For contributors (earn credits)

Make sure [Ollama](https://ollama.ai) is installed and running, then:

```bash
ollama pull llama3.2
npx nebula-worker start --master https://nebula-mk65.onrender.com
```

Your device is now part of the network. It processes AI chunks silently in the background and earns credits.

### For developers (submit jobs)

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

---

## API reference

### `POST /api/v1/run`

Submit an AI job to the network.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-api-key` | Yes | Your Nebula API key |
| `Content-Type` | Yes | `application/json` |

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
|---|---|
| `401` | Missing or invalid API key |
| `400` | Invalid tasks array |
| `503` | No workers available right now |

---

### `GET /api/v1/status`

Check network health. No API key required.

---

## Project structure

```
nebula_v2/
├── master/          # Orchestrator — splits jobs, assigns chunks, assembles results
├── worker/          # Node worker — connects to master, runs Ollama inference
├── sdk/             # Developer SDK — simple interface to submit jobs
├── nebula-worker/   # npm package — published as nebula-worker on npm
├── shared/          # Shared utilities — encryption, chunking
└── dashboard/       # Live network dashboard
```

---

## Architecture

```
Consumer (API call)
      ↓
   Master Node  ←→  Dashboard (live stats)
   (Render)
    ↙    ↘
Worker1  Worker2  Worker3  ...
(Ollama) (Ollama) (Ollama)
```

**Key design decisions:**

- **Per-session AES-256 encryption** — each worker gets a unique key on connect, deleted on disconnect. Compromise one worker = only that session exposed.
- **Fault tolerance** — if a worker dies mid-job, its chunk is automatically reassigned to another worker.
- **Worker type aware** — node workers use encrypted payloads, browser workers use plaintext. Reassignment re-encodes for the new worker's type.
- **No shared secrets** — encryption keys never touch disk, never leave memory.

---

## Running locally

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/nebula_v2
cd nebula_v2

# 2. Install dependencies
npm install
cd master && npm install
cd ../sdk && npm install

# 3. Start Ollama
ollama serve
ollama pull llama3.2

# 4. Start master
cd master && node index.js

# 5. Start a worker (new terminal)
cd worker && node index.js

# 6. Submit a test job (new terminal)
cd sdk && node test.js
```

---

## Roadmap

- [x] Distributed AI inference across multiple devices
- [x] AES-256 per-session encryption
- [x] Fault tolerance — automatic chunk reassignment
- [x] Browser workers — join via link, no install
- [x] `nebula-worker` npm package
- [x] Master deployed on cloud (Render)
- [x] Public REST API
- [ ] API key management dashboard
- [ ] Credits system — earn and spend
- [ ] Auto-install Ollama with one keypress
- [ ] GPU worker tier
- [ ] Pricing — 50% cheaper than AWS, always
- [ ] UPI cashout for contributors

---

## Built by

**Anish Khurana** — building in public, day by day.

Follow the journey on X: [@KhuranaAni62798](https://twitter.com/KhuranaAni62798)

---

> Nebula is the Airbnb of computing power — idle devices become income-generating assets, and anyone gets access to supercomputer-level power at street prices.
