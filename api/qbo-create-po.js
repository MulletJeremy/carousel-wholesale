module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const supa = require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: tokenRow } = await supa.from('qbo_tokens').select('*').eq('id', 1).single();
  if (!tokenRow) return res.status(401).json({ error: 'Not connected to QuickBooks' });
  const { order } = req.body;
  const poPayload = {
    VendorRef: { value: '1' },
    TxnDate: new Date().toISOString().split('T')[0],
    POStatus: 'Open',
    Line: order.items.map((item, i) => ({
      Id: String(i + 1),
      LineNum: i + 1,
      Amount: item.price * item.qty,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: '1' },
        BillableStatus: 'NotBillable'
      },
      Description: `${item.name} x${item.qty} @ $${item.price}`
    })),
    PrivateNote: `Order ${order.id} — ${order.clientName}`
  };
  const response = await fetch(
    `https://sandbox-quickbooks.api.intuit.com/v3/company/${tokenRow.realm_id}/purchaseorder?minorversion=65`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenRow.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(poPayload)
    }
  );
  const data = await response.json();
  res.status(response.ok ? 200 : 400).json(data);
};
