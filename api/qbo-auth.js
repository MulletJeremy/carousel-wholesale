module.exports = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: process.env.QBO_REDIRECT_URI,
    state: 'carousel'
  });
  res.redirect(`https://appcenter.intuit.com/connect/oauth2?${params}`);
};
