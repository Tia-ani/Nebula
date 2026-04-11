import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/api';
import '../styles/ProfilePage.css';

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('nebula-token');
    const userData = JSON.parse(localStorage.getItem('nebula-user') || '{}');

    if (!token) {
      navigate('/auth');
      return;
    }

    setUser(userData);
  }, [navigate]);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      alert('Please type DELETE to confirm');
      return;
    }

    try {
      await auth.deleteAccount();
      localStorage.removeItem('nebula-token');
      localStorage.removeItem('nebula-user');
      alert('Account deleted successfully');
      navigate('/');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete account');
    }
  };

  const handleBack = () => {
    const role = user?.role;
    if (role === 'contributor') navigate('/contributor-dashboard');
    else if (role === 'developer') navigate('/developer-dashboard');
    else if (role === 'superuser') navigate('/superuser-dashboard');
    else navigate('/');
  };

  if (!user) return null;

  return (
    <div className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <button className="btn-back" onClick={handleBack}>← Back to Dashboard</button>
          <h1>Profile Settings</h1>
        </div>

        <div className="profile-section">
          <h2>Account Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <label>Name</label>
              <div className="info-value">{user.name}</div>
            </div>
            <div className="info-item">
              <label>Email</label>
              <div className="info-value">{user.email}</div>
            </div>
            <div className="info-item">
              <label>Role</label>
              <div className="info-value">
                <span className={`badge ${user.role}`}>{user.role}</span>
              </div>
            </div>
            <div className="info-item">
              <label>Credits</label>
              <div className="info-value">{user.credits || 0}</div>
            </div>
            <div className="info-item">
              <label>Operating System</label>
              <div className="info-value">{user.os || 'Not set'}</div>
            </div>
          </div>
        </div>

        <div className="profile-section danger-zone">
          <h2>Danger Zone</h2>
          <p className="warning-text">
            Once you delete your account, there is no going back. This will permanently delete your account, credits, and all associated data.
          </p>

          {!showDeleteConfirm ? (
            <button 
              className="btn-danger" 
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Account
            </button>
          ) : (
            <div className="delete-confirm">
              <p>Type <strong>DELETE</strong> to confirm:</p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="delete-input"
              />
              <div className="delete-actions">
                <button 
                  className="btn-cancel" 
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="btn-danger" 
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== 'DELETE'}
                >
                  Permanently Delete Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
