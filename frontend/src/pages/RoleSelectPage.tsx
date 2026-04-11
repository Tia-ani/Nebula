import React from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/api';
import '../styles/RoleSelectPage.css';

const RoleSelectPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSelectRole = async (role: 'contributor' | 'developer') => {
    try {
      // Get current user data to preserve OS info
      const currentUser = JSON.parse(localStorage.getItem('nebula-user') || '{}');
      
      const response = await auth.selectRole(role);
      const data = response.data;
      
      // Preserve OS info from signup
      const updatedUser = { ...data.user, os: currentUser.os };
      localStorage.setItem('nebula-user', JSON.stringify(updatedUser));

      if (role === 'contributor') {
        navigate('/contributor-dashboard');
      } else {
        navigate('/developer-dashboard');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to select role');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nebula-token');
    localStorage.removeItem('nebula-user');
    navigate('/auth');
  };

  return (
    <div className="role-select-page">
      <div className="container">
        <div className="header">
          <div className="logo">NEBULA</div>
          <h1>Choose Your Path</h1>
          <p className="subtitle">How would you like to use Nebula?</p>
        </div>

        <div className="role-grid">
          <div className="role-card contributor">
            <div className="role-badge">Contributor</div>
            <h2 className="role-title">Earn Credits</h2>
            <p className="role-desc">Share your device's idle compute power and earn credits while you sleep.</p>

            <ul className="role-features">
              <li>Browser Worker (10 credits/task)</li>
              <li>CPU Worker with Ollama (50 credits/task)</li>
              <li>GPU Compute (100 credits/task)</li>
              <li>Cashout via UPI</li>
            </ul>

            <button className="btn-select" onClick={() => handleSelectRole('contributor')}>
              Start Earning
            </button>
          </div>

          <div className="role-card developer">
            <div className="role-badge">Developer / Researcher</div>
            <h2 className="role-title">Submit Jobs</h2>
            <p className="role-desc">Run AI inference tasks at 10× cheaper than AWS. Pay only for what you use.</p>

            <ul className="role-features">
              <li>Submit AI tasks via API</li>
              <li>Buy credits as needed</li>
              <li>Real-time job tracking</li>
              <li>Priority processing options</li>
            </ul>

            <button className="btn-select" onClick={() => handleSelectRole('developer')}>
              Start Building
            </button>
          </div>
        </div>

        <div className="logout-link">
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.9rem' }}>Logout</button>
        </div>
      </div>
    </div>
  );
};

export default RoleSelectPage;
