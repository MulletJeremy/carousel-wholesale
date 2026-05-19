module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const payload = req.body;
    // EZCater sends different event types; we handle orderSubmitted
    const event = payload.event || payload.type;
    const orderData = payload.data?.order || payload.order || payload;

    if (!orderData || !orderData.id) {
      return res.status(400).json({ error: 'Invalid payload — missing order data' });
    }

    const record = {
      id: String(orderData.id),
      event_name: orderData.event_name || orderData.eventName || orderData.name || 'EZCater Order',
      delivery_date: orderData.deliver_at
        ? new Date(orderData.deliver_at).toISOString().split('T')[0]
        : orderData.deliveryDate || null,
      delivery_address: typeof orderData.delivery_address === 'object'
        ? [orderData.delivery_address.street, orderData.delivery_address.city].filter(Boolean).join(', ')
        : orderData.delivery_address || orderData.deliveryAddress || '',
      items: Array.isArray(orderData.items) ? orderData.items.map(i => ({
        name: i.name || i.item_name || '',
        qty: i.quantity || i.qty || 1,
        unitPrice: parseFloat(i.unit_price || i.unitPrice || 0)
      })) : [],
      subtotal: parseFloat(orderData.subtotal || orderData.total || 0),
      status: 'en attente',
      notes: orderData.notes || orderData.instructions || '',
      imported: false,
      received_at: new Date().toISOString()
    };

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ezcater_orders`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase insert error:', err);
      return res.status(500).json({ error: 'Failed to store order', detail: err });
    }

    res.status(200).json({ received: true, orderId: record.id });
  } catch (e) {
    console.error('EZCater webhook error:', e);
    res.status(500).json({ error: e.message });
  }
};
