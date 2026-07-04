import math
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np

app = FastAPI(
    title="Crowdfunding AI Prediction Engine",
    description="Analytics service for velocity prediction, risk assessment, and success scoring.",
    version="1.0.0"
)

# Enable CORS for cross-communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Schemas ---

class VelocityRequest(BaseModel):
    goal: float = Field(..., gt=0)
    current_funding: float = Field(..., ge=0)
    elapsed_days: int = Field(..., ge=0)
    total_days: int = Field(..., gt=0)
    backer_counts: List[int] = Field(default=[])
    category: str = Field(default="Technology")

class TrajectoryPoint(BaseModel):
    day: int
    amount: float
    backers: int

class ScenarioTrajectory(BaseModel):
    pessimistic: List[TrajectoryPoint]
    expected: List[TrajectoryPoint]
    optimistic: List[TrajectoryPoint]

class VelocityResponse(BaseModel):
    predicted_final_funding: float
    velocity_status: str
    daily_velocity: float
    projected_total_backers: int
    scenarios: ScenarioTrajectory

class RiskRequest(BaseModel):
    goal: float = Field(..., gt=0)
    current_funding: float = Field(..., ge=0)
    elapsed_days: int = Field(..., ge=0)
    total_days: int = Field(..., gt=0)
    category: str = Field(default="Technology")

class RiskResponse(BaseModel):
    risk_score: float  # 0 to 100
    risk_level: str   # Low, Medium, High, Critical
    probability_of_success: float  # 0 to 100
    risk_factors: List[str]
    recommendations: List[str]

class SimilarCampaignRequest(BaseModel):
    goal: float = Field(..., gt=0)
    category: str = Field(default="Technology")
    duration: int = Field(default=30, gt=0)
    reward_count: int = Field(default=3, ge=0)

class SimilarCampaign(BaseModel):
    name: str
    similarity: float
    goal: float
    funded_amount: float
    backers: int
    status: str
    category: str

class SimilarCampaignsResponse(BaseModel):
    category_average_success_rate: float
    similarity_score: float
    closest_campaigns: List[SimilarCampaign]
    key_takeaways: List[str]

class RewardItem(BaseModel):
    price: float
    limit: Optional[int] = None
    title: str

class SuccessFactorRequest(BaseModel):
    goal: float = Field(..., gt=0)
    category: str = Field(default="Technology")
    duration: int = Field(default=30, gt=0)
    rewards: List[RewardItem] = Field(default=[])
    has_video: bool = Field(default=True)
    faq_count: int = Field(default=0, ge=0)
    description_length: int = Field(default=1000, ge=0)

class FactorScore(BaseModel):
    name: str
    weight: float      # importance
    score: float       # 0 to 100 score of current input
    feedback: str

class SuccessFactorResponse(BaseModel):
    overall_success_score: float  # 0 to 100
    factors: List[FactorScore]
    action_items: List[str]


# --- Helper Functions & Models ---

def estimate_bass_diffusion(
    total_days: int,
    elapsed_days: int,
    current_funding: float,
    goal: float,
    scenario_multiplier: float = 1.0,
    category_factor: float = 1.0
) -> List[dict]:
    """
    Simulates a standard Bass Diffusion/S-curve for Crowdfunding.
    Crowdfunding campaigns typically follow a U-shape (high start, flat middle, high end)
    or an S-curve. We simulate cumulative progress using a customized diffusion model.
    """
    days_left = total_days - elapsed_days
    if days_left <= 0:
        return []

    # Calculate basic daily velocity
    avg_daily = current_funding / max(elapsed_days, 1)
    if avg_daily == 0:
        avg_daily = (goal / total_days) * 0.45
    
    # Target remaining need
    remaining_need = max(goal - current_funding, 0)
    
    # We will build three phases: initial launch bump, steady state, and end-of-campaign rush
    # Create the curve using a cumulative distribution simulation
    projected_points = []
    running_total = current_funding
    
    # Estimated current backer average contribution
    avg_contribution = 75.0 # default
    
    for day in range(elapsed_days + 1, total_days + 1):
        # Progress along the campaign
        t_normalized = day / total_days
        
        # U-curve daily multiplier (higher at start and end)
        # We model this with a quadratic shape: 3 * (t - 0.5)^2 + 0.25
        u_curve = 4.0 * (t_normalized - 0.5) ** 2 + 0.25
        
        # Calculate base increment based on current daily velocity and scenario multiplier
        increment = avg_daily * scenario_multiplier * u_curve * category_factor
        
        # Add small randomness
        random_noise = np.random.normal(0, max(increment * 0.1, 5.0))
        increment = max(increment + random_noise, 0.0)
        
        running_total += increment
        projected_backers = int(running_total / avg_contribution)
        
        projected_points.append({
            "day": day,
            "amount": round(running_total, 2),
            "backers": projected_backers
        })
        
    return projected_points


