/**
 * Generates recurring (standing) orders for the next 14 days.
 * Called daily by Vercel cron at 6 AM UTC, or manually from the admin dashboard.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json'
  };

  // Load all standing orders
  const ordersRes = await fetch(
    `${SUPA_URL}/rest/v1/orders?type=eq.standing&order=placed_at.desc`,
    { headers }
  );
  const allStanding = await ordersRes.json();

  if (!Array.isArray(allStanding) || !allStanding.length) {
    return res.status(200).json({ generated: [], message: 'No standing orders found' });
  }

  // Get the most recent standing order per client (acts as the template)
  const templateByClient = {};
  for (const o of allStanding) {
    if (!templateByClient[o.client_id]) templateByClient[o.client_id] = o;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const DAYS_AHEAD = 14;
  const generated = [];

  for (const template of Object.values(templateByClient)) {
    const recurringDays = template.recurring_days;
    if (!Array.isArray(recurringDays) || !recurringDays.length) continue;

    for (let i = 1; i <= DAYS_AHEAD; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dow = date.getDay();

      if (!recurringDays.includes(dow)) continue;

      const ds = date.toISOString().split('T')[0];

      // Check if order already exists for this client + date
      const existsRes = await fetch(
        `${SUPA_URL}/rest/v1/orders?client_id=eq.${encodeURIComponent(template.client_id)}&delivery_date=eq.${ds}&select=id`,
        { headers }
      );
      const existing = await existsRes.json();
      if (existing.length > 0) continue;

      // Generate a unique order ID: PO-YYYYMMDD-XXX
      const datePart = ds.replace(/-/g, '');
      const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
      const newId = `PO-${datePart}-${rand}`;

      const newOrder = {
        id: newId,
        client_id: template.client_id,
        client_name: template.client_name,
        client_address: template.client_address || '',
        delivery_date: ds,
        delivery_type: template.delivery_type || 'delivery',
        delivery_window: template.delivery_window || '',
        items: template.items,
        subtotal: template.subtotal,
        delivery_fee: template.delivery_fee,
        total: template.total,
        status: 'en attente',
        type: 'standing',
        recurring_days: recurringDays,
        placed_at: new Date().toISOString(),
        notes: template.notes || ''
      };

      const insertRes = await fetch(`${SUPA_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(newOrder)
      });

      if (insertRes.ok || insertRes.status === 201) {
        generated.push(newId);
      } else {
        const err = await insertRes.text();
        console.error(`Failed to insert ${newId}:`, err);
      }
    }
  }

  res.status(200).json({ generated, total: generated.length });
};
