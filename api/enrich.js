export const config = { maxDuration: 60 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callClaude(apiKey, companyName, country, attempt = 1) {
  const prompt = `Search the web and find contact information for this company:

Company: "${companyName}"
Country: "${country || 'Unknown'}"

Find their official website, phone number, and email address. Respond with ONLY a valid JSON object (no markdown, no backticks, no explanation):
{"website":"https://example.com","phone":"+1 555 123 4567","email":"info@example.com","confidence":"high","notes":""}

Rules:
- website: full URL with https://, or null if not found
- phone: include country code if possible, or null  
- email: prefer info@, contact@, or sales@, or null
- confidence: "high" if official site confirmed, "medium" if fairly sure, "low" if uncertain
- Return ONLY the JSON object.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (response.status === 429) {
    if (attempt >= 3) throw new Error('Rate limit: too many retries');
    await sleep(attempt * 5000);
    return callClaude(apiKey, companyName, country, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companyName, country } = req.body || {};
  if (!companyName) return res.status(400).json({ error: 'companyName required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const data = await callClaude(apiKey, companyName, country);

    const allText = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    let result = null;
    const patterns = [
      /\{"website"[\s\S]*?\}(?=\s*$)/m,
      /\{[^{}]*"website"[^{}]*\}/,
      /\{[\s\S]*?"confidence"[\s\S]*?\}/,
    ];

    for (const p of patterns) {
      const m = allText.match(p);
      if (m) { try { result = JSON.parse(m[0]); break; } catch {} }
    }

    if (!result) {
      const m = allText.match(/\{[\s\S]*?\}/);
      if (m) { try { result = JSON.parse(m[0]); } catch {} }
    }

    if (!result) {
      result = { website: null, phone: null, email: null, confidence: 'low', notes: 'Parse failed' };
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('enrich error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
