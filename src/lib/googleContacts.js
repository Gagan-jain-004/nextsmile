/**
 * Google Contacts (People API) Integration for The Home of Smiles
 * 
 * Synchronizes newly registered patients to Google Contacts seamlessly & fail-safely.
 * - Non-blocking: Even if Google API fails/offline/unconfigured, patient registration is never impacted.
 * - Supports multiple patients with the same phone number (family accounts).
 */

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Retrieves a fresh Google OAuth2 Access Token using the stored Refresh Token.
 */
async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    // Graceful exit if Google integration is not yet configured in .env.local
    return null;
  }

  // Use cached token if still valid (with 60s safety buffer)
  const now = Date.now();
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[Google Contacts] Token refresh failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    if (data && data.access_token) {
      cachedAccessToken = data.access_token;
      tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
      return cachedAccessToken;
    }
  } catch (err) {
    console.warn('[Google Contacts] Error fetching access token:', err.message);
  }

  return null;
}

/**
 * Creates a new contact in Google Contacts for the registered patient.
 * 
 * @param {Object} patient - Patient record containing name, phone, id, age, etc.
 * @returns {Promise<{success: boolean, contactId?: string, error?: string}>}
 */
export async function syncPatientToGoogleContacts(patient) {
  if (!patient || !patient.name || !patient.phone) {
    return { success: false, reason: 'invalid_patient_data' };
  }

  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
      return { success: false, reason: 'unconfigured_or_auth_failed' };
    }

    const cleanPhone = String(patient.phone).replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, reason: 'invalid_phone' };
    }

    const formattedPhone = '+91' + cleanPhone;
    const patientName = String(patient.name).trim();
    const patientId = patient.id || patient._id || '';

    // Split name into given and family names if available
    const nameParts = patientName.split(' ');
    const givenName = nameParts[0] || patientName;
    const familyName = nameParts.slice(1).join(' ') || '';

    const contactPayload = {
      names: [
        {
          givenName: givenName,
          familyName: familyName,
        },
      ],
      phoneNumbers: [
        {
          value: formattedPhone,
          type: 'mobile',
        },
      ],
      organizations: [
        {
          name: 'The Home of Smiles Dental Clinic',
          title: 'Patient' + (patientId ? ' (' + patientId + ')' : ''),
        },
      ],
      userDefined: [
        {
          key: 'Clinic',
          value: 'The Home of Smiles Dental Clinic',
        },
        ...(patientId ? [{ key: 'Patient ID', value: patientId }] : []),
      ],
      biographies: [
        {
          value: `Patient at The Home of Smiles Dental Clinic\nID: ${patientId}\nRegistered: ${new Date().toLocaleDateString('en-IN')}`,
          contentType: 'TEXT_PLAIN',
        },
      ],
    };

    const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contactPayload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[Google Contacts] Contact creation returned status:', res.status, errText);
      return { success: false, error: errText };
    }

    const createdContact = await res.json();
    const resourceName = createdContact.resourceName || createdContact.etag;
    console.log(`[Google Contacts] Successfully synced: ${patientName} (${formattedPhone}) -> ${resourceName}`);

    return { success: true, contactId: resourceName };
  } catch (err) {
    // Complete fail-safe catch: Never propagate error or break caller
    console.warn('[Google Contacts] Sync failed gracefully:', err.message);
    return { success: false, error: err.message };
  }
}
