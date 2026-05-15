module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const tokenRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/qbo_tokens?id=eq.1&limit=1`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  const tokens = await tokenRes.json();
  let tokenRow = tokens[0];
  if (!tokenRow) return res.status(401).json({ error: 'Not connected to QuickBooks' });

  // Refresh access token if expired or expiring within 60 seconds
  if (!tokenRow.expires_at || new Date(tokenRow.expires_at) <= new Date(Date.now() + 60 * 1000)) {
    const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    const refreshRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRow.refresh_token
      })
    });
    const refreshed = await refreshRes.json();
    if (!refreshed.access_token) {
      return res.status(401).json({ error: 'QuickBooks token refresh failed', detail: refreshed });
    }
    tokenRow = {
      ...tokenRow,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokenRow.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    };
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/qbo_tokens?id=eq.1`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expires_at: tokenRow.expires_at
      })
    });
  }

  const { order } = req.body;
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${tokenRow.realm_id}`;
  const headers = {
    'Authorization': `Bearer ${tokenRow.access_token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Find item ID
  const itemRes = await fetch(
    `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Name = 'Wholesale Products'")}&minorversion=65`,
    { headers }
  );
  const itemData = await itemRes.json();
  const itemId = itemData.QueryResponse?.Item?.[0]?.Id;
  if (!itemId) return res.status(500).json({ error: 'Item "Wholesale Products" not found in QBO' });

  // Find or create customer
  const safeName = order.clientName.replace(/'/g, "''");
  const queryRes = await fetch(
    `${baseUrl}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}'`)}&minorversion=65`,
    { headers }
  );
  const queryData = await queryRes.json();
  let customerId = queryData.QueryResponse?.Customer?.[0]?.Id;
  let customerEmail = queryData.QueryResponse?.Customer?.[0]?.PrimaryEmailAddr?.Address || order.clientEmail || '';

  if (!customerId) {
    const createRes = await fetch(`${baseUrl}/customer?minorversion=65`, {
      method: 'POST', headers,
      body: JSON.stringify({
        DisplayName: order.clientName,
        BillAddr: { Line1: order.clientAddress || '' },
        PrimaryEmailAddr: { Address: order.clientEmail || '' }
      })
    });
    const createData = await createRes.json();
    customerId = createData.Customer?.Id;
    customerEmail = order.clientEmail || '';
  }

  if (!customerId) return res.status(500).json({ error: 'Could not create customer in QBO' });

  const dueDate = new Date(order.deliveryDate);
  dueDate.setDate(dueDate.getDate() + 15);

  const invoice = {
    CustomerRef: { value: customerId },
    TxnDate: new Date().toISOString().split('T')[0],
    DueDate: dueDate.toISOString().split('T')[0],
    PrivateNote: `Wholesale Order ${order.id}`,
    BillEmail: { Address: customerEmail },
    EmailStatus: 'NeedToSend',
    Line: [
      ...order.items.map((item, i) => ({
        LineNum: i + 1,
        Description: `${item.name}`,
        Amount: parseFloat((item.price * item.qty).toFixed(2)),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: itemId, name: 'Wholesale Products' },
          Qty: item.qty,
          UnitPrice: item.price
        }
      })),
      ...(order.deliveryFee > 0 ? [{
        LineNum: order.items.length + 1,
        Description: 'Delivery fee',
        Amount: order.deliveryFee,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: itemId, name: 'Wholesale Products' },
          Qty: 1,
          UnitPrice: order.deliveryFee
        }
      }] : [])
    ]
  };

  const invRes = await fetch(`${baseUrl}/invoice?minorversion=65`, {
    method: 'POST', headers,
    body: JSON.stringify(invoice)
  });
  const invData = await invRes.json();

  if (!invRes.ok) {
    console.error('QBO Invoice Error:', JSON.stringify(invData, null, 2));
  }

  if (invRes.ok && invData.Invoice?.Id) {
    await fetch(
      `${baseUrl}/invoice/${invData.Invoice.Id}/send?sendTo=${encodeURIComponent(customerEmail)}&minorversion=65`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' } }
    );
  }

  res.status(invRes.ok ? 200 : 400).json(invData);
};
