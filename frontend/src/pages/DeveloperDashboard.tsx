import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { developer } from '../utils/api';
import io, { Socket } from 'socket.io-client';
import '../styles/ContributorDashboard.css';
import '../styles/DeveloperDashboard.css';

const DeveloperDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    credits: 0,
    jobsSubmitted: 0,
    activeWorkers: 0,
    creditsSpent: 0,
  });
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [jobResults, setJobResults] = useState<any>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [completedJobs, setCompletedJobs] = useState<Map<string, any>>(new Map());

  const [tasksInput, setTasksInput] = useState('');
  const [priority, setPriority] = useState('normal');
  const [costEstimate, setCostEstimate] = useState({
    taskCount: 0,
    baseCost: 0,
    priorityMult: 1,
    totalCost: 0,
  });
  
  // File upload state
  const [uploadMode, setUploadMode] = useState<'manual' | 'file'>('manual');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileColumn, setFileColumn] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [uploadProgress, setUploadProgress] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('nebula-token');
    const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');

    if (!token || user.role !== 'developer') {
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

    // Listen for job completion
    newSocket.on('job-complete', (data: { jobId: string; result: any; developerEmail: string }) => {
      if (data.developerEmail === user.email) {
        // Store the completed job results
        setCompletedJobs(prev => {
          const updated = new Map(prev);
          updated.set(data.jobId, data);
          return updated;
        });
        
        setJobResults(data);
        setShowResultsModal(true);
        loadStats(); // Refresh job list
      }
    });

    return () => {
      newSocket.close();
    };
  }, [navigate]);

  useEffect(() => {
    updateCostEstimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksInput, priority]);

  const loadStats = async () => {
    try {
      const response = await developer.getStats();
      const data = response.data;
      setStats({
        credits: data.credits || 0,
        jobsSubmitted: data.jobsSubmitted || 0,
        activeWorkers: data.activeWorkers || 0,
        creditsSpent: data.creditsSpent || 0,
      });

      // Load recent jobs
      const jobsResponse = await developer.getJobs();
      setRecentJobs(jobsResponse.data.jobs || []);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const updateCostEstimate = () => {
    const tasks = tasksInput.split('\n').filter(t => t.trim());
    const taskCount = tasks.length;
    const baseCost = taskCount * 10;

    const priorityMult = {
      'normal': 1,
      'high': 1.5,
      'urgent': 2
    }[priority] || 1;

    const totalCost = Math.ceil(baseCost * priorityMult);

    setCostEstimate({
      taskCount,
      baseCost,
      priorityMult,
      totalCost,
    });
  };

  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();

    const tasks = tasksInput.split('\n').filter(t => t.trim());

    if (tasks.length === 0) {
      alert('Please enter at least one task');
      return;
    }

    try {
      await developer.submitJob({ tasks, priority });
      alert('Job submitted successfully!');
      setTasksInput('');
      loadStats();
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to submit job');
    }
  };
  
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }
    
    if (!promptTemplate.trim()) {
      alert('Please provide an instruction/prompt template');
      return;
    }
    
    setUploadProgress(true);
    
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('config', JSON.stringify({
        column: fileColumn || undefined,
        promptTemplate: promptTemplate,
        priority: priority
      }));
      
      const token = localStorage.getItem('nebula-token');
      const response = await fetch('http://localhost:3000/api/developer/upload-job', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        const errorMsg = data.error || 'Upload failed';
        const details = data.yourTemplate ? `\n\nYour template: "${data.yourTemplate}"\nExample: "${data.example}"` : '';
        throw new Error(errorMsg + details);
      }
      
      alert(`File uploaded successfully!\n\nJob ID: ${data.jobId}\nTasks: ${data.tasks}\nCost: ${data.cost} credits`);
      setSelectedFile(null);
      setFileColumn('');
      setPromptTemplate('');
      loadStats();
    } catch (error: any) {
      alert(error.message || 'Failed to upload file');
    } finally {
      setUploadProgress(false);
    }
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['.csv', '.json', '.jsonl', '.xlsx', '.xls'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (!validTypes.includes(ext)) {
        alert('Invalid file type. Please upload CSV, JSON, JSONL, or XLSX files.');
        return;
      }
      
      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert('File too large. Maximum size is 10MB.');
        return;
      }
      
      setSelectedFile(file);
    }
  };

  const handleJobClick = (job: any) => {
    if (job.status === 'complete') {
      const jobData = completedJobs.get(job.id);
      if (jobData) {
        setJobResults(jobData);
        setShowResultsModal(true);
      } else {
        alert('Job results not available. Results are only stored for jobs completed in this session.');
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nebula-token');
    localStorage.removeItem('nebula-user');
    navigate('/auth');
  };

  const user = JSON.parse(localStorage.getItem('nebula-user') || '{}');

  return (
    <div className="developer-dashboard">
      {showResultsModal && jobResults && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.9)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }} onClick={() => setShowResultsModal(false)}>
          <div style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflowY: 'auto',
            width: '100%'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ color: '#34d399', fontSize: '1.5rem' }}>Job Complete</h2>
              <button 
                onClick={() => setShowResultsModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  fontSize: '1.5rem',
                  cursor: 'pointer'
                }}
              >×</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: '#666', fontSize: '0.85rem' }}>Job ID</div>
              <div style={{ color: '#a78bfa', fontFamily: 'monospace', fontSize: '0.9rem' }}>{jobResults.jobId}</div>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#666', fontSize: '0.85rem', marginBottom: '8px' }}>Results ({jobResults.result.length} tasks processed)</div>
              <div style={{
                background: '#0a0a0a',
                border: '1px solid #222',
                borderRadius: '8px',
                padding: '16px',
                maxHeight: '500px',
                overflowY: 'auto'
              }}>
                {jobResults.result.map((item: any, idx: number) => (
                  <div key={idx} style={{ 
                    marginBottom: '16px', 
                    paddingBottom: '16px', 
                    borderBottom: idx < jobResults.result.length - 1 ? '1px solid #222' : 'none' 
                  }}>
                    <div style={{ color: '#60a5fa', fontSize: '0.8rem', marginBottom: '8px', fontWeight: 600 }}>
                      Task {idx + 1}
                    </div>
                    {typeof item === 'object' && item.input && (
                      <>
                        <div style={{ marginBottom: '8px' }}>
                          <div style={{ color: '#666', fontSize: '0.75rem', marginBottom: '4px' }}>Input:</div>
                          <div style={{ color: '#ccc', fontSize: '0.85rem', fontStyle: 'italic' }}>
                            "{item.input}"
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#666', fontSize: '0.75rem', marginBottom: '4px' }}>Result:</div>
                          <pre style={{ 
                            margin: 0, 
                            fontSize: '0.85rem', 
                            color: '#34d399',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'monospace'
                          }}>
                            {JSON.stringify(item, null, 2)}
                          </pre>
                        </div>
                      </>
                    )}
                    {typeof item === 'string' && (
                      <pre style={{ 
                        margin: 0, 
                        fontSize: '0.85rem', 
                        color: '#34d399',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}>
                        {item}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(jobResults.result, null, 2));
                alert('Results copied to clipboard!');
              }}
              style={{
                padding: '12px 24px',
                background: '#a78bfa',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: 500,
                marginRight: '12px'
              }}
            >
              Copy Results
            </button>
            <button 
              onClick={() => setShowResultsModal(false)}
              style={{
                padding: '12px 24px',
                background: '#333',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: 500
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="container">
        <div className="nav">
          <div className="logo">NEBULA</div>
          <div className="user-info">
            <span className="user-name">{user.name} ({user.email})</span>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="welcome">
          <h1>Developer Dashboard</h1>
          <p>Submit AI tasks and track your jobs</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div className="stat-label">Available Credits</div>
            <div className="stat-value">{stats.credits}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div className="stat-label">Jobs Submitted</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.jobsSubmitted}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="stat-label">Active Workers</div>
            <div className="stat-value" style={{ color: 'var(--yellow)' }}>{stats.activeWorkers}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="stat-label">Credits Spent</div>
            <div className="stat-value" style={{ color: 'var(--text-dim)' }}>{stats.creditsSpent}</div>
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">Submit New Job</h2>
          
          {/* Mode Toggle */}
          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            marginBottom: '24px',
            borderBottom: '1px solid #222',
            paddingBottom: '12px'
          }}>
            <button
              type="button"
              onClick={() => setUploadMode('manual')}
              style={{
                padding: '8px 16px',
                background: uploadMode === 'manual' ? '#a78bfa' : 'transparent',
                color: uploadMode === 'manual' ? 'white' : '#666',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 500
              }}
            >
              Manual Input
            </button>
            <button
              type="button"
              onClick={() => setUploadMode('file')}
              style={{
                padding: '8px 16px',
                background: uploadMode === 'file' ? '#a78bfa' : 'transparent',
                color: uploadMode === 'file' ? 'white' : '#666',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 500
              }}
            >
              📁 Upload File
            </button>
          </div>

          {uploadMode === 'manual' ? (
            <form onSubmit={handleSubmitJob}>
              <div className="form-group">
                <label>Tasks (one per line)</label>
                <textarea
                  value={tasksInput}
                  onChange={(e) => setTasksInput(e.target.value)}
                  placeholder="Classify: This product is amazing!&#10;Summarize: AI is transforming...&#10;Translate: Hello world to Spanish"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="normal">Normal (1x cost)</option>
                    <option value="high">High (1.5x cost)</option>
                    <option value="urgent">Urgent (2x cost)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Estimated Completion</label>
                  <input type="text" value="~2-5 minutes" readOnly style={{ color: 'var(--text-dim)' }} />
                </div>
              </div>

              <div className="cost-estimate">
                <h4>Cost Estimate</h4>
                <div className="cost-line">
                  <span>Tasks:</span>
                  <span>{costEstimate.taskCount}</span>
                </div>
                <div className="cost-line">
                  <span>Base cost:</span>
                  <span>{costEstimate.baseCost} credits</span>
                </div>
                <div className="cost-line">
                  <span>Priority multiplier:</span>
                  <span>{costEstimate.priorityMult}x</span>
                </div>
                <div className="cost-line total">
                  <span>Total:</span>
                  <span>{costEstimate.totalCost} credits</span>
                </div>
              </div>

              <button type="submit" className="btn-primary" style={{ marginTop: '24px' }}>Submit Job</button>
            </form>
          ) : (
            <form onSubmit={handleFileUpload}>
              <div style={{
                border: '2px dashed #333',
                borderRadius: '12px',
                padding: '32px',
                textAlign: 'center',
                marginBottom: '24px',
                background: selectedFile ? '#0a0a0a' : 'transparent'
              }}>
                {!selectedFile ? (
                  <>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📁</div>
                    <div style={{ color: '#ccc', marginBottom: '8px', fontSize: '1.1rem' }}>
                      Upload CSV, JSON, JSONL, or XLSX
                    </div>
                    <div style={{ color: '#666', fontSize: '0.85rem', marginBottom: '16px' }}>
                      Maximum file size: 10MB
                    </div>
                    <input
                      type="file"
                      accept=".csv,.json,.jsonl,.xlsx,.xls"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                      id="file-upload"
                    />
                    <label htmlFor="file-upload" style={{
                      display: 'inline-block',
                      padding: '12px 24px',
                      background: '#a78bfa',
                      color: 'white',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 500
                    }}>
                      Choose File
                    </label>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✓</div>
                    <div style={{ color: '#34d399', marginBottom: '8px', fontSize: '1.1rem', fontWeight: 500 }}>
                      {selectedFile.name}
                    </div>
                    <div style={{ color: '#666', fontSize: '0.85rem', marginBottom: '16px' }}>
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      style={{
                        padding: '8px 16px',
                        background: '#333',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.85rem'
                      }}
                    >
                      Remove File
                    </button>
                  </>
                )}
              </div>

              {selectedFile && (
                <>
                  <div className="form-group">
                    <label>Instruction / Prompt Template *</label>
                    <textarea
                      value={promptTemplate}
                      onChange={(e) => setPromptTemplate(e.target.value)}
                      placeholder="Classify the sentiment of this review as positive, negative, or neutral: {text}&#10;&#10;⚠️ Must include {text} or {column_name} placeholder!"
                      required
                      rows={4}
                      style={{
                        borderColor: promptTemplate && !promptTemplate.includes('{') ? '#ef4444' : undefined
                      }}
                    />
                    <div style={{ 
                      color: promptTemplate && !promptTemplate.includes('{') ? '#ef4444' : '#666', 
                      fontSize: '0.8rem', 
                      marginTop: '8px',
                      fontWeight: promptTemplate && !promptTemplate.includes('{') ? 600 : 400
                    }}>
                      {promptTemplate && !promptTemplate.includes('{') ? (
                        <>⚠️ Missing placeholder! Use {'{text}'} or {'{review_text}'}</>
                      ) : (
                        <>
                          <strong>Examples:</strong><br/>
                          • "Classify sentiment: {'{text}'}"<br/>
                          • "Translate to Spanish: {'{text}'}"<br/>
                          • "Summarize in 10 words: {'{text}'}"<br/>
                          • "Is this spam? Answer yes or no: {'{text}'}"
                        </>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Column Name (optional)</label>
                    <input
                      type="text"
                      value={fileColumn}
                      onChange={(e) => setFileColumn(e.target.value)}
                      placeholder="Leave empty to use first column"
                    />
                    <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '4px' }}>
                      For CSV/XLSX: column name. For JSON: key name. Use this name in your prompt template with {'{column_name}'}.
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Priority</label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                      <option value="normal">Normal (1x cost)</option>
                      <option value="high">High (1.5x cost)</option>
                      <option value="urgent">Urgent (2x cost)</option>
                    </select>
                  </div>

                  <button 
                    type="submit" 
                    className="btn-primary" 
                    style={{ marginTop: '24px' }}
                    disabled={uploadProgress}
                  >
                    {uploadProgress ? 'Uploading...' : 'Upload & Submit Job'}
                  </button>
                </>
              )}
            </form>
          )}
        </div>

        <div className="section">
          <h2 className="section-title">Recent Jobs</h2>
          <div className="job-list">
            {recentJobs.length > 0 ? (
              recentJobs.map((job, i) => (
                <div 
                  key={i} 
                  className="job-item"
                  onClick={() => handleJobClick(job)}
                  style={{ cursor: job.status === 'complete' ? 'pointer' : 'default' }}
                >
                  <div className="job-info">
                    <div className="job-id">{job.id}</div>
                    <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>{job.chunks} chunks</div>
                  </div>
                  <span className={`job-status ${job.status}`}>
                    {job.status === 'complete' ? 'complete (click to view)' : job.status}
                  </span>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No jobs yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeveloperDashboard;
