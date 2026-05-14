module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const tokenRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/qbo_tokens?id=eq.1&limit=1`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  const tokens = await tokenRes.json();
  const tokenRow = tokens[0];
  if (!tokenRow) return res.status(401).json({ error: 'Not connected to QuickBooks' });

  const { order } = req.body;
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${tokenRow.realm_id}`;
  const headers = {
    'Authorization': `Bearer ${tokenRow.access_token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Find or create customer
  const queryRes = await fetch(
    `${baseUrl}/query?query=SELECT * FROM Customer WHERE DisplayName = '${order.clientName.replace("'", "\\'")}' &minorversion=65`,
    { headers }
  );
  const queryData = await queryRes.json();
  let customerId = queryData.QueryResponse?.Customer?.[0]?.Id;

  if (!customerId) {
    const createRes = await fetch(`${baseUrl}/customer?minorversion=65`, {
      method: 'POST', headers,
      body: JSON.stringify({
        DisplayName: order.clientName,
        BillAddr: { Line1: order.clientAddress || '' }
      })
    });
    const createData = await createRes.json();
    customerId = createData.Customer?.Id;
  }

  if (!customerId) return res.status(500).json({ error: 'Could not create customer in QBO' });

  // Create Invoice Net 15
  const dueDate = new Date(order.deliveryDate);
  dueDate.setDate(dueDate.getDate() + 15);

  const invoice = {
    CustomerRef: { value: customerId },
    TxnDate: new Date().toISOString().split('T')[0],
    DueDate: dueDate.toISOString().split('T')[0],
    PrivateNote: `Wholesale Order ${order.id}`,
    Line: [
      ...order.items.map((item, i) => ({
        LineNum: i + 1,
        Description: item.name,
        Amount: parseFloat((item.price * item.qty).toFixed(2)),
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
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: order.deliveryFee,
          ItemRef: { value: '1', name: 'Services' }
        }
      }] : [])
    ]
  };

  const invRes = await fetch(`${baseUrl}/invoice?minorversion=65`, {
    method: 'POST', headers,
    body: JSON.stringify(invoice)
  });
  const invData = await invRes.json();
  res.status(invRes.ok ? 200 : 400).json(invData);
};
