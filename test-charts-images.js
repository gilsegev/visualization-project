async function runUltimateTest() {
  const prompt = `
Build an advanced masterclass course on "The Future of Global Logistics".

STAGE 1: NARRATIVE GROWTH (10 ANIMATED VIDEOS + POSTERS)
- CHART 1: [ANIMATED VIDEO] Global Trade Volume: Labels [2020, 2022, 2024, 2026] with Values [15, 19, 24, 31] in Trillions.
- CHART 2: [ANIMATED VIDEO] Drone Delivery Adoption: Labels [Phase 1, Phase 2, Phase 3] with Values [10, 45, 85] percent.
- CHART 3: [ANIMATED VIDEO] Route Optimization Efficiency: Labels [Manual, AI-v1, AI-v2] with Values [60, 85, 98].
- CHART 4: [ANIMATED VIDEO] Port Congestion Index: Labels [Q1, Q2, Q3, Q4] with Values [88, 72, 45, 30].
- CHART 5: [ANIMATED VIDEO] EV Truck Range: Labels [2021, 2023, 2025] with Values [300, 500, 850] miles.
- CHART 6: [ANIMATED VIDEO] Fuel Cost volatility: Labels [Jan, Mar, Jun, Sep, Dec] with Values [3.2, 4.5, 5.1, 4.2, 3.8].
- CHART 7: [ANIMATED VIDEO] Warehouse Automation: Labels [Sorting, Packing, Loading] with Values [30, 65, 90] percent automation.
- CHART 8: [ANIMATED VIDEO] Carbon Footprint Reduction: Labels [Baseline, Year 1, Year 2, Year 3] with Values [100, 85, 60, 35].
- CHART 9: [ANIMATED VIDEO] Last-Mile Speed: Labels [Standard, Express, Instant] with Values [48, 12, 1] in hours.
- CHART 10: [ANIMATED VIDEO] Supply Chain Resilience: Labels [2020, 2023, 2026] with Values [20, 55, 90].

STAGE 2: LOGISTICS SNAPSHOTS (10 STATIC PNG CHARTS)
- CHART 11: [STATIC PNG] Mode of Transport: Labels [Sea, Air, Rail, Road] with Values [45, 15, 20, 20].
- CHART 12: [STATIC PNG] Regional Hubs: Labels [Asia, Europe, NA, LATAM] with Values [400, 250, 300, 150].
- CHART 13: [STATIC PNG] Labor Force Mix: Labels [Drivers, Tech, Ops] with Values [50, 30, 20].
- CHART 14: [STATIC PNG] Inventory Turnover: Labels [Retail, Tech, Food] with Values [12, 8, 25].
- CHART 15: [STATIC PNG] Packaging Waste: Labels [Plastic, Paper, Bio] with Values [40, 45, 15].
- CHART 16: [STATIC PNG] Risk Factors: Labels [Weather, Political, Tech] with Values [35, 40, 25].
- CHART 17: [STATIC PNG] Custom Clearance Time: Labels [US, EU, CN, BR] with Values [1, 2, 3, 10] in days.
- CHART 18: [STATIC PNG] Storage Costs: Labels [Cold, Dry, Hazardous] with Values [500, 200, 800].
- CHART 19: [STATIC PNG] Error Rates: Labels [Manual, Automated] with Values [12.5, 0.8].
- CHART 20: [STATIC PNG] Provider Market Share: Labels [Maersk, DHL, FedEx, Others] with Values [18, 15, 12, 55].

STAGE 3: CONCEPTUAL VISUALS (10 FLUX IMAGES)
- IMAGE 1: A futuristic cargo ship powered by massive high-tech sails, glowing blue neon accents, cutting through dark ocean waves at night. Cinematic 8k.
- IMAGE 2: Macro shot of a robotic hand delicately placing a parcel on a high-speed conveyor belt. Soft bokeh, industrial lighting.
- IMAGE 3: A swarm of delivery drones silhouetted against a vibrant orange sunset over a sprawling mega-city.
- IMAGE 4: Interior of a fully autonomous warehouse with geometric laser grids and sleek white robots moving in perfect synchronicity.
- IMAGE 5: A professional female logistics manager in a glass-walled command center, looking at floating holographic global maps.
- IMAGE 6: A fleet of electric semi-trucks charging at a futuristic highway station with clean architecture and green plant life.
- IMAGE 7: Close-up of a digital ID tag on a shipping container glowing with data patterns. Cyberpunk aesthetic.
- IMAGE 8: A bird's eye view of a hyper-modern port terminal with autonomous cranes moving silver containers. Ultra-detailed.
- IMAGE 9: An abandoned traditional warehouse contrasting with a new, bright, AI-driven facility in the background. Narrative lighting.
- IMAGE 10: A group of diverse engineers in clean-room suits inspecting a heavy-lift space cargo rocket. High-detail sci-fi.
    `;

  console.log('--- STARTING ULTIMATE LOAD TEST (30 ASSETS) ---');
  const start = Date.now();

  try {
    const response = await fetch('http://localhost:3000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: prompt.trim() })
    });

    const data = await response.json();
    const end = Date.now();

    console.log('------------------------------------');
    console.log(`TOTAL ASSETS: ${data.metadata?.total || 0}`);
    console.log(`SUCCESSFUL:   ${data.metadata?.success || 0}`);
    console.log(`SERVER TIME:  ${data.metadata?.durationSeconds || 'N/A'}s`);
    console.log('------------------------------------');

    if (data.results) {
      data.results.forEach((res, i) => {
        const typeLabel = res.url?.endsWith('.mp4') ? 'VIDEO' : 'IMAGE/PNG';
        console.log(`[Task ${i + 1}] ${res.type} [${typeLabel}]:`);
        console.log(`   -> URL: ${res.url}`);
        if (res.posterUrl) console.log(`   -> Poster: ${res.posterUrl}`);
      });
    }
  } catch (e) {
    console.error('CRITICAL ERROR: Connection to generation engine failed.', e.message);
  }
}

runUltimateTest();