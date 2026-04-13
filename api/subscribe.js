export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const [firstName, ...rest] = name.trim().split(' ');
  const lastName = rest.join(' ') || '';
  const today = new Date().toISOString().split('T')[0];
  const errors = [];

  // Subscribe to Beehiiv
  try {
    await fetch(
      `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BEEHIIV_API_KEY}`,
        },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          reactivate_existing: false,
          send_welcome_email: true,
          utm_source: 'wwm-waitlist',
          utm_medium: 'signup-form',
        }),
      }
    );
  } catch (err) {
    errors.push(`Beehiiv: ${err.message}`);
  }

  // Upsert HubSpot contact
  try {
    const hsToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    if (hsToken) {
      const hsApi = 'https://api.hubapi.com/crm/v3/objects/contacts';

      const searchRes = await fetch(`${hsApi}/search`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
          limit: 1,
        }),
      });
      const searchData = await searchRes.json();
      const existingId = searchData.results?.[0]?.id ?? null;

      if (existingId) {
        await fetch(`${hsApi}/${existingId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { wwm_lead_source: 'wwm-waitlist', wwm_last_meaningful_touch: today },
          }),
        });
      } else {
        await fetch(hsApi, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: {
              email,
              firstname: firstName,
              lastname: lastName,
              lifecyclestage: 'lead',
              hs_lead_status: 'OPEN',
              wwm_lead_source: 'wwm-waitlist',
              wwm_last_meaningful_touch: today,
            },
          }),
        });
      }
    }
  } catch (err) {
    errors.push(`HubSpot: ${err.message}`);
  }

  return res.status(200).json({ success: true });
}
