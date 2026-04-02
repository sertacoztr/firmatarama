export const config = { maxDuration: 30 };

async function googleSearch(query, apiKey, cx) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=3`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.origin; // https://example.com
  } catch { return url; }
}

function extractEmail(text) {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

function extractPhone(text) {
  // Match international phone numbers
  const m = text.match(/(\+?[\d\s\-().]{8,20})/);
  if (!m) return null;
  const clean = m[0].replace(/\s+/g, ' ').trim();
  // Must have at least 7 digits
  if ((clean.match(/\d/g) || []).length < 7) return null;
  return clean;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companyName, country } = req.body || {};
  if (!companyName) return res.status(400).json({ error: 'companyName required' });

  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCX  = process.env.GOOGLE_CX;
  if (!googleKey || !googleCX) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY or GOOGLE_CX not set' });
  }

  try {
    const query = country
      ? `"${companyName}" ${country} official website`
      : `"${companyName}" official website`;

    const data = await googleSearch(query, googleKey, googleCX);
    const items = data.items || [];

    if (items.length === 0) {
      return res.status(200).json({
        website: null, phone: null, email: null,
        confidence: 'low', notes: 'No results found'
      });
    }

    // Best result = first item that's not a directory/social site
    const blacklist = ['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com',
                       'youtube.com', 'wikipedia.org', 'yellowpages', 'yelp.com',
                       'kompass.com', 'europages.', 'dnb.com', 'zoominfo.com'];

    let best = items.find(item =>
      !blacklist.some(b => item.link.includes(b))
    ) || items[0];

    const website = extractDomain(best.link);

    // Try to extract phone/email from snippet
    const snippet = (best.snippet || '') + ' ' + (best.pagemap?.metatags?.[0]?.['og:description'] || '');
    const phone = extractPhone(snippet);
    const email = extractEmail(snippet);

    // Confidence based on how well the name matches
    const nameWords = companyName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const titleLower = (best.title || '').toLowerCase();
    const linkLower = best.link.toLowerCase();
    const matchCount = nameWords.filter(w => titleLower.includes(w) || linkLower.includes(w)).length;
    const confidence = matchCount >= 2 ? 'high' : matchCount === 1 ? 'medium' : 'low';

    return res.status(200).json({ website, phone, email, confidence, notes: '' });

  } catch (err) {
    console.error('enrich error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
