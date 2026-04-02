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

  const prompt = `I need to find contact information for a company. Please search the web and find:
- Official website URL
- Phone number (with country code if possible)
- Official email address (general contact, info@, sales@, etc.)

Company: "${companyName}"
Country: "${country || 'Unknown'}"

Search for this company online and return ONLY a JSON object with these exact fields:
{
  "website": "https://...",
  "phone": "+XX XXX XXX XXXX",
  "email": "contact@company.com",
  "confidence": "high/medium/low",
  "notes": "any important notes"
}

Rules:
- If you find the official website, use it. If not sure, put null.
- For phone, prefer the main office number shown on their website.
- For email, prefer info@, contact@, or sales@ addresses shown on their website.
- Set confidence to "high" if you found their actual website, "medium" if you're fairly sure, "low" if uncertain.
- If you cannot find something, use null for that field.
- Return ONLY the JSON object, no other text.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-01-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
      return res.status(500).json({ error: 'Claude API error', details: err });
    }

    const data = await response.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    const rawText = textBlock?.text || '';

    // Extract JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({
        website: null, phone: null, email: null,
        confidence: 'low', notes: 'Could not parse response'
      });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