# --- Endpoints ---

@app.post("/predict/velocity", response_model=VelocityResponse)
def predict_velocity(req: VelocityRequest):
    if req.elapsed_days > req.total_days:
        raise HTTPException(status_code=400, detail="Elapsed days cannot exceed total days.")

    # Calculate historical stats
    avg_daily_velocity = req.current_funding / max(req.elapsed_days, 1)
    current_backers = sum(req.backer_counts) if req.backer_counts else int(req.current_funding / 75.0)
    
    # Category adjustment
    category_multipliers = {
        "Technology": 1.1,
        "Games": 1.25,
        "Design": 1.0,
        "Art": 0.85,
        "Film & Video": 0.9,
        "Publishing": 0.8,
        "Fashion": 1.05
    }
    cat_factor = category_multipliers.get(req.category, 1.0)
    
    # Generate Scenarios
    # Expected scenario
    expected_traj = estimate_bass_diffusion(
        req.total_days, req.elapsed_days, req.current_funding, req.goal, 1.0, cat_factor
    )
    # Optimistic scenario (growth due to social share boost)
    optimistic_traj = estimate_bass_diffusion(
        req.total_days, req.elapsed_days, req.current_funding, req.goal, 1.4, cat_factor
    )
    # Pessimistic scenario (momentum loss)
    pessimistic_traj = estimate_bass_diffusion(
        req.total_days, req.elapsed_days, req.current_funding, req.goal, 0.7, cat_factor
    )
    
    # Final values
    final_funding = expected_traj[-1]["amount"] if expected_traj else req.current_funding
    final_backers = expected_traj[-1]["backers"] if expected_traj else current_backers
    
    # Status determination
    pct_funded = (req.current_funding / req.goal) * 100
    progress_ratio = req.elapsed_days / req.total_days if req.total_days > 0 else 1
    
    if pct_funded >= 100:
        status = "Goal Achieved"
    elif progress_ratio > 0 and (pct_funded / progress_ratio) >= 95:
        status = "On Track"
    elif progress_ratio > 0 and (pct_funded / progress_ratio) >= 60:
        status = "Moderate Progress"
    else:
        status = "Critical (Slowing Down)"

    return VelocityResponse(
        predicted_final_funding=round(final_funding, 2),
        velocity_status=status,
        daily_velocity=round(avg_daily_velocity, 2),
        projected_total_backers=final_backers,
        scenarios=ScenarioTrajectory(
            pessimistic=[TrajectoryPoint(**p) for p in pessimistic_traj],
            expected=[TrajectoryPoint(**p) for p in expected_traj],
            optimistic=[TrajectoryPoint(**p) for p in optimistic_traj]
        )
    )

