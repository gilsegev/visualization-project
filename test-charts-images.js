async function testStressLevel() {
  const prompt = `
Build a comprehensive course on Small Business Acquisition. 

STAGE 1: SEARCH
- IMAGE 1: A determined entrepreneur in a modern home office at midnight, illuminated by a single desk lamp, surrounded by physical folders and a laptop screen showing business listings. Cinematic, 35mm lens, high-detail.
- CHART 1: The Deal Funnel: Labels [Search, Review, LOI, Close] with Values [100, 20, 5, 1].

STAGE 2: FINANCIAL REVIEW
- IMAGE 2: Macro close-up of a magnifying glass focusing on the word 'PROFIT' on a printed balance sheet. Sharp focus on text, soft bokeh background, office lighting.
- CHART 2: EBITDA Growth: Labels [2023, 2024, 2025] with Values [450000, 600000, 820000].
- IMAGE 3: Professional meeting between a buyer and a seller in a sleek, glass-walled conference room. Wide angle, daylight, corporate aesthetic.
- CHART 3: Expense Breakdown: Labels [Operations, Payroll, Rent, Marketing] with Values [40, 35, 15, 10].

STAGE 3: THE LOI
- IMAGE 4: A premium fountain pen resting on a formal 'Letter of Intent' document on a leather desk pad. Shallow depth of field, warm professional lighting.
- CHART 4: Offer Success Rates: Labels [Accepted, Countered, Rejected] with Values [15, 60, 25].
- IMAGE 5: Two people in business casual attire shaking hands in front of a local brick-and-mortar retail storefront at sunset. Wide shot, warm colors.
- CHART 5: Negotiation Timeline: Labels [Initial, Counter, Final] with Values [10, 15, 7] in days.

STAGE 4: FUNDING
- IMAGE 6: A digital tablet on a marble desk displaying a 'Transfer Successful' notification next to a clean cup of espresso. High-end minimalist aesthetic.
- CHART 6: Capital Stack: Labels [SBA Loan, Seller Note, Buyer Equity] with Values [75, 10, 15].
- IMAGE 7: Over-the-shoulder shot of an investor in a business lounge reviewing a pitch deck on an iPad. Soft natural light, 8k resolution.
- CHART 7: Interest Rate Trend: Labels [Q1, Q2, Q3, Q4] with Values [6.5, 7.2, 8.1, 8.5].

STAGE 5: CLOSING
- IMAGE 8: Close-up of a pair of brass office keys with a 'New Owner' leather keychain being handed from one person to another. Sharp focus, professional blur.
- CHART 8: Closing Costs: Labels [Legal, Escrow, Diligence, Insurance] with Values [8000, 3000, 12000, 2500].
- IMAGE 9: A celebratory toast with two glasses of water in a bright, high-rise boardroom overlooking a city skyline. High contrast, clean composition.
- CHART 9: Revenue Forecast: Labels [Year 1, Year 2, Year 3] with Values [1200000, 1500000, 2100000].
- IMAGE 10: A hand using a silver laptop trackpad to apply a final digital signature to a contract. Top-down view, ultra-modern workspace.
- CHART 10: Market Share: Labels [Target Business, Top Competitor, Others] with Values [12, 45, 43].
    `;

  console.log('--- STARTING STRESS TEST ---');
  console.log('Sending 20-task course content...');

  const start = Date.now();
  try {
    const response = await fetch('http://localhost:3000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: prompt })
    });

    const data = await response.json();
    const end = Date.now();

    console.log('Response Status:', response.status);
    if (data.results) {
      console.log(`Successfully processed ${data.metadata.success}/${data.metadata.total} tasks.`);
      console.log(`Server-side duration: ${data.metadata.durationSeconds}s`);

      // Log URLs for visual verification
      data.results.forEach((res, i) => {
        if (res.url) {
          console.log(`[Task ${i + 1}] ${res.type}: ${res.url}`);
        } else {
          console.log(`[Task ${i + 1}] FAILED: ${res.error}`);
        }
      });
    } else {
      console.log('Unexpected Response Format:', data);
    }

    console.log(`Total Client-Side Time: ${((end - start) / 1000).toFixed(2)}s`);

  } catch (e) {
    console.error('Stress test failed to connect to server:', e.message);
  }
}

// Ensure the server has a few seconds to breathe before hitting it
setTimeout(testStressLevel, 3000);