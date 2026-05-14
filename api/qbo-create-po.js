module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const supa = require('@supabase/supabase-js').createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY
  );
  const { data: tokenRow } = await supa.from('qbo_tokens').select('*').eq('id',1).single();
  if (!tokenRow) return res.status(401).json({ error: 'Not connected to QuickBooks' });

  const { order } = req.body;
  const baseUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${tokenRow.realm_id}`;
  const headers = {
    'Authorization': `Bearer ${tokenRow.access_token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // 1. Find or create customer
  const queryRes = await fetch(`${baseUrl}/query?query=SELECT * FROM Customer WHERE DisplayName = '${order.clientName}'&minorversion=65`, { headers });
  const queryData = await queryRes.json();
  let customerId = queryData.QueryResponse?.Customer?.[0]?.Id;

  if (!customerId) {
    const createRes = await fetch(`${baseUrl}/customer?minorversion=65`, {
      method: 'POST', headers,
      body: JSON.stringify({ DisplayName: order.clientName, BillAddr: { Line1: order.clientAddress } })
    });
    const createData = await createRes.json();
    customerId = createData.Customer?.Id;
  }

  if (!customerId) return res.status(500).json({ error: 'Could not create customer' });

  // 2. Create Invoice
  const dueDate = new Date(order.deliveryDate);
  dueDate.setDate(dueDate.getDate() + 15);

  const invoice = {
    CustomerRef: { value: customerId },
    TxnDate: new Date().toISOString().split('T')[0],
    DueDate: dueDate.toISOString().split('T')[0],
    PrivateNote: `Order ${order.id} — Wholesale`,
    Line: [
      ...order.items.map((item, i) => ({
        LineNum: i + 1,
        Description: item.name,
        Amount: item.price * item.qty,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: item.qty,
          UnitPrice: item.price,
          ItemRef: { value: '1', name: 'Services' }
        }
      })),
      ...(order.deliveryFee > 0 ? [{
        LineNum: order.items.length + 1,
        Description: 'Delivery fee',
        Amount: order.deliveryFee,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { Qty: 1, UnitPrice: order.deliveryFee, ItemRef: { value: '1', name: 'Services' } }
      }] : [])
    ]
  };

  const invRes = await fetch(`${baseUrl}/invoice?minorversion=65`, {
    method: 'POST', headers, body: JSON.stringify(invoice)
  });
  const invData = await invRes.json();
  res.status(invRes.ok ? 200 : 400).json(invData);
};