@app.post("/predict/risk", response_model=RiskResponse)
def predict_risk(req: RiskRequest):
    if req.elapsed_days > req.total_days:
        raise HTTPException(status_code=400, detail="Elapsed days cannot exceed total days.")
        
    pct_funded = (req.current_funding / req.goal) * 100
    
    if req.total_days == 0:
        raise HTTPException(status_code=400, detail="Total days must be greater than zero.")
        
    time_ratio = req.elapsed_days / req.total_days
    
    # Basic math model for success probability:
    # A campaign that is 50% funded at 50% time has a good chance. 
    # If 10% funded at 50% time, it's risky.
    # If 100% funded, risk is 0.
    if pct_funded >= 100:
        risk_score = 0.0
        prob_success = 100.0
        level = "Low"
        factors = ["Campaign is fully funded!"]
        recs = ["Launch stretch goals to maintain momentum.", "Post updates regularly to build backer trust."]
    else:
        # Calculate dynamic index
        # A baseline "fair progress" ratio is equal to the time ratio.
        # However, crowdfunding typically sees a spike at the start and end.
        # We calculate the deviation from required linear progression
        linear_expected = time_ratio * 100
        deficit = linear_expected - pct_funded
        
        # Calculate risk based on time remaining and deficit
        if time_ratio < 0.15:
            # Early days: deficit isn't as critical, but low momentum raises some risk
            base_risk = max(30.0 + deficit * 0.5, 10.0)
        elif time_ratio > 0.85:
            # Late days: deficits are extremely hard to recover
            base_risk = min(max(pct_funded + deficit * 2.0, 50.0), 99.0)
            if pct_funded < 50:
                base_risk = 98.0
        else:
            # Mid campaign
            base_risk = min(max(40.0 + deficit * 1.2, 5.0), 95.0)
            
        risk_score = round(base_risk, 1)
        prob_success = round(100.0 - risk_score, 1)
        
        if risk_score < 25:
            level = "Low"
        elif risk_score < 50:
            level = "Medium"
        elif risk_score < 80:
            level = "High"
        else:
            level = "Critical"
            
        # Compile lists
        factors = []
        recs = []
        
        if pct_funded < 20 and time_ratio > 0.3:
            factors.append("Extremely slow start: less than 20% funded with significant time elapsed.")
            recs.append("Restructure reward tiers to add lower-cost, high-value entry options.")
            
        if deficit > 20:
            factors.append(f"Funding path is lagging behind linear target by {round(deficit, 1)}%.")
            recs.append("Launch a flash promotion or limited-time reward tier to create urgency.")
            
        if req.goal > 50000 and pct_funded < 10:
            factors.append("High funding goal combined with low initial backer engagement.")
            recs.append("Reach out to pre-launch email lists immediately to push the first 30% of funding.")
            
        # General recs
        if not recs:
            recs.append("Post regular project updates to improve page SEO and backer confidence.")
            recs.append("Share short-form pitch video snippets on social platforms.")
        if not factors:
            factors.append("Standard campaign progression with steady backer input.")

    return RiskResponse(
        risk_score=risk_score,
        risk_level=level,
        probability_of_success=prob_success,
        risk_factors=factors,
        recommendations=recs
    )

