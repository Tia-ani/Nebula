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
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nebula-token');
    localStorage.removeItem('nebula-user');
    navigate('/auth');
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
