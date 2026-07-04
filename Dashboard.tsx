import { useState, useEffect } from 'react';
import type { CampaignState } from '../App';

interface DashboardProps {
  campaign: CampaignState;
  updateCampaign: (fields: Partial<CampaignState>) => void;
  fetchCampaign: () => void;
}

interface ScenarioPoint {
  day: number;
  amount: number;
}

interface PredictionData {
  predictedFinal: number;
  velocityStatus: string;
  dailyVelocity: number;
  projectedBackers: number;
  riskScore: number;
  riskLevel: string;
  probSuccess: number;
  factors: string[];
  recs: string[];
  scenarios: {
    pessimistic: ScenarioPoint[];
    expected: ScenarioPoint[];
    optimistic: ScenarioPoint[];
  };
}

export default function Dashboard({ campaign, updateCampaign, fetchCampaign }: DashboardProps) {
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<PredictionData | null>(null);

  const handleSimulatePledge = async (price: number) => {
    try {
      const res = await fetch(`http://localhost:5001/api/campaigns/${campaign._id}/pledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price })
      });
      const data = await res.json();
      if (data.success) {
        fetchCampaign();
      }
    } catch (error) {
      console.error("Failed to submit pledge to MongoDB:", error);
      const currentVal = campaign.backerCounts.length > 0 ? campaign.backerCounts[campaign.backerCounts.length - 1] : 0;
      updateCampaign({
        currentFunding: campaign.currentFunding + price,
        backerCounts: campaign.backerCounts.length === 0
          ? [1]
          : [...campaign.backerCounts.slice(0, -1), currentVal + 1]
      });
    }
  };

  // Run analytical calculations (either call backend or local mathematical model)
  const fetchPredictions = async () => {
    setLoading(true);
    try {
      // Try calling Node API which proxies to Python
      const [velRes, riskRes] = await Promise.all([
        fetch('http://localhost:5001/api/analytics/velocity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: campaign.goal,
            current_funding: campaign.currentFunding,
            elapsed_days: campaign.elapsedDays,
            total_days: campaign.duration,
            backer_counts: campaign.backerCounts,
            category: campaign.category
          })
        }),
        fetch('http://localhost:5001/api/analytics/risk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: campaign.goal,
            current_funding: campaign.currentFunding,
            elapsed_days: campaign.elapsedDays,
            total_days: campaign.duration,
            category: campaign.category
          })
        })
      ]);

      if (velRes.ok && riskRes.ok) {
        const velData = await velRes.json();
        const riskData = await riskRes.json();

        setPredictions({
          predictedFinal: velData.predicted_final_funding,
          velocityStatus: velData.velocity_status,
          dailyVelocity: velData.daily_velocity,
          projectedBackers: velData.projected_total_backers,
          riskScore: riskData.risk_score,
          riskLevel: riskData.risk_level,
          probSuccess: riskData.probability_of_success,
          factors: riskData.risk_factors,
          recs: riskData.recommendations,
          scenarios: {
            pessimistic: velData.scenarios.pessimistic.map((p: any) => ({ day: p.day, amount: p.amount })),
            expected: velData.scenarios.expected.map((p: any) => ({ day: p.day, amount: p.amount })),
            optimistic: velData.scenarios.optimistic.map((p: any) => ({ day: p.day, amount: p.amount }))
          }
        });
      } else {
        throw new Error("Backend unavailable, using local calculation fallback.");
      }
    } catch (err) {
      // --- LOCAL BACKUP COMPUTATION MODEL ---
      // Replicates the Python model algorithms directly in JavaScript for robust operation
      const elapsed = Math.max(campaign.elapsedDays, 1);
      const dailyVel = campaign.currentFunding / elapsed;

      const scenarios = {
        pessimistic: [] as ScenarioPoint[],
        expected: [] as ScenarioPoint[],
        optimistic: [] as ScenarioPoint[]
      };

      let fundPess = campaign.currentFunding;
      let fundExp = campaign.currentFunding;
      let fundOpt = campaign.currentFunding;

      for (let d = campaign.elapsedDays + 1; d <= campaign.duration; d++) {
        const tNorm = d / campaign.duration;
        const uCurve = 4.0 * Math.pow(tNorm - 0.5, 2) + 0.25;

        fundPess += dailyVel * 0.7 * uCurve;
        fundExp += dailyVel * 1.0 * uCurve;
        fundOpt += dailyVel * 1.45 * uCurve;

        scenarios.pessimistic.push({ day: d, amount: Math.round(fundPess) });
        scenarios.expected.push({ day: d, amount: Math.round(fundExp) });
        scenarios.optimistic.push({ day: d, amount: Math.round(fundOpt) });
      }

      const predictedFinal = Math.round(fundExp);
      const pctFunded = (campaign.currentFunding / campaign.goal) * 100;
      const progressRatio = campaign.elapsedDays / campaign.duration;
      
      let status = "Moderate Progress";
      if (pctFunded >= 100) status = "Goal Achieved";
      else if (progressRatio > 0 && (pctFunded / progressRatio) >= 95) status = "On Track";
      else if (progressRatio > 0 && (pctFunded / progressRatio) < 60) status = "Critical (Slowing Down)";

      const linearExpected = progressRatio * 100;
      const deficit = linearExpected - pctFunded;
      let baseRisk = pctFunded >= 100 ? 5 : Math.min(Math.max(45 + deficit * 1.2, 10), 98);
      if (progressRatio > 0.85 && pctFunded < 75) baseRisk = Math.max(baseRisk, 85);
      
      const probSuccess = Math.round((100 - baseRisk) * 10) / 10;
      const level = baseRisk > 75 ? "Critical" : baseRisk > 45 ? "Medium" : "Low";

      setPredictions({
        predictedFinal,
        velocityStatus: status,
        dailyVelocity: Math.round(dailyVel),
        projectedBackers: Math.round(predictedFinal / 75),
        riskScore: Math.round(baseRisk * 10) / 10,
        riskLevel: level,
        probSuccess,
        factors: deficit > 15 ? ["Funding velocity is lagging behind linear milestones."] : ["Pacing is matching expected trajectory curves."],
        recs: pctFunded < 100 ? ["Add a limited-time Reward Tier to spark conversion urgency.", "Pitch updates to existing email lists."] : ["Design stretch goals to capture additional capital."],
        scenarios
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredictions();
  }, [campaign.currentFunding, campaign.elapsedDays, campaign.goal, campaign.duration, campaign.category]);

  // SVG Chart Dimensions & Computations
  const width = 500;
  const height = 240;
  const paddingX = 45;
  const paddingY = 25;

  const maxVal = predictions 
    ? Math.max(campaign.goal, predictions.predictedFinal * 1.2, ...predictions.scenarios.optimistic.map(p => p.amount))
    : campaign.goal * 1.5;

  const getX = (day: number) => paddingX + (day / campaign.duration) * (width - 2 * paddingX);
  const getY = (amount: number) => height - paddingY - (amount / maxVal) * (height - 2 * paddingY);

  // Generate historical curve data
  const historicalPoints: ScenarioPoint[] = [];
  const historicalDaily = campaign.currentFunding / Math.max(campaign.elapsedDays, 1);
  for (let d = 0; d <= campaign.elapsedDays; d++) {
    historicalPoints.push({
      day: d,
      amount: Math.round(historicalDaily * d)
    });
  }

  const historicalPath = historicalPoints.map(p => `${getX(p.day)},${getY(p.amount)}`).join(' ');

  const getScenarioPath = (pts: ScenarioPoint[]) => {
    if (pts.length === 0) return '';
    const startPoint = `${getX(campaign.elapsedDays)},${getY(campaign.currentFunding)}`;
    return 'M ' + startPoint + ' ' + pts.map(p => `L ${getX(p.day)},${getY(p.amount)}`).join(' ');
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Top Banner Stats */}
      <div className="grid-4">
        <div className="card hover-float">
          <p className="form-label" style={{ margin: 0 }}>Daily Velocity</p>
          <h3 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary)', marginTop: '8px' }}>
            ₹{predictions ? predictions.dailyVelocity.toLocaleString() : '...'} / day
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Based on actual history</p>
        </div>

        <div className="card hover-float">
          <p className="form-label" style={{ margin: 0 }}>Projected Funding</p>
          <h3 style={{ fontSize: '1.75rem', fontWeight: 700, color: (predictions?.predictedFinal || 0) >= campaign.goal ? 'var(--success)' : 'var(--danger)', marginTop: '8px' }}>
            ₹{predictions ? predictions.predictedFinal.toLocaleString() : '...'}
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Expected final total
          </p>
        </div>

        <div className="card hover-float">
          <p className="form-label" style={{ margin: 0 }}>Pacing Status</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
            <span className={`pill-badge ${predictions?.velocityStatus.includes('Critical') ? 'pill-danger' : 'pill-success'}`} style={{ fontSize: '0.9rem', padding: '6px 12px' }}>
              {predictions ? predictions.velocityStatus : 'Calculating...'}
            </span>
          </div>
        </div>

        <div className="card hover-float">
          <p className="form-label" style={{ margin: 0 }}>Success Probability</p>
          <h3 style={{ fontSize: '1.75rem', fontWeight: 700, color: (predictions?.probSuccess || 0) > 70 ? 'var(--success)' : (predictions?.probSuccess || 0) > 40 ? 'var(--warning)' : 'var(--danger)', marginTop: '8px' }}>
            {predictions ? `${predictions.probSuccess}%` : '...'}
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Dynamic ML prediction</p>
        </div>
      </div>

      {/* Main Core Layout: Interactive Simulation & Visualizations */}
      <div className="grid-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
        
        {/* Trajectory Graph Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Campaign Funding Trajectory</h3>
            <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: 'var(--primary)', borderRadius: '2px' }}></span> History
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '2px', borderTop: '2px dashed var(--success)', display: 'inline-block' }}></span> Optimistic
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '2px', borderTop: '2px dashed var(--primary)', display: 'inline-block' }}></span> Expected
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '2px', borderTop: '2px dashed var(--danger)', display: 'inline-block' }}></span> Pessimistic
              </span>
            </div>
          </div>

          <div style={{ position: 'relative', width: '100%', height: '250px' }}>
            {loading && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                <div className="loading-spinner"></div>
              </div>
            )}
            
            <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              {/* Grid Lines */}
              <line x1={paddingX} y1={getY(0)} x2={width - paddingX} y2={getY(0)} stroke="var(--border-color)" strokeWidth="1" />
              <line x1={paddingX} y1={getY(campaign.goal)} x2={width - paddingX} y2={getY(campaign.goal)} stroke="var(--primary)" strokeWidth="1" strokeDasharray="4 4" opacity="0.3" />
              <line x1={getX(campaign.elapsedDays)} y1={paddingY} x2={getX(campaign.elapsedDays)} y2={height - paddingY} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
              
              {/* Y Axis Label (Goal line) */}
              <text x={width - paddingX + 5} y={getY(campaign.goal) + 4} fill="var(--primary)" fontSize="8px" fontWeight="600">GOAL</text>
              <text x={paddingX - 5} y={getY(campaign.goal) + 4} fill="var(--text-muted)" fontSize="9px" textAnchor="end">₹{Math.round(campaign.goal / 1000)}k</text>
              <text x={paddingX - 5} y={getY(0) + 4} fill="var(--text-muted)" fontSize="9px" textAnchor="end">₹0</text>
              
              {/* X Axis Labels */}
              <text x={paddingX} y={height - 8} fill="var(--text-secondary)" fontSize="9px">Start</text>
              <text x={getX(campaign.elapsedDays)} y={height - 8} fill="var(--text-primary)" fontSize="9px" textAnchor="middle" fontWeight="600">Day {campaign.elapsedDays}</text>
              <text x={width - paddingX} y={height - 8} fill="var(--text-secondary)" fontSize="9px" textAnchor="end">Day {campaign.duration}</text>

              {/* Historical Area & Path */}
              <polyline
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={historicalPath}
              />
              
              {/* Scenario Lines */}
              {predictions && (
                <>
                  {/* Optimistic */}
                  <path
                    d={getScenarioPath(predictions.scenarios.optimistic)}
                    fill="none"
                    stroke="var(--success)"
                    strokeWidth="2.5"
                    strokeDasharray="4 4"
                  />
                  {/* Expected */}
                  <path
                    d={getScenarioPath(predictions.scenarios.expected)}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="2.5"
                    strokeDasharray="4 4"
                  />
                  {/* Pessimistic */}
                  <path
                    d={getScenarioPath(predictions.scenarios.pessimistic)}
                    fill="none"
                    stroke="var(--danger)"
                    strokeWidth="2.5"
                    strokeDasharray="4 4"
                  />
                </>
              )}

              {/* Highlight current point */}
              <circle
                cx={getX(campaign.elapsedDays)}
                cy={getY(campaign.currentFunding)}
                r="6"
                fill="var(--bg-card)"
                stroke="var(--primary)"
                strokeWidth="3.5"
              />
            </svg>
          </div>
        </div>

        {/* Simulate Backer Pledge */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <h3 className="card-title">Simulate Backer Pledge</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Support the campaign as a mock backer. Select a reward tier to pledge funds and dynamically increase backer statistics.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {campaign.rewards && campaign.rewards.length > 0 ? (
              campaign.rewards.map((reward, idx) => (
                <div 
                  key={idx} 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '10px 12px', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-primary)'
                  }}
                >
                  <div style={{ flex: 1, paddingRight: '12px' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      {reward.title}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                      Pledge value: ₹{reward.price.toLocaleString()}
                    </p>
                  </div>
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={() => handleSimulatePledge(reward.price)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Pledge ₹{reward.price}
                  </button>
                </div>
              ))
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                No reward tiers available. Build tiers in the Page Creator tab!
              </p>
            )}
          </div>
        </div>

        {/* Real-time Tweak Sandbox Controls */}
        <div className="card">
          <h3 className="card-title">Simulation Controls</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Adjust the campaign's current metrics below to simulate dynamic updates on the ML forecasting models.
          </p>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span className="form-label">Current Funding Amount</span>
              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>₹{campaign.currentFunding.toLocaleString()}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max={campaign.goal * 1.5} 
              step="500"
              value={campaign.currentFunding}
              onChange={(e) => updateCampaign({ currentFunding: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>₹0</span>
              <span>Goal: ₹{campaign.goal.toLocaleString()}</span>
              <span>Max: ₹{(campaign.goal * 1.5).toLocaleString()}</span>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span className="form-label">Days Elapsed</span>
              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{campaign.elapsedDays} Days</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max={campaign.duration - 1} 
              step="1"
              value={campaign.elapsedDays}
              onChange={(e) => updateCampaign({ elapsedDays: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>Day 0</span>
              <span>Total Duration: {campaign.duration} Days</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Layout: Risk Factors & AI Stretch Goal Recommender */}
      <div className="grid-2">
        {/* Risk Assessment Column */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Predictive Risk Assessment</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-primary)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: predictions?.riskLevel === 'Low' ? 'var(--success-light)' : predictions?.riskLevel === 'Medium' ? 'var(--warning-light)' : 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: predictions?.riskLevel === 'Low' ? 'var(--success)' : predictions?.riskLevel === 'Medium' ? 'var(--warning)' : 'var(--danger)' }}></span>
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Risk Status</p>
              <h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: predictions?.riskLevel === 'Low' ? 'var(--success)' : predictions?.riskLevel === 'Medium' ? 'var(--warning)' : 'var(--danger)' }}>
                {predictions ? `${predictions.riskLevel} Risk` : '...'} ({predictions ? predictions.riskScore : 0}% failure chance)
              </h4>
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Key Risk Signals:</h4>
            <ul style={{ paddingLeft: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {predictions?.factors.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>AI Recommended Course Correction:</h4>
            <ul style={{ paddingLeft: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {predictions?.recs.map((r, i) => (
                <li key={i} style={{ color: 'var(--primary)', fontWeight: 500 }}>{r}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Stretch Goals Recommender Column */}
        <div className="card">
          <h3 className="card-title">AI Stretch Goal Recommender</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Stretch goals are unlocked as the campaign exceeds its goal. Keep backers excited and sharing by introducing:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '14px', borderLeft: '4px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Level 1: Community Colorways</h4>
                <span className="pill-badge pill-success">₹35,000 Goal</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Unlock a customizable limited edition casing color. Run a voting poll in the backer update area to build backer synergy.
              </p>
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '14px', borderLeft: '4px solid #a855f7' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Level 2: Extended 2-Year Warranty</h4>
                <span className="pill-badge pill-success">₹45,000 Goal</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Double the warranty protection for all backers. This increases closing-week pledge values without adding immediate physical supply costs.
              </p>
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '14px', borderLeft: '4px solid var(--success)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Level 3: Protective Carry Sleeve</h4>
                <span className="pill-badge pill-success">₹60,000 Goal</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Include a custom neoprene travel sleeve in every package. Great for boosting viral shares on Facebook and Twitter.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
