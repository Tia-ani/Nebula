import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './styles/global.css';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import RoleSelectPage from './pages/RoleSelectPage';
import ContributorDashboard from './pages/ContributorDashboard';
import DeveloperDashboard from './pages/DeveloperDashboard';
import SuperuserDashboard from './pages/SuperuserDashboard';

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/role-select" element={<RoleSelectPage />} />
        <Route path="/contributor-dashboard" element={<ContributorDashboard />} />
        <Route path="/developer-dashboard" element={<DeveloperDashboard />} />
        <Route path="/superuser-dashboard" element={<SuperuserDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
