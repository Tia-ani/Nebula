# Nebula

**Distributed compute network — idle devices become a supercomputer.**

Nebula splits AI jobs across multiple devices, processes them in parallel, and returns results. Contributors earn credits for sharing their compute. Developers get AI inference at a fraction of AWS cost.

## Quick Start

### Start the Server
```bash
cd master
npm install
node index.js
```

### Access the Application
Open your browser: http://localhost:3000

### Default Superuser Account
```
Email: founder@nebula.com
Password: nebula2024
```

## Features

- User authentication with MongoDB
- Role-based dashboards (Contributor, Developer, Superuser)
- Credits system (earn and spend)
- Job submission and tracking
- Real-time updates
- Worker management

## Database

Connected to MongoDB Atlas:
- Database: Nebula
- Collections: users, sessions
- Auto-creates default superuser on first run

## Architecture

```
Developer submits job → Nebula splits into chunks → Workers process in parallel → Results assembled → Returned to developer
```

Three types of participants:

- **Contributors** — run a worker on their idle device, earn credits
- **Developers** — submit AI jobs via API, pay per task
- **Superuser** — manage the entire network

## API Endpoints

### Authentication
- POST /api/auth/signup - Create account
- POST /api/auth/login - Login
- POST /api/auth/select-role - Choose role

### Contributor
- GET /api/contributor/stats - Get stats

### Developer
- GET /api/developer/stats - Get stats
- POST /api/developer/submit-job - Submit job

### Superuser
- GET /api/superuser/stats - Get all stats

## Credits System

### Earning (Contributors)
- Browser Worker: 10 credits/task
- CPU Worker: 50 credits/task
- GPU Worker: 100 credits/task

### Spending (Developers)
- Base: 10 credits/task
- Priority: Normal (1x), High (1.5x), Urgent (2x)
- New developers get 100 free credits

### Conversion
- 1 credit = ₹1

## Built by

**Anish Khurana** — building in public, day by day.

Follow the journey on X: [@KhuranaAni62798](https://twitter.com/KhuranaAni62798)

---

> Nebula is the Airbnb of computing power — idle devices become income-generating assets, and anyone gets access to supercomputer-level power at street prices.
