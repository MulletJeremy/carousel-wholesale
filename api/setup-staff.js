/**
 * One-time endpoint to create staff accounts in Supabase Auth + profiles table.
 * Call with: POST /api/setup-staff  { "secret": "<SETUP_SECRET>" }
 * Set SETUP_SECRET in Vercel environment variables before calling.
 * Delete or disable this file after running once.
 */
module.exports = async (req, res) => {
  // Accept GET (secret in query) or POST (secret in body) for ease of use
  const secret = req.method === 'GET'
    ? req.query.secret
    : req.body?.secret;
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_SERVICE = process.env.SUPABASE_SERVICE_KEY;

  const staff = [
    { email: 'kitchen@carousel.com',  password: 'kitchen2026', role: 'kitchen', name: 'Kitchen',       label: 'Cuisine (BOF)',    canMessage: false },
    { email: 'ben@carousel.com',       password: 'driver2026',  role: 'driver',  name: 'Ben',            label: 'Driver — Ben',     canMessage: false, deliveryDays: [2,3,4,5,6] },
    { email: 'nader@carousel.com',     password: 'nader2026',   role: 'driver',  name: 'Nader',          label: 'Driver — Nader',   canMessage: false, deliveryDays: [0,6] },
    { email: 'sales@carousel.com',     password: 'sales2026',   role: 'sales',   name: 'Sales Rep',      label: 'Sales Rep',        canMessage: true  },
    { email: 'jeremy@carousel-patisserie.com', password: 'Bernard17', role: 'ceo', name: 'Jeremy Mullet', label: 'CEO — Jeremy Mullet', canMessage: true },
  ];

  const results = [];

  for (const member of staff) {
    try {
      // Create auth user via admin API
      const authRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_SERVICE,
          'Authorization': `Bearer ${SUPA_SERVICE}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: member.email,
          password: member.password,
          email_confirm: true // auto-confirm
        })
      });
      const authData = await authRes.json();

      if (!authData.id) {
        results.push({ email: member.email, status: 'error', detail: authData });
        continue;
      }

      // Insert profile
      await fetch(`${SUPA_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_SERVICE,
          'Authorization': `Bearer ${SUPA_SERVICE}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          id: authData.id,
          email: member.email,
          role: member.role,
          name: member.name,
          company: null,
          label: member.label,
          can_message: member.canMessage,
          delivery_days: member.deliveryDays || null
        })
      });

      results.push({ email: member.email, status: 'created', id: authData.id });
    } catch (e) {
      results.push({ email: member.email, status: 'exception', detail: e.message });
    }
  }

  res.status(200).json({ results });
};
