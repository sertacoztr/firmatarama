export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companyName, country } = req.body;
  if (!companyName) return res.status(400).json({ error: 'companyName required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `Search the web and find contact information for this company:

Company: "${companyName}"
Country: "${country || 'Unknown'}"

Find their official website, phone number, and email address. Then respond with ONLY a valid JSON object like this (no markdown, no explanation):
{"website":"https://example.com","phone":"+1 555 123 4567","email":"info@example.com","confidence":"high","notes":""}

Rules:
- website: full URL with https://, or null if not found
- phone: include country code if possible, or null
- email: prefer info@, contact@, or sales@, or null
- confidence: "high" if official site found, "medium" if fairly sure, "low" if uncertain
- notes: brief note if something is unclear, otherwise empty string
- Return ONLY the JSON object. No markdown backticks, no extra text.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search'
        }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'Claude API error', details: err });
    }

    const data = await response.json();

    // Collect all text blocks (web search responses can have multiple)
    const allText = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Extract JSON - try strict match first, then loose
    let result = null;
    const strictMatch = allText.match(/\{[^{}]*"website"[^{}]*\}/);
    const looseMatch = allText.match(/\{[\s\S]*?\}/);
    const jsonStr = strictMatch ? strictMatch[0] : (looseMatch ? looseMatch[0] : null);

    if (jsonStr) {
      try {
        result = JSON.parse(jsonStr);
      } catch (e) {
        // JSON parse failed, fall through to default
      }
    }

    if (!result) {
      result = { website: null, phone: null, email: null, confidence: 'low', notes: 'No data found' };
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
