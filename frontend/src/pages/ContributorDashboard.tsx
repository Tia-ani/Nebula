import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contributor } from '../utils/api';
import BrowserWorker from '../components/BrowserWorker';
import io, { Socket } from 'socket.io-client';
import '../styles/ContributorDashboard.css';

const ContributorDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    credits: 0,
    tasksCompleted: 0,
    activeWorkers: 0,
  });
  const [workerStates, setWorkerStates] = useState({
    browser: false,
    cpu: false,
    gpu: false,
  });
  const [showBrowserWorker, setShowBrowserWorker] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showCreditsNotification, setShowCreditsNotification] = useState(false);
  const [creditsEarned, setCreditsEarned] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('nebula-token');
    const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');

    if (!token || user.role !== 'contributor') {
      navigate('/auth');
      return;
    }

    loadStats();

    // Connect to Socket.io for real-time updates
    const newSocket = io('http://localhost:3000', {
      query: { type: 'dashboard', userEmail: user.email }
    });
    setSocket(newSocket);

    // Listen for dashboard updates (active worker count)
    newSocket.on('dashboard-update', (data: any) => {
      setStats(prev => ({
        ...prev,
        activeWorkers: data.workerCount || 0
      }));
    });

    // Listen for credits earned
    newSocket.on('credits-earned', (data: { amount: number; tasks: number }) => {
      setStats(prev => ({
        ...prev,
        credits: prev.credits + data.amount,
        tasksCompleted: prev.tasksCompleted + data.tasks
      }));
      setCreditsEarned(data.amount);
      setShowCreditsNotification(true);
      setTimeout(() => setShowCreditsNotification(false), 3000);
    });

    return () => {
      newSocket.close();
    };
  }, [navigate]);

  const loadStats = async () => {
    try {
      const response = await contributor.getStats();
      const data = response.data;
      setStats({
        credits: data.credits || 0,
        tasksCompleted: data.tasksCompleted || 0,
        activeWorkers: data.activeWorkers || 0,
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const toggleWorker = async (type: string) => {
    const isActive = workerStates[type as keyof typeof workerStates];

    if (type === 'browser') {
      if (isActive) {
        setShowBrowserWorker(false);
        setWorkerStates(prev => ({ ...prev, browser: false }));
      } else {
        setShowBrowserWorker(true);
        setWorkerStates(prev => ({ ...prev, browser: true }));
      }
      return;
    }

    if (type === 'cpu') {
      if (isActive) {
        setWorkerStates(prev => ({ ...prev, cpu: false }));
        alert('CPU worker stopped. Close the terminal running the worker.');
      } else {
        // Check for Ollama
        const hasOllama = await checkOllama();
        if (!hasOllama) {
          const install = window.confirm(
            'Ollama is not running or not installed.\n\n' +
            'Ollama is required for CPU workers.\n\n' +
            'Steps:\n' +
            '1. Install Ollama from ollama.ai\n' +
            '2. Run: ollama serve\n' +
            '3. Run: ollama pull llama3.2\n' +
            '4. Come back and click Start again\n\n' +
            'Click OK to open Ollama download page.'
          );
          if (install) {
            window.open('https://ollama.ai/download', '_blank');
          }
          return;
        }

        // Ollama is running, download worker script
        const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');
        downloadWorkerScript(user.email, false);
        
        setWorkerStates(prev => ({ ...prev, cpu: true }));
        alert(
          'Worker script downloaded!\n\n' +
          '1. Open your Downloads folder\n' +
          '2. Double-click: start-nebula-worker.sh\n' +
          '   (or run: bash start-nebula-worker.sh)\n' +
          '3. Keep the terminal open to earn credits\n\n' +
          'You earn 50 credits per task!'
        );
      }
      return;
    }

    if (type === 'gpu') {
      if (isActive) {
        setWorkerStates(prev => ({ ...prev, gpu: false }));
        alert('GPU worker stopped. Close the terminal running the worker.');
      } else {
        const hasGPU = await checkGPU();
        if (!hasGPU) {
          alert(
            'No compatible GPU detected.\n\n' +
            'GPU workers require:\n' +
            '- NVIDIA GPU with CUDA support\n' +
            '- Or AMD GPU with ROCm support\n\n' +
            'You can still use CPU worker for 50 credits/task!'
          );
          return;
        }

        // Download GPU worker script
        const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');
        downloadWorkerScript(user.email, true);

        setWorkerStates(prev => ({ ...prev, gpu: true }));
        alert(
          'GPU Worker script downloaded!\n\n' +
          '1. Open your Downloads folder\n' +
          '2. Double-click: start-nebula-worker.sh\n' +
          '   (or run: bash start-nebula-worker.sh)\n' +
          '3. Keep the terminal open to earn credits\n\n' +
          'You earn 100 credits per task!'
        );
      }
    }
  };

  const downloadWorkerScript = (email: string, isGPU: boolean) => {
    const masterUrl = window.location.origin;
    const gpuFlag = isGPU ? ' --gpu' : '';
    
    const scriptContent = `#!/bin/bash
# Nebula Worker Auto-Start Script
# Generated for: ${email}

echo "🚀 Starting Nebula Worker..."
echo "Email: ${email}"
echo "Type: ${isGPU ? 'GPU' : 'CPU'}"
echo "Master: ${masterUrl}"
echo ""

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "❌ Ollama is not running!"
    echo ""
    echo "Please start Ollama first:"
    echo "  1. Open Ollama app"
    echo "  2. Or run: ollama serve"
    echo ""
    exit 1
fi

# Check if llama3.2 model is installed
if ! ollama list | grep -q "llama3.2"; then
    echo "📥 Installing llama3.2 model..."
    ollama pull llama3.2
fi

echo "✅ Ollama is ready!"
echo ""
echo "Starting worker... Press Ctrl+C to stop"
echo ""

# Start the worker
npx nebula-worker start --master ${masterUrl} --email ${email}${gpuFlag}
`;

    const blob = new Blob([scriptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'start-nebula-worker.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const checkOllama = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${window.location.origin}/api/contributor/check-ollama`);
      const data = await response.json();
      return data.running === true;
    } catch (error) {
      console.log('Ollama check failed:', error);
      return false;
    }
  };

  const checkGPU = async (): Promise<boolean> => {
    // Simple GPU detection using WebGL
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;

      const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return false;

      const renderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return renderer.toLowerCase().includes('nvidia') || renderer.toLowerCase().includes('amd');
    } catch {
      return false;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nebula-token');
    localStorage.removeItem('nebula-user');
    navigate('/auth');
  };

  const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');

  return (
    <div className="contributor-dashboard">
      {showCreditsNotification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #34d399, #10b981)',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(52, 211, 153, 0.4)',
          fontSize: '1rem',
          fontWeight: 600,
          zIndex: 1001
        }}>
          +{creditsEarned} credits earned!
        </div>
      )}

      {showBrowserWorker && (
        <BrowserWorker onStop={() => {
          setShowBrowserWorker(false);
          setWorkerStates(prev => ({ ...prev, browser: false }));
        }} />
      )}

      <div className="container">
        <div className="nav">
          <div className="logo">NEBULA</div>
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="welcome">
          <h1>Contributor Dashboard</h1>
          <p>Choose how you want to contribute and start earning credits</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Credits Earned</div>
            <div className="stat-value">{stats.credits}</div>
            <div className="stat-sub">1 credit = ₹1</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Tasks Completed</div>
            <div className="stat-value" style={{ color: 'var(--purple)' }}>{stats.tasksCompleted}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Workers</div>
            <div className="stat-value" style={{ color: 'var(--yellow)' }}>{stats.activeWorkers}</div>
          </div>
        </div>

        <h2 className="section-title">Choose Your Contribution Method</h2>

        <div className="worker-grid">
          <div className={`worker-card ${workerStates.browser ? 'active' : ''}`} id="browser-worker">
            <div className="worker-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div className="worker-title">Browser Worker</div>
            <div className="worker-credits">10 credits/task</div>
            <div className="worker-desc">Simple API/JSON jobs. No installation required. Start earning instantly.</div>
            <div className={`worker-status ${workerStates.browser ? 'active' : 'inactive'}`}>
              {workerStates.browser ? 'Active' : 'Inactive'}
            </div>
            <button className="btn-primary" onClick={() => toggleWorker('browser')}>
              {workerStates.browser ? 'Stop' : 'Start'}
            </button>
          </div>

          <div className={`worker-card ${workerStates.cpu ? 'active' : ''}`} id="cpu-worker">
            <div className="worker-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
                <rect x="9" y="9" width="6" height="6"/>
                <line x1="9" y1="1" x2="9" y2="4"/>
                <line x1="15" y1="1" x2="15" y2="4"/>
                <line x1="9" y1="20" x2="9" y2="23"/>
                <line x1="15" y1="20" x2="15" y2="23"/>
                <line x1="20" y1="9" x2="23" y2="9"/>
                <line x1="20" y1="14" x2="23" y2="14"/>
                <line x1="1" y1="9" x2="4" y2="9"/>
                <line x1="1" y1="14" x2="4" y2="14"/>
              </svg>
            </div>
            <div className="worker-title">CPU Worker</div>
            <div className="worker-credits">50 credits/task</div>
            <div className="worker-desc">Runs Ollama for AI tasks. We'll help you install if needed.</div>
            <div className={`worker-status ${workerStates.cpu ? 'active' : 'inactive'}`}>
              {workerStates.cpu ? 'Active' : 'Inactive'}
            </div>
            <button className="btn-primary" onClick={() => toggleWorker('cpu')}>
              {workerStates.cpu ? 'Stop' : 'Start'}
            </button>
          </div>

          <div className={`worker-card ${workerStates.gpu ? 'active' : ''}`} id="gpu-worker">
            <div className="worker-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="worker-title">GPU Worker</div>
            <div className="worker-credits">100 credits/task</div>
            <div className="worker-desc">Maximum earnings. Requires GPU. Best for heavy AI workloads.</div>
            <div className={`worker-status ${workerStates.gpu ? 'active' : 'inactive'}`}>
              {workerStates.gpu ? 'Active' : 'Inactive'}
            </div>
            <button className="btn-primary" onClick={() => toggleWorker('gpu')}>
              {workerStates.gpu ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContributorDashboard;
