export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companyName, country } = req.body || {};
  if (!companyName) return res.status(400).json({ error: 'companyName required' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_API_KEY not set' });

  try {
    const query = `${companyName} ${country || ''}`.trim();
    
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress,places.businessStatus'
      },
      body: JSON.stringify({ textQuery: query })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Places API ${response.status}: ${err.slice(0, 200)}` });
    }

    const data = await response.json();
    const places = data.places || [];

    if (places.length === 0) {
      return res.status(200).json({ website: null, phone: null, email: null, confidence: 'low', notes: 'No results' });
    }

    const best = places[0];
    const website = best.websiteUri || null;
    const phone = best.nationalPhoneNumber || null;

    // Confidence based on name match
    const nameWords = companyName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const displayName = (best.displayName?.text || '').toLowerCase();
    const matchCount = nameWords.filter(w => displayName.includes(w)).length;
    const confidence = matchCount >= 2 ? 'high' : matchCount === 1 ? 'medium' : 'low';

    return res.status(200).json({
      website,
      phone,
      email: null,
      confidence,
      notes: best.formattedAddress || ''
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