@app.post("/analytics/similar", response_model=SimilarCampaignsResponse)
def analyze_similar(req: SimilarCampaignRequest):
    # Simulated database of past campaigns
    database = [
        # Technology
        {"name": "Nova Smart Ring", "category": "Technology", "goal": 25000, "funded_amount": 87400, "backers": 1165, "status": "successful", "duration": 30, "rewards": 4},
        {"name": "AirPurify Portable", "category": "Technology", "goal": 50000, "funded_amount": 12400, "backers": 155, "status": "failed", "duration": 45, "rewards": 3},
        {"name": "CyberKey Lock", "category": "Technology", "goal": 15000, "funded_amount": 16400, "backers": 218, "status": "successful", "duration": 30, "rewards": 5},
        {"name": "ZenCharger Wireless", "category": "Technology", "goal": 100000, "funded_amount": 112000, "backers": 1493, "status": "successful", "duration": 35, "rewards": 6},
        # Games
        {"name": "Dungeons of Eldor (RPG)", "category": "Games", "goal": 15000, "funded_amount": 145000, "backers": 2900, "status": "successful", "duration": 30, "rewards": 8},
        {"name": "Pixel Quest Console", "category": "Games", "goal": 80000, "funded_amount": 23000, "backers": 287, "status": "failed", "duration": 30, "rewards": 4},
        {"name": "Monsters & Magic Deck", "category": "Games", "goal": 10000, "funded_amount": 42000, "backers": 1050, "status": "successful", "duration": 25, "rewards": 5},
        # Design & Art
        {"name": "Minimalist Canvas Wallet", "category": "Design", "goal": 5000, "funded_amount": 23500, "backers": 587, "status": "successful", "duration": 30, "rewards": 3},
        {"name": "ErgoDesk Stand", "category": "Design", "goal": 40000, "funded_amount": 38000, "backers": 210, "status": "failed", "duration": 30, "rewards": 4},
        {"name": "Enchanted Art Book", "category": "Art", "goal": 7500, "funded_amount": 19400, "backers": 431, "status": "successful", "duration": 20, "rewards": 5},
    ]

    # Calculate distances based on Goal, Category match, Duration, and Rewards count
    matches = []
    category_success_count = 0
    category_total_count = 0
    
    for item in database:
        # Calculate category weight
        cat_match = 1.0 if item["category"].lower() == req.category.lower() else 0.0
        if cat_match == 1.0:
            category_total_count += 1
            if item["status"] == "successful":
                category_success_count += 1
                
        # Simple distance metric
        goal_diff = abs(item["goal"] - req.goal) / max(req.goal, 1)
        dur_diff = abs(item["duration"] - req.duration) / max(req.duration, 1)
        rew_diff = abs(item["rewards"] - req.reward_count) / max(req.reward_count, 1)
        
        # Calculate similarity score (inverse of distance weighted by category match)
        distance = (goal_diff * 0.4) + (dur_diff * 0.2) + (rew_diff * 0.1) + ((1 - cat_match) * 0.8)
        similarity = round(max(100 - (distance * 50), 30), 1)
        
        matches.append(SimilarCampaign(
            name=item["name"],
            similarity=similarity,
            goal=item["goal"],
            funded_amount=item["funded_amount"],
            backers=item["backers"],
            status=item["status"],
            category=item["category"]
        ))
        
    # Sort matches by similarity
    matches.sort(key=lambda x: x.similarity, reverse=True)
    closest = matches[:3]
    
    avg_success_rate = (category_success_count / category_total_count * 100) if category_total_count > 0 else 65.0
    overall_similarity = sum(c.similarity for c in closest) / 3 if closest else 70.0
    
    # Key takeaways
    takeaways = [
        f"Campaigns in '{req.category}' have an average historical success rate of {round(avg_success_rate, 1)}%.",
        f"Campaigns similar to yours with lower goals (< ₹{req.goal * 0.8:.0f}) experienced 30% higher success rates.",
        f"Successful campaigns in this cluster offered an average of {closest[0].backers // 200 + 4} reward tiers to segment backer brackets."
    ]

    return SimilarCampaignsResponse(
        category_average_success_rate=round(avg_success_rate, 1),
        similarity_score=round(overall_similarity, 1),
        closest_campaigns=closest,
        key_takeaways=takeaways
    )

