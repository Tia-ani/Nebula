# Nebula Frontend

React + TypeScript frontend for the Nebula distributed compute network.

## Development

```bash
cd frontend
npm install
npm start
```

The app will run on http://localhost:3001 and proxy API requests to http://localhost:3000

## Production Build

```bash
cd frontend
npm run build
```

The build will be created in `frontend/build/` and served by the backend server.

## Features

- Landing page with animated network visualization
- Authentication (login/signup)
- Role selection (Contributor/Developer)
- Contributor Dashboard - Choose worker type and earn credits
- Developer Dashboard - Submit jobs and track progress
- Superuser Dashboard - Complete network analytics
- Real-time updates via Socket.io
- Responsive design
- Dark theme with purple/green accents
