import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superuser } from '../utils/api';
import io, { Socket } from 'socket.io-client';
import '../styles/ContributorDashboard.css';
import '../styles/SuperuserDashboard.css';

interface User {
  name: string;
  email: string;
  role: string;
  credits: number;
  createdAt: string;
  active: boolean;
}

interface WorkerReputation {
  worker_id: string;
  user_email: string;
  worker_type: string;
  canary_pass_rate: number;
  reputation_score: number;
  chunks_completed: number;
  chunks_failed: number;
  total_canaries: number;
  canaries_passed: number;
  last_active_at: string;
}

interface DeadLetterJob {
  jobId: string;
  reason: string;
  retriesExhausted: number;
  timestamp: number;
  metadata: any;
}

const SuperuserDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [socket] = useState<Socket | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalContributors: 0,
    totalDevelopers: 0,
    activeWorkers: 0,
    totalJobs: 0,
    creditsFlow: 0,
  });
  const [users, setUsers] = useState<User[]>([]);
  const [workers, setWorkers] = useState<string[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [workerReputation, setWorkerReputation] = useState<WorkerReputation[]>([]);
  const [dlqJobs, setDlqJobs] = useState<DeadLetterJob[]>([]);
  const [dlqStats, setDlqStats] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('nebula-token');
    const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');

    if (!token || user.role !== 'superuser') {
      navigate('/auth');
      return;
    }

    loadAllData();

    // Setup socket connection
    const newSocket = io('http://localhost:3000');

    newSocket.on('dashboard-update', (data) => {
      setStats(prev => ({
        ...prev,
        activeWorkers: data.workerCount || 0,
        totalJobs: data.jobsCompleted || 0,
      }));
      setWorkers(data.workers || []);
      setJobs(data.jobs || []);
    });

    const interval = setInterval(loadAllData, 5000);

    return () => {
      newSocket.close();
      clearInterval(interval);
    };
  }, [navigate]);

  const loadAllData = async () => {
    try {
      const response = await superuser.getStats();
      const data = response.data;
      setStats({
        totalUsers: data.totalUsers || 0,
        totalContributors: data.totalContributors || 0,
        totalDevelopers: data.totalDevelopers || 0,
        activeWorkers: data.activeWorkers || 0,
        totalJobs: data.totalJobs || 0,
        creditsFlow: data.creditsFlow || 0,
      });
      setUsers(data.users || []);

      // Load worker reputation data
      const reputationResponse = await superuser.getWorkerReputation();
      setWorkerReputation(reputationResponse.data.workers || []);

      // Load dead letter queue data
      const dlqStatsResponse = await superuser.getDeadLetterStats();
      setDlqStats(dlqStatsResponse.data);

      const dlqJobsResponse = await superuser.getDeadLetterJobs(20);
      setDlqJobs(dlqJobsResponse.data.jobs || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nebula-token');
    localStorage.removeItem('nebula-user');
    navigate('/auth');
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await superuser.retryDeadLetterJob(jobId);
      loadAllData();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  return (
    <div className="superuser-dashboard">
      <div className="container">
        <div className="nav">
          <div>
            <span className="logo">
              <div className="logo-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
                  <circle cx="8" cy="8" r="2"/>
                  <circle cx="8" cy="8" r="6" fill="none" stroke="white" strokeWidth="1"/>
                </svg>
              </div>
              NEBULA
            </span>
            <span className="superuser-badge">SUPERUSER</span>
          </div>
          <div className="user-info">
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="welcome">
          <h1>Superuser Dashboard</h1>
          <p>Complete network overview and analytics</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Users</div>
            <div className="stat-value">{stats.totalUsers}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Contributors</div>
            <div className="stat-value" style={{ color: 'var(--purple)' }}>{stats.totalContributors}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Developers</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.totalDevelopers}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Workers</div>
            <div className="stat-value" style={{ color: 'var(--yellow)' }}>{stats.activeWorkers}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Jobs</div>
            <div className="stat-value" style={{ color: 'var(--blue)' }}>{stats.totalJobs}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Credits Flow</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.creditsFlow}</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-header">
              <h2 className="chart-title">Active Workers</h2>
              <div className="pulse-indicator">
                <div className="pulse-dot"></div>
                <span>{stats.activeWorkers} online</span>
              </div>
            </div>
            <div>
              {workers.length > 0 ? (
                <div className="worker-list">
                  {workers.map((w, i) => (
                    <div key={i} className="worker-badge">{w}</div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No active workers</div>
              )}
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h2 className="chart-title">Recent Jobs</h2>
            </div>
            <div>
              {jobs.length > 0 ? (
                jobs.slice(-5).reverse().map((j, i) => (
                  <div key={i} className="job-item">
                    <div>
                      <div className="job-id">{j.id?.substring(0, 16)}...</div>
                      <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>{j.chunks} chunks</div>
                    </div>
                    <span className={`badge ${j.status}`}>{j.status}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">No jobs yet</div>
              )}
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h2 className="chart-title">Worker Reputation</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Type</th>
                <th>Pass Rate</th>
                <th>Reputation</th>
                <th>Canaries</th>
                <th>Chunks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {workerReputation.length > 0 ? (
                workerReputation.map((w, i) => {
                  const isFlagged = w.total_canaries >= 5 && w.canary_pass_rate < 85;
                  return (
                    <tr key={i} style={isFlagged ? { backgroundColor: 'rgba(255, 59, 48, 0.1)' } : {}}>
                      <td>{w.user_email || 'Anonymous'}</td>
                      <td><span className="badge">{w.worker_type}</span></td>
                      <td style={{ color: isFlagged ? 'var(--red)' : 'inherit' }}>
                        {w.canary_pass_rate?.toFixed(1) || '0.0'}%
                      </td>
                      <td>{w.reputation_score?.toFixed(2) || '0.00'}</td>
                      <td>{w.canaries_passed || 0}/{w.total_canaries || 0}</td>
                      <td>{w.chunks_completed || 0}</td>
                      <td>
                        <span className={`badge ${isFlagged ? 'flagged' : 'active'}`}>
                          {isFlagged ? 'Flagged' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty-state">No worker data yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h2 className="chart-title">Dead Letter Queue</h2>
            {dlqStats && (
              <span style={{ color: dlqStats.total > 0 ? 'var(--red)' : 'var(--text-dim)' }}>
                {dlqStats.total} failed jobs
              </span>
            )}
          </div>
          {dlqStats && dlqStats.total > 0 ? (
            <>
              <div style={{ marginBottom: '16px', fontSize: '0.9rem' }}>
                <div style={{ color: 'var(--text-dim)', marginBottom: '8px' }}>Failure reasons:</div>
                {Object.entries(dlqStats.byReason).map(([reason, count]: [string, any]) => (
                  <div key={reason} style={{ marginLeft: '12px' }}>
                    {reason}: {count}
                  </div>
                ))}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Reason</th>
                    <th>Attempts</th>
                    <th>Failed At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dlqJobs.map((job, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
                        {job.jobId.substring(0, 16)}...
                      </td>
                      <td>{job.reason}</td>
                      <td>{job.retriesExhausted}</td>
                      <td>{new Date(job.timestamp).toLocaleString()}</td>
                      <td>
                        <button 
                          className="btn-retry"
                          onClick={() => handleRetryJob(job.jobId)}
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty-state">No failed jobs</div>
          )}
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h2 className="chart-title">All Users</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Credits</th>
                <th>Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? (
                users.map((u, i) => (
                  <tr key={i}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role || 'none'}`}>{u.role || 'none'}</span></td>
                    <td>{u.credits || 0}</td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td><span className={`badge ${u.active ? 'active' : 'inactive'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-state">Loading...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SuperuserDashboard;
