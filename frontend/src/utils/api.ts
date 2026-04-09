import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nebula-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const auth = {
  signup: (data: { name: string; email: string; password: string }) =>
    api.post('/api/auth/signup', data),
  
  login: (data: { email: string; password: string }) =>
    api.post('/api/auth/login', data),
  
  selectRole: (role: string) =>
    api.post('/api/auth/select-role', { role }),
};

export const contributor = {
  getStats: () => api.get('/api/contributor/stats'),
  startWorker: (workerType: string) => api.post('/api/contributor/start-worker', { workerType }),
  stopWorker: (workerType: string) => api.post('/api/contributor/stop-worker', { workerType }),
};

export const developer = {
  getStats: () => api.get('/api/developer/stats'),
  getJobs: () => api.get('/api/developer/jobs'),
  submitJob: (data: { tasks: string[]; priority: string }) =>
    api.post('/api/developer/submit-job', data),
};

export const superuser = {
  getStats: () => api.get('/api/superuser/stats'),
  getWorkerReputation: () => api.get('/api/superuser/worker-reputation'),
  getFlaggedWorkers: () => api.get('/api/superuser/flagged-workers'),
  getDeadLetterStats: () => api.get('/api/superuser/dead-letter-queue'),
  getDeadLetterJobs: (limit = 50) => api.get(`/api/superuser/dead-letter-jobs?limit=${limit}`),
  retryDeadLetterJob: (jobId: string) => api.post('/api/superuser/retry-dead-letter-job', { jobId }),
};

export default api;
