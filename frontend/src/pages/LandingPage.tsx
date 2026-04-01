import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/LandingPage.css';

const LandingPage: React.FC = () => {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Background nebula animation
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;

    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) return;

    let BW: number, BH: number;
    let bgNodes: any[] = [];
    let ringAngle = 0;
    let animationId: number;

    const bgResize = () => {
      BW = bgCanvas.width = window.innerWidth;
      BH = bgCanvas.height = window.innerHeight;
    };

    const makeBgNode = () => ({
      x: Math.random() * BW,
      y: Math.random() * BH,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: Math.random() * 1.8 + 0.6,
      phase: Math.random() * Math.PI * 2,
      isMaster: Math.random() > 0.88,
    });

    const initBg = () => {
      const count = Math.min(Math.floor((BW * BH) / 14000), 80);
      bgNodes = Array.from({ length: count }, makeBgNode);
    };

    const drawBg = () => {
      bgCtx.clearRect(0, 0, BW, BH);

      ringAngle += 0.0003;
      const cx = BW * 0.5 + Math.sin(ringAngle) * BW * 0.08;
      const cy = BH * 0.42 + Math.cos(ringAngle * 0.7) * BH * 0.06;
      const gr = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(BW, BH) * 0.55);
      gr.addColorStop(0, 'rgba(109,90,255,0.055)');
      gr.addColorStop(0.4, 'rgba(109,90,255,0.025)');
      gr.addColorStop(1, 'transparent');
      bgCtx.fillStyle = gr;
      bgCtx.fillRect(0, 0, BW, BH);

      const cx2 = BW * 0.75 + Math.cos(ringAngle * 1.3) * BW * 0.06;
      const cy2 = BH * 0.65 + Math.sin(ringAngle * 0.9) * BH * 0.04;
      const gr2 = bgCtx.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(BW, BH) * 0.35);
      gr2.addColorStop(0, 'rgba(0,229,160,0.03)');
      gr2.addColorStop(1, 'transparent');
      bgCtx.fillStyle = gr2;
      bgCtx.fillRect(0, 0, BW, BH);

      bgNodes.forEach(n => {
        n.x += n.vx;
        n.y += n.vy;
        n.phase += 0.012;
        if (n.x < 0) { n.x = 0; n.vx *= -1; }
        if (n.x > BW) { n.x = BW; n.vx *= -1; }
        if (n.y < 0) { n.y = 0; n.vy *= -1; }
        if (n.y > BH) { n.y = BH; n.vy *= -1; }
      });

      const DIST = 160;
      for (let i = 0; i < bgNodes.length; i++) {
        for (let j = i + 1; j < bgNodes.length; j++) {
          const dx = bgNodes[i].x - bgNodes[j].x;
          const dy = bgNodes[i].y - bgNodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < DIST) {
            const alpha = (1 - d / DIST) * 0.12;
            bgCtx.strokeStyle = `rgba(109,90,255,${alpha})`;
            bgCtx.lineWidth = 0.5;
            bgCtx.beginPath();
            bgCtx.moveTo(bgNodes[i].x, bgNodes[i].y);
            bgCtx.lineTo(bgNodes[j].x, bgNodes[j].y);
            bgCtx.stroke();
          }
        }
      }

      bgNodes.forEach(n => {
        const pulse = (Math.sin(n.phase) + 1) * 0.5;
        if (n.isMaster) {
          const halo = bgCtx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 10);
          halo.addColorStop(0, `rgba(109,90,255,${0.2 * pulse})`);
          halo.addColorStop(1, 'transparent');
          bgCtx.fillStyle = halo;
          bgCtx.beginPath();
          bgCtx.arc(n.x, n.y, 10, 0, Math.PI * 2);
          bgCtx.fill();
          bgCtx.fillStyle = `rgba(109,90,255,${0.7 + 0.3 * pulse})`;
          bgCtx.beginPath();
          bgCtx.arc(n.x, n.y, n.r + 0.8, 0, Math.PI * 2);
          bgCtx.fill();
        } else {
          bgCtx.fillStyle = `rgba(109,90,255,${0.3 + 0.2 * pulse})`;
          bgCtx.beginPath();
          bgCtx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          bgCtx.fill();
        }
      });

      animationId = requestAnimationFrame(drawBg);
    };

    bgResize();
    initBg();
    drawBg();

    const handleResize = () => {
      bgResize();
      initBg();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  useEffect(() => {
    // Scene canvas animation
    const sc = sceneCanvasRef.current;
    if (!sc) return;

    const scx = sc.getContext('2d');
    if (!scx) return;

    const SW = 170, SH = 126;

    const scNodes = [
      { x: 85, y: 63, type: 'master' },
      { x: 28, y: 22, type: 'w' },
      { x: 142, y: 22, type: 'w' },
      { x: 16, y: 94, type: 'w' },
      { x: 154, y: 94, type: 'w' },
      { x: 85, y: 10, type: 'w' },
      { x: 85, y: 116, type: 'w' },
    ];

    const scPkts = scNodes.slice(1).map((n, i) => ({
      from: 0,
      to: i + 1,
      t: (i / scNodes.length) * 0.9,
      spd: 0.007 + Math.random() * 0.005,
      col: i % 2 === 0 ? '#6d5aff' : '#00e5a0',
    }));

    const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

    let animationId: number;

    const drawSc = () => {
      scx.clearRect(0, 0, SW, SH);

      scNodes.slice(1).forEach(n => {
        scx.strokeStyle = 'rgba(109,90,255,0.2)';
        scx.lineWidth = 0.8;
        scx.beginPath();
        scx.moveTo(scNodes[0].x, scNodes[0].y);
        scx.lineTo(n.x, n.y);
        scx.stroke();
      });

      scPkts.forEach(p => {
        p.t += p.spd;
        if (p.t > 1) p.t = 0;
        const b = p.t < 0.5 ? p.t * 2 : (1 - p.t) * 2;
        const fx = scNodes[p.from].x, fy = scNodes[p.from].y;
        const tx = scNodes[p.to].x, ty = scNodes[p.to].y;
        scx.beginPath();
        scx.arc(lerpN(fx, tx, b), lerpN(fy, ty, b), 3, 0, Math.PI * 2);
        scx.fillStyle = p.col;
        scx.shadowColor = p.col;
        scx.shadowBlur = 7;
        scx.fill();
        scx.shadowBlur = 0;
      });

      scNodes.forEach(n => {
        if (n.type === 'master') {
          const g = scx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 18);
          g.addColorStop(0, 'rgba(109,90,255,0.3)');
          g.addColorStop(1, 'transparent');
          scx.fillStyle = g;
          scx.beginPath();
          scx.arc(n.x, n.y, 18, 0, Math.PI * 2);
          scx.fill();
          scx.fillStyle = '#6d5aff';
          scx.beginPath();
          scx.arc(n.x, n.y, 5.5, 0, Math.PI * 2);
          scx.fill();
        } else {
          scx.fillStyle = '#111120';
          scx.beginPath();
          scx.arc(n.x, n.y, 4, 0, Math.PI * 2);
          scx.fill();
          scx.strokeStyle = 'rgba(109,90,255,0.55)';
          scx.lineWidth = 1;
          scx.stroke();
        }
      });

      animationId = requestAnimationFrame(drawSc);
    };

    drawSc();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  useEffect(() => {
    // Live stats
    const fetchStats = async () => {
      try {
        const r = await fetch('/api/v1/status');
        const d = await r.json();
        countUp('lw', d.workers);
        countUp('lj', d.jobsCompleted);
        countUp('lt', d.tasksProcessed);
      } catch (e) {}
    };

    const countUp = (id: string, target: number) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cur = parseInt(el.textContent || '0') || 0;
      if (cur === target) {
        el.textContent = String(target);
        return;
      }
      const step = Math.max(1, Math.ceil(Math.abs(target - cur) / 18));
      const dir = target > cur ? 1 : -1;
      let v = cur;
      const iv = setInterval(() => {
        v += dir * step;
        if ((dir > 0 && v >= target) || (dir < 0 && v <= target)) {
          v = target;
          clearInterval(iv);
        }
        el.textContent = String(v);
      }, 28);
    };

    fetchStats();
    const interval = setInterval(fetchStats, 9000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Scroll reveal
    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08 }
    );

    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

    return () => obs.disconnect();
  }, []);

  const copyToClipboard = (text: string, btn: HTMLButtonElement) => {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'copied!';
      setTimeout(() => (btn.textContent = 'copy'), 2000);
      const toast = document.getElementById('toast');
      if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
      }
    });
  };

  return (
    <>
      <canvas id="bg-canvas" ref={bgCanvasRef}></canvas>

      <div className="page">
        <nav>
          <a href="/" className="nav-logo">
            <svg className="nav-logo-icon" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="3.5" fill="#6d5aff" />
              <circle cx="14" cy="14" r="6" stroke="#6d5aff" strokeWidth=".8" strokeOpacity=".4" />
              <circle cx="14" cy="14" r="9.5" stroke="#6d5aff" strokeWidth=".6" strokeOpacity=".2" />
              <line x1="14" y1="4" x2="14" y2="0.5" stroke="#6d5aff" strokeWidth=".8" strokeOpacity=".5" />
              <line x1="14" y1="27.5" x2="14" y2="24" stroke="#6d5aff" strokeWidth=".8" strokeOpacity=".5" />
              <line x1="4" y1="14" x2="0.5" y2="14" stroke="#6d5aff" strokeWidth=".8" strokeOpacity=".5" />
              <line x1="27.5" y1="14" x2="24" y2="14" stroke="#6d5aff" strokeWidth=".8" strokeOpacity=".5" />
            </svg>
            NEBULA
            <span className="nav-tag">ALPHA</span>
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#devs">Developers</a>
            <a href="https://github.com/Tia-ani/Nebula" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="/auth" className="nav-cta">
              Login / Sign Up
            </a>
          </div>
        </nav>

        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <div className="hero">
            <div className="eyebrow">
              <div className="eyebrow-dot"></div>
              <span className="eyebrow-text">Distributed Compute Network · Live</span>
            </div>
            <h1>
              Every idle device
              <br />
              is a <em>supercomputer</em>
              <span className="muted">waiting to be switched on.</span>
            </h1>
            <p className="hero-sub">
              Nebula turns <strong>phones, laptops, idle machines</strong> into a shared AI compute network. Run
              inference at <strong>10× cheaper than AWS</strong> — or contribute your device and earn credits while you
              sleep.
            </p>
            <div className="hero-btns">
              <a href="/auth" className="btn-main">
                Get Started
              </a>
              <a href="#how" className="btn-ghost">
                See how it works
              </a>
            </div>
          </div>
        </div>

        <div className="live-strip">
          <div className="live-seg">
            <span className="live-val" id="lw">
              —
            </span>
            <span className="live-label">Workers online now</span>
          </div>
          <div className="live-seg">
            <span className="live-val" id="lj">
              —
            </span>
            <span className="live-label">Jobs completed</span>
          </div>
          <div className="live-seg">
            <span className="live-val" id="lt">
              —
            </span>
            <span className="live-label">Tasks processed</span>
          </div>
          <div className="live-seg">
            <span className="live-val" style={{ color: 'var(--text-dim)', fontSize: '1.5rem', marginTop: '4px' }}>
              10×
            </span>
            <span className="live-label">Cheaper than AWS</span>
          </div>
        </div>

        <div className="sec" id="how">
          <div className="sec-tag reveal">How it works</div>
          <h2 className="sec-h reveal">
            The full Nebula flow,
            <br />
            animated live.
          </h2>
          <p className="sec-sub reveal">
            One job. Many machines. Zero coordination overhead. Watch the packets move.
          </p>

          <div className="nebula-scene reveal">
            <div className="scene-header">// nebula distributed network — live simulation</div>

            <div className="scene-row">
              <div className="actor">
                <div className="laptop-wrap">
                  <svg width="112" height="80" viewBox="0 0 112 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="10" y="4" width="92" height="58" rx="5" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1.5" />
                    <rect x="18" y="12" width="26" height="3.5" rx="1.5" fill="#6d5aff" opacity=".65" />
                    <rect x="47" y="12" width="42" height="3.5" rx="1.5" fill="#1a1a2e" />
                    <rect x="18" y="20" width="58" height="3" rx="1.5" fill="#1a1a2e" />
                    <rect x="18" y="28" width="40" height="3" rx="1.5" fill="#1a1a2e" />
                    <rect x="18" y="36" width="50" height="3" rx="1.5" fill="#1a1a2e" />
                    <rect x="18" y="44" width="32" height="3" rx="1.5" fill="#1a1a2e" />
                    <circle cx="90" cy="14" r="5" fill="#6d5aff">
                      <animate attributeName="opacity" values=".9;.3;.9" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="r" values="4;5.5;4" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <rect x="2" y="62" width="108" height="7" rx="3" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1.5" />
                    <rect x="34" y="69" width="44" height="5" rx="2" fill="#06060f" stroke="#1a1a2e" strokeWidth="1" />
                  </svg>
                </div>
                <div className="actor-name">Contributor</div>
                <div className="actor-sub">
                  Idle laptop.
                  <br />
                  One command to join.
                </div>
                <div className="credits">
                  <div className="credit-line">+ 1 credit earned</div>
                  <div className="credit-line">+ 1 credit earned</div>
                  <div className="credit-line">+ 3 credits earned</div>
                </div>
              </div>

              <div className="arrow-channel">
                <div className="arrow-label">chunk out</div>
                <div className="pipe w90">
                  <div className="pkt"></div>
                  <div className="pkt d1"></div>
                </div>
                <div className="arrow-label" style={{ marginTop: '18px' }}>
                  result in
                </div>
                <div className="pipe w90">
                  <div className="pkt rev green"></div>
                </div>
              </div>

              <div className="net-cluster">
                <div className="net-label">Nebula Network</div>
                <canvas id="sc" ref={sceneCanvasRef} width="170" height="126"></canvas>
                <div className="net-meta">
                  Master node
                  <br />
                  AES-256 · Fault tolerant
                </div>
              </div>

              <div className="arrow-channel">
                <div className="arrow-label">tasks in</div>
                <div className="pipe w90">
                  <div className="pkt rev d2"></div>
                </div>
                <div className="arrow-label" style={{ marginTop: '18px' }}>
                  results out
                </div>
                <div className="pipe w90">
                  <div className="pkt green d1"></div>
                </div>
              </div>

              <div className="actor">
                <svg width="112" height="80" viewBox="0 0 112 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="18" y="2" width="76" height="54" rx="4" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1.5" />
                  <rect x="26" y="10" width="24" height="3.5" rx="1.5" fill="#6d5aff" opacity=".7" />
                  <rect x="52" y="10" width="34" height="3.5" rx="1.5" fill="#1a1a2e" />
                  <rect x="26" y="18" width="46" height="3" rx="1.5" fill="#ffd166" opacity=".45" />
                  <rect x="26" y="26" width="32" height="3" rx="1.5" fill="#1a1a2e" />
                  <rect x="26" y="34" width="50" height="3.5" rx="1.5" fill="#1a1a2e" />
                  <rect x="26" y="34" width="50" height="3.5" rx="1.5" fill="#00e5a0" opacity="0">
                    <animate attributeName="opacity" values="0;0;0;.85;.85;0" dur="3s" begin="1.8s" repeatCount="indefinite" />
                  </rect>
                  <rect x="26" y="43" width="24" height="3" rx="1.5" fill="#1a1a2e" />
                  <rect x="48" y="56" width="16" height="7" rx="2" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1" />
                  <rect x="32" y="63" width="48" height="5" rx="2" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1" />
                  <circle cx="56" cy="75" r="5" fill="#111120" />
                  <path d="M43 80 Q56 67 69 80" fill="#0c0c18" stroke="#1a1a2e" strokeWidth="1" />
                </svg>
                <div className="actor-name">Developer</div>
                <div className="actor-sub">
                  REST API or SDK.
                  <br />
                  Three lines of code.
                </div>
                <div className="result-flash">
                  <span className="kw">await</span> nebula.run([...])
                  <br />
                  <span className="res">{'// [\'Positive.\', \'Neg...\']'}</span>
                </div>
              </div>
            </div>

            <div className="steps-row">
              <div className="step">
                <div className="step-n">01 — SUBMIT</div>
                <div className="step-t">Developer sends tasks</div>
                <div className="step-d">Array of prompts via API. Each becomes a separate encrypted chunk.</div>
              </div>
              <div className="step">
                <div className="step-n">02 — ENCRYPT</div>
                <div className="step-t">AES-256 per session</div>
                <div className="step-d">Master creates a unique key per worker. Destroyed on disconnect.</div>
              </div>
              <div className="step">
                <div className="step-n">03 — DISTRIBUTE</div>
                <div className="step-t">Chunks fan out</div>
                <div className="step-d">Idle devices process in parallel. Worker dies — chunk auto-reassigns.</div>
              </div>
              <div className="step">
                <div className="step-n">04 — RETURN</div>
                <div className="step-t">Results assembled</div>
                <div className="step-d">Back to developer in order. Contributor earns credits per task.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="sec" id="devs" style={{ paddingTop: 0 }}>
          <div className="sec-tag reveal">Who it's for</div>
          <h2 className="sec-h reveal">Two sides. One network.</h2>
          <p className="sec-sub reveal">
            Developers get cheap AI inference. Contributors earn from idle hardware. Nebula connects both.
          </p>

          <div className="who-grid reveal">
            <div className="who-card">
              <div className="who-role">For Developers</div>
              <div className="who-title">
                Submit jobs.
                <br />
                Pay per task.
              </div>
              <div className="who-desc">
                Sentiment analysis, summarisation, classification — anything Ollama handles. No GPU, no DevOps, no AWS
                bill shock.
              </div>
              <div className="code-box">
                <button
                  className="copy-btn"
                  onClick={(e) =>
                    copyToClipboard(
                      `const nebula = require('nebula-compute');\nconst res = await nebula.run([\n  'Classify: loved this!',\n  'Summarise: AI is...',\n]);\nconsole.log(res);`,
                      e.currentTarget
                    )
                  }
                >
                  copy
                </button>
                <span className="cm">{'// npm install nebula-compute'}</span>
                <br />
                <span className="kw">const</span> nebula = <span className="fn">require</span>(
                <span className="str">'nebula-compute'</span>);
                <br />
                <span className="kw">const</span> res = <span className="kw">await</span> nebula.
                <span className="fn">run</span>([<br />
                &nbsp;&nbsp;<span className="str">'Classify: loved this!'</span>,<br />
                &nbsp;&nbsp;<span className="str">'Summarise: AI is...'</span>,<br />
                ]);
                <br />
                <span className="cm">{'// '}</span>
                <span className="ok">['Positive.', 'AI is...']</span>
              </div>
            </div>

            <div className="who-card right">
              <div className="who-role">For Contributors</div>
              <div className="who-title">
                Share compute.
                <br />
                Earn credits.
              </div>
              <div className="who-desc">
                Your laptop sits idle 18 hours a day. One command joins the network. Processes chunks silently. Credits
                per task, UPI cashout coming.
              </div>
              <div className="code-box">
                <button
                  className="copy-btn"
                  onClick={(e) =>
                    copyToClipboard(
                      'npx nebula-worker start --master https://nebula-mk65.onrender.com',
                      e.currentTarget
                    )
                  }
                >
                  copy
                </button>
                <span className="cm"># needs Ollama + llama3.2</span>
                <br />
                <br />
                <span className="kw">$</span> npx nebula-worker start \<br />
                &nbsp; --master <span className="str">https://nebula-mk65.onrender.com</span>
                <br />
                <br />
                <span className="ok">Connected (id: a3f1...)</span>
                <br />
                <span className="ok">Waiting for work...</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sec" style={{ paddingTop: 0 }}>
          <div className="sec-tag reveal">Why Nebula</div>
          <h2 className="sec-h reveal">Built different.</h2>
          <p className="sec-sub reveal">
            Not another OpenAI wrapper. Actually distributed. Actually cheap. Actually yours.
          </p>

          <div className="why-grid reveal">
            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 3 L18 33M3 18 L33 18" strokeLinecap="round" />
                  <circle cx="18" cy="18" r="6" />
                  <circle cx="18" cy="18" r="13" strokeOpacity=".3" />
                </svg>
              </div>
              <div className="why-t">10× cheaper</div>
              <div className="why-d">
                Idle compute costs nothing. <span className="hl">We pass that to developers.</span> Fraction of AWS
                price, always.
              </div>
            </div>

            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="8" y="14" width="20" height="16" rx="3" />
                  <path d="M12 14V10a6 6 0 0 1 12 0v4" strokeLinecap="round" />
                  <circle cx="18" cy="22" r="2" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div className="why-t">Per-session encryption</div>
              <div className="why-d">
                AES-256 key per worker, destroyed on disconnect.{' '}
                <span className="hl">Compromise one node — zero exposure.</span>
              </div>
            </div>

            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 18 A12 12 0 1 1 18 30" strokeLinecap="round" />
                  <path d="M6 18 L2 14 M6 18 L10 14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="why-t">Fault tolerant</div>
              <div className="why-d">
                Worker dies mid-job? <span className="hl">Chunk auto-reassigns</span> to the next available node. Jobs
                always complete.
              </div>
            </div>

            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="8" width="12" height="8" rx="2" />
                  <rect x="20" y="8" width="12" height="8" rx="2" />
                  <rect x="12" y="22" width="12" height="8" rx="2" />
                  <line x1="10" y1="16" x2="18" y2="22" />
                  <line x1="26" y1="16" x2="18" y2="22" />
                </svg>
              </div>
              <div className="why-t">Any device</div>
              <div className="why-d">
                Node worker for heavy AI. Browser worker coming —{' '}
                <span className="hl">open a URL and contribute.</span>
              </div>
            </div>

            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="4" width="28" height="20" rx="3" />
                  <path d="M12 10 L18 16 L24 10" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="4" y1="28" x2="32" y2="28" strokeLinecap="round" />
                  <line x1="14" y1="28" x2="14" y2="32" strokeLinecap="round" />
                  <line x1="22" y1="28" x2="22" y2="32" strokeLinecap="round" />
                </svg>
              </div>
              <div className="why-t">Three lines of code</div>
              <div className="why-d">
                SDK hides all complexity. Chunking, encryption, fault tolerance —{' '}
                <span className="hl">invisible to the developer.</span>
              </div>
            </div>

            <div className="why-card">
              <div className="why-icon">
                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="18" cy="18" r="13" />
                  <path d="M18 5 C14 10 14 26 18 31 M18 5 C22 10 22 26 18 31" strokeLinecap="round" />
                  <line x1="5" y1="18" x2="31" y2="18" />
                  <path d="M6 12 Q18 15 30 12 M6 24 Q18 21 30 24" strokeLinecap="round" />
                </svg>
              </div>
              <div className="why-t">Built for India first</div>
              <div className="why-d">
                Targeting Indian AI startups and researchers. <span className="hl">UPI cashout</span> for contributors
                on the roadmap.
              </div>
            </div>
          </div>
        </div>

        <div className="cta-wrap">
          <div className="sec-tag">Get started</div>
          <h2 className="sec-h">
            The network is live.
            <br />
            Your device isn't on it yet.
          </h2>
          <p className="sec-sub">Try a real job in 30 seconds. No account. No credit card.</p>
          <div className="cta-btns">
            <a href="/demo" className="btn-main">
              Try it live
            </a>
            <a href="https://github.com/Tia-ani/Nebula" target="_blank" rel="noreferrer" className="btn-ghost">
              View source
            </a>
          </div>
        </div>

        <footer>
          <span>
            Nebula — built by{' '}
            <a href="https://www.linkedin.com/in/anishka-khurana-9aa245324/" target="_blank" rel="noreferrer">
              Anishka Khurana
            </a>
          </span>
          <div className="footer-links">
            <a href="/demo">Demo</a>
            <a href="/dashboard">Dashboard</a>
            <a href="https://github.com/Tia-ani/Nebula" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://www.npmjs.com/package/nebula-worker" target="_blank" rel="noreferrer">
              npm
            </a>
          </div>
        </footer>
      </div>

      <div className="toast" id="toast">
        Copied!
      </div>
    </>
  );
};

export default LandingPage;
