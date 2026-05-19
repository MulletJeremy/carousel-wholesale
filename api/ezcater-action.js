module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { orderId, action } = req.body; // action: 'accept' | 'reject' | 'import'
  if (!orderId || !action) return res.status(400).json({ error: 'Missing orderId or action' });

  // Update status in Supabase
  const newStatus = action === 'accept' ? 'confirmée' : action === 'reject' ? 'rejetée' : null;
  const patch = {};
  if (newStatus) patch.status = newStatus;
  if (action === 'import') patch.imported = true;

  if (Object.keys(patch).length > 0) {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/ezcater_orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patch)
    });
  }

  // Notify EZCater via GraphQL if accepting or rejecting
  if ((action === 'accept' || action === 'reject') && process.env.EZCATER_API_TOKEN) {
    const mutation = action === 'accept'
      ? `mutation { acceptOrder(input: { uuid: "${orderId}" }) { errors } }`
      : `mutation { rejectOrder(input: { uuid: "${orderId}", reason: "Unable to fulfill" }) { errors } }`;

    try {
      await fetch('https://api.ezcater.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.EZCATER_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: mutation })
      });
    } catch (e) {
      console.warn('EZCater GraphQL call failed:', e.message);
    }
  }

  res.status(200).json({ ok: true });
};