@app.post("/analytics/success-factors", response_model=SuccessFactorResponse)
def evaluate_success_factors(req: SuccessFactorRequest):
    factors = []
    
    # 1. Goal Realism
    goal = req.goal
    if goal <= 10000:
        goal_score = 95.0
        goal_feedback = "Your funding goal is highly realistic and easy to reach with a modest crowd size."
    elif goal <= 35000:
        goal_score = 80.0
        goal_feedback = "Your goal is moderate. Reaching it requires solid pre-launch marketing list building."
    elif goal <= 75000:
        goal_score = 60.0
        goal_feedback = "Your goal is high. Requires active community management, influencer push, and paid ads."
    else:
        goal_score = 40.0
        goal_feedback = "Goal is highly ambitious. Requires a massive pre-existing audience or viral product appeal."
        
    factors.append(FactorScore(
        name="Funding Goal Realism",
        weight=0.3,
        score=goal_score,
        feedback=goal_feedback
    ))
    
    # 2. Reward Structure
    reward_count = len(req.rewards)
    if reward_count == 0:
        reward_score = 10.0
        reward_feedback = "No reward tiers defined. Backers require clear incentive tiers to pledge."
    elif reward_count < 3:
        reward_score = 50.0
        reward_feedback = "Too few tiers. Provide at least 4-5 options ranging from low (₹500-₹1,000 support) to high (VIP packages)."
    elif reward_count <= 7:
        reward_score = 95.0
        reward_feedback = "Perfect range of tiers. Backers have solid options without getting overwhelmed."
    else:
        reward_score = 75.0
        reward_feedback = "Many reward tiers. Ensure they are distinct to avoid decision paralysis."
        
    factors.append(FactorScore(
        name="Reward Tier Variety",
        weight=0.2,
        score=reward_score,
        feedback=reward_feedback
    ))
    
    # 3. Campaign Presentation Media
    media_score = 95.0 if req.has_video else 30.0
    media_feedback = "Pitch video included! Campaigns with pitch videos raise 105% more funds on average." if req.has_video else "No pitch video detected. Adding a short (1-2 min) introductory pitch video is highly recommended."
    
    factors.append(FactorScore(
        name="Media & Pitch Presentation",
        weight=0.25,
        score=media_score,
        feedback=media_feedback
    ))
    
    # 4. Campaign Page Detail (FAQ & Length)
    faq_score = min(max(req.faq_count * 20.0, 20.0), 100.0)
    faq_feedback = f"FAQ count is {req.faq_count}. Recommending at least 4 common questions about shipping, usage, and guarantees."
    if req.faq_count >= 4:
        faq_feedback = "Excellent. You have addressed common backer concerns via the FAQ tab."
        
    factors.append(FactorScore(
        name="FAQ Depth",
        weight=0.1,
        score=faq_score,
        feedback=faq_feedback
    ))
    
    # 5. Description Length / Detail
    desc_score = 100.0
    desc_feedback = "Optimal description length. Provides sufficient detail for readers."
    if req.description_length < 400:
        desc_score = 40.0
        desc_feedback = "Description is too brief. Expand on technical specifications, project timeline, and creator bio."
    elif req.description_length > 4000:
        desc_score = 80.0
        desc_feedback = "Description is extremely lengthy. Ensure you use headers, bold text, and images to make it skimmable."
        
    factors.append(FactorScore(
        name="Description Detail",
        weight=0.15,
        score=desc_score,
        feedback=desc_feedback
    ))
    
    # Calculate weighted average
    overall_score = sum(f.score * f.weight for f in factors)
    
    # Action items list
    action_items = []
    if not req.has_video:
        action_items.append("Create and upload a 90-second high-energy pitch video demonstrating the prototype.")
    if reward_count < 4:
        action_items.append("Introduce entry-level (₹1,000 digital support) and mid-tier (₹4,500 early bird) options to your rewards structure.")
    if req.faq_count < 4:
        action_items.append("Auto-generate and add at least 5 FAQs regarding shipping timelines, return policies, and specifications.")
    if req.description_length < 600:
        action_items.append("Expand your campaign body to explain the 'Behind the Scenes' design process and team experience.")
    if goal > 30000:
        action_items.append("Establish a pre-launch landing page to collect 500+ emails before hitting the 'Launch' button.")

    if not action_items:
        action_items.append("All key success vectors are optimized. Prepare your outreach list and prepare for launch!")

    return SuccessFactorResponse(
        overall_success_score=round(overall_score, 1),
        factors=factors,
        action_items=action_items
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
