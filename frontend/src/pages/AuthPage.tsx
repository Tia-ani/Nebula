import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/api';
import '../styles/AuthPage.css';

const AuthPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup form state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await auth.login({ email: loginEmail, password: loginPassword });
      const data = response.data;
      localStorage.setItem('nebula-token', data.token);
      localStorage.setItem('nebula-user', JSON.stringify(data.user));

      if (data.user.role) {
        navigate(getDashboardUrl(data.user.role));
      } else {
        navigate('/role-select');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await auth.signup({ name: signupName, email: signupEmail, password: signupPassword });
      const data = response.data;
      localStorage.setItem('nebula-token', data.token);
      localStorage.setItem('nebula-user', JSON.stringify(data.user));
      navigate('/role-select');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Signup failed');
    }
  };

  const getDashboardUrl = (role: string) => {
    switch (role) {
      case 'contributor': return '/contributor-dashboard';
      case 'developer': return '/developer-dashboard';
      case 'superuser': return '/superuser-dashboard';
      default: return '/role-select';
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="logo">NEBULA</div>
        <div className="subtitle">Distributed Compute Network</div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => { setActiveTab('login'); setError(''); }}
          >
            Login
          </button>
          <button
            className={`tab ${activeTab === 'signup' ? 'active' : ''}`}
            onClick={() => { setActiveTab('signup'); setError(''); }}
          >
            Sign Up
          </button>
        </div>

        {error && <div className="error-msg show">{error}</div>}

        {activeTab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary">Login</button>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn-primary">Create Account</button>
          </form>
        )}

        <div className="form-footer">
          <a href="/">← Back to home</a>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
