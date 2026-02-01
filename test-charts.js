async function testStressLevel() {
  const prompt = `
Build a comprehensive course on Small Business Acquisition. 

STAGE 1: ANIMATED TRENDS (10 VIDEOS + POSTERS)
- CHART 1: [ANIMATED VIDEO] The Deal Funnel: Labels [Search, Review, LOI, Close] with Values [100, 20, 5, 1].
- CHART 2: [ANIMATED VIDEO] EBITDA Growth: Labels [2023, 2024, 2025] with Values [450000, 600000, 820000].
- CHART 3: [ANIMATED VIDEO] Expense Breakdown: Labels [Operations, Payroll, Rent, Marketing] with Values [40, 35, 15, 10].
- CHART 4: [ANIMATED VIDEO] Offer Success Rates: Labels [Accepted, Countered, Rejected] with Values [15, 60, 25].
- CHART 5: [ANIMATED VIDEO] Negotiation Timeline: Labels [Initial, Counter, Final] with Values [10, 15, 7] in days.
- CHART 6: [ANIMATED VIDEO] Capital Stack: Labels [SBA Loan, Seller Note, Buyer Equity] with Values [75, 10, 15].
- CHART 7: [ANIMATED VIDEO] Interest Rate Trend: Labels [Q1, Q2, Q3, Q4] with Values [6.5, 7.2, 8.1, 8.5].
- CHART 8: [ANIMATED VIDEO] Closing Costs: Labels [Legal, Escrow, Diligence, Insurance] with Values [8000, 3000, 12000, 2500].
- CHART 9: [ANIMATED VIDEO] Revenue Forecast: Labels [Year 1, Year 2, Year 3] with Values [1200000, 1500000, 2100000].
- CHART 10: [ANIMATED VIDEO] Market Share: Labels [Target Business, Top Competitor, Others] with Values [12, 45, 43].

STAGE 2: STATIC SNAPSHOTS (10 PNGs)
- CHART 11: [STATIC PNG] Rent Breakdown: Labels [Base, CAM, Tax] with Values [3000, 500, 500].
- CHART 12: [STATIC PNG] Inventory Mix: Labels [Raw, WIP, Finished] with Values [20, 30, 50].
- CHART 13: [STATIC PNG] Debt Schedule: Labels [Y1, Y2, Y3, Y4, Y5] with Values [100, 80, 60, 40, 20].
- CHART 14: [STATIC PNG] Valuation Multiples: Labels [EBITDA, Revenue, SDE] with Values [4.5, 1.2, 3.8].
- CHART 15: [STATIC PNG] Diligence Check: Labels [Legal, Financial, HR, IT] with Values [25, 40, 20, 15].
- CHART 16: [STATIC PNG] Seller Transition: Labels [Training, Consulting, Exited] with Values [3, 6, 12] in months.
- CHART 17: [STATIC PNG] Marketing ROI: Labels [Google, Meta, Direct] with Values [3.5, 2.8, 5.2].
- CHART 18: [STATIC PNG] Liquidity Ratio: Labels [Current, Quick] with Values [1.8, 1.2].
- CHART 19: [STATIC PNG] Break-Even Point: Labels [Fixed, Variable] with Values [50000, 25000].
- CHART 20: [STATIC PNG] Tax Liability: Labels [Federal, State, Local] with Values [15000, 5000, 2000].
    `;

  console.log('--- STARTING 20-TASK DUAL-FORMAT STRESS TEST ---');
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
    console.log(`Successfully processed ${data.metadata?.success}/${data.metadata?.total} tasks.`);
    console.log(`Server-side duration: ${data.metadata?.durationSeconds}s`);

    data.results.forEach((res, i) => {
      if (res.url) {
        const isVid = res.url.endsWith('.mp4');
        console.log(`[Task ${i + 1}] ${res.type} [${isVid ? 'VIDEO' : 'STATIC'}]:`);
        console.log(`   -> URL: ${res.url}`);
        if (res.posterUrl) console.log(`   -> Poster: ${res.posterUrl}`);
      } else {
        console.log(`[Task ${i + 1}] FAILED: ${res.error}`);
      }
    });

    console.log(`Total Client-Side Time: ${((end - start) / 1000).toFixed(2)}s`);
  } catch (e) {
    console.error('Connection failed:', e.message);
  }
}

testStressLevel();