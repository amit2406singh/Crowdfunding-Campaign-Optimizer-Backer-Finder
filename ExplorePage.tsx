import { useState } from 'react';
import type { CampaignState } from '../App';

interface ExplorePageProps {
  campaigns: CampaignState[];
  onSelectCampaign: (id: string) => void;
  onNavigateToPlanner: () => void;
  onUpdateCampaign: (id: string, fields: Partial<CampaignState>) => Promise<void>;
  onQuickPledge: (id: string, price: number) => Promise<void>;
}

export default function ExplorePage({ 
  campaigns, 
  onSelectCampaign, 
  onNavigateToPlanner, 
  onUpdateCampaign, 
  onQuickPledge 
}: ExplorePageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [editingCampaign, setEditingCampaign] = useState<CampaignState | null>(null);
  const [pledgeRewards, setPledgeRewards] = useState<{[key: string]: number}>({});
  const [customPledge, setCustomPledge] = useState<{[key: string]: string}>({});

  const categories = ['All', 'Technology', 'Games', 'Design', 'Art', 'Fashion', 'Publishing'];

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Directory Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>Explore Campaigns</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Discover active innovative projects, analyze S-curves, or pledge custom backer support.
          </p>
        </div>
        <button className="btn btn-primary" onClick={onNavigateToPlanner}>
          Plan New Campaign
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ display: 'flex', flexDirection: 'row', gap: '16px', flexWrap: 'wrap', padding: '16px' }}>
        <div style={{ flex: 1, minWidth: '250px' }}>
          <input 
            type="text" 
            className="form-control" 
            placeholder="Search campaigns by keyword..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Campaigns Grid */}
      {filteredCampaigns.length === 0 ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' }}>
          <span style={{ fontSize: '1.25rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '8px' }}>
            No Active Campaigns Found
          </span>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '20px' }}>
            There are no campaigns matching your filters. Create a new campaign proposal in the Planner to populate this gallery!
          </p>
          <button className="btn btn-primary" onClick={onNavigateToPlanner}>
            Create First Campaign
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filteredCampaigns.map((camp: any) => {
            const backersCount = camp.backerCounts ? camp.backerCounts.reduce((a: number, b: number) => a + b, 0) : 0;
            const percent = camp.goal > 0 ? Math.round((camp.currentFunding / camp.goal) * 100) : 0;
            const barWidth = Math.min(percent, 100);

            return (
              <div key={camp._id} className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: '400px', transition: 'transform var(--transition-fast) ease', cursor: 'default' }}>
                
                {/* Card Title & Category */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <span className="pill-badge pill-warning" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
                    {camp.category}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                      {camp.duration} Days
                    </span>
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingCampaign(camp)}
                      style={{ padding: '2px 6px', fontSize: '0.7rem', borderColor: 'var(--border-color)', color: 'var(--text-secondary)', height: '22px' }}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', lineHeight: 1.3 }}>
                  {camp.title}
                </h3>

                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1, marginBottom: '16px', lineHeight: 1.4 }}>
                  {camp.description.length > 140 ? `${camp.description.substring(0, 137)}...` : camp.description}
                </p>

                {/* Progress Indicators */}
                <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                    <span style={{ color: 'var(--text-primary)' }}>
                      ₹{camp.currentFunding.toLocaleString()} raised
                    </span>
                    <span style={{ color: 'var(--primary)' }}>
                      {percent}%
                    </span>
                  </div>

                  <div className="progress-bar-bg" style={{ marginBottom: '12px' }}>
                    <div className="progress-bar-fill" style={{ width: `${barWidth}%` }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    <span>Goal: ₹{camp.goal.toLocaleString()}</span>
                    <span>{backersCount} Backers</span>
                  </div>
                </div>

                {/* Quick Pledge Simulation Row */}
                <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '12px', marginBottom: '16px' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Simulate Backer Pledge
                  </p>
                  {camp.rewards && camp.rewards.length > 0 ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select
                        className="form-control form-control-sm"
                        value={pledgeRewards[camp._id] || 0}
                        onChange={(e) => setPledgeRewards({ ...pledgeRewards, [camp._id]: Number(e.target.value) })}
                        style={{ fontSize: '0.75rem', flex: 1, padding: '4px', height: '30px' }}
                      >
                        {camp.rewards.map((rew: any, rIdx: number) => (
                          <option key={rIdx} value={rIdx}>
                            {rew.title} (₹{rew.price.toLocaleString()})
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const selectedIdx = pledgeRewards[camp._id] || 0;
                          if (camp.rewards && camp.rewards[selectedIdx]) {
                            onQuickPledge(camp._id, camp.rewards[selectedIdx].price);
                          }
                        }}
                        style={{ fontSize: '0.75rem', padding: '4px 12px', height: '30px' }}
                      >
                        Pledge
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        placeholder="₹ Amount"
                        value={customPledge[camp._id] || ''}
                        onChange={(e) => setCustomPledge({ ...customPledge, [camp._id]: e.target.value })}
                        style={{ fontSize: '0.75rem', flex: 1, padding: '4px', height: '30px' }}
                        min="1"
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const amt = Number(customPledge[camp._id]);
                          if (amt > 0) {
                            onQuickPledge(camp._id, amt);
                            setCustomPledge({ ...customPledge, [camp._id]: '' });
                          } else {
                            alert("Please enter a valid pledge amount.");
                          }
                        }}
                        style={{ fontSize: '0.75rem', padding: '4px 12px', height: '30px' }}
                      >
                        Pledge
                      </button>
                    </div>
                  )}
                </div>

                {/* Open Campaign Dashboard */}
                <button 
                  className="btn btn-primary" 
                  onClick={() => onSelectCampaign(camp._id)}
                  style={{ width: '100%', padding: '10px' }}
                >
                  Manage Campaign
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal Overlay */}
      {editingCampaign && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(15, 23, 42, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(2px)' }}>
          <div className="card" style={{ width: '450px', maxWidth: '90%', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)' }}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>Edit Campaign Details</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (editingCampaign._id) {
                await onUpdateCampaign(editingCampaign._id, {
                  title: editingCampaign.title,
                  description: editingCampaign.description,
                  category: editingCampaign.category,
                  goal: editingCampaign.goal,
                  duration: editingCampaign.duration
                });
                setEditingCampaign(null);
              }
            }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Campaign Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={editingCampaign.title} 
                  onChange={(e) => setEditingCampaign({ ...editingCampaign, title: e.target.value })} 
                  required 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Description</label>
                <textarea 
                  className="form-control" 
                  value={editingCampaign.description} 
                  onChange={(e) => setEditingCampaign({ ...editingCampaign, description: e.target.value })} 
                  rows={3} 
                  required 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Category</label>
                <select 
                  className="form-control" 
                  value={editingCampaign.category} 
                  onChange={(e) => setEditingCampaign({ ...editingCampaign, category: e.target.value })}
                >
                  <option value="Technology">Technology</option>
                  <option value="Games">Games</option>
                  <option value="Design">Design</option>
                  <option value="Art">Art</option>
                  <option value="Fashion">Fashion</option>
                  <option value="Publishing">Publishing</option>
                </select>
              </div>
              <div className="grid-2" style={{ gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Goal (₹)</label>
                  <input 
                    type="number" 
                    className="form-control" 
                    value={editingCampaign.goal} 
                    onChange={(e) => setEditingCampaign({ ...editingCampaign, goal: Number(e.target.value) })} 
                    required 
                    min="1" 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Duration (Days)</label>
                  <input 
                    type="number" 
                    className="form-control" 
                    value={editingCampaign.duration} 
                    onChange={(e) => setEditingCampaign({ ...editingCampaign, duration: Number(e.target.value) })} 
                    required 
                    min="1" 
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingCampaign(null)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
