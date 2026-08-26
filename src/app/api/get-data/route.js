import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!verifyToken(request)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing session token.' },
      { status: 401 }
    );
  }

  try {
    const { db } = await connectToDatabase();

    // 1. Fetch clinic configuration & settings
    const configDoc = await db.collection('clinic_config').findOne({ key: 'hos_config' });

    // 2. Fetch all patients
    const patients = await db.collection('patients').find({}).toArray();

    // 3. Fallback for legacy monolithic document if new collections are empty
    if (!configDoc && (!patients || patients.length === 0)) {
      const legacyDoc = await db.collection('clinic_data').findOne({ key: 'hos_data' });
      if (legacyDoc && legacyDoc.value) {
        return NextResponse.json({ data: legacyDoc.value }, { status: 200 });
      }
      return NextResponse.json({ data: { patients: [] } }, { status: 200 });
    }

    const cleanPatients = (patients || []).map(({ _id, ...p }) => ({
      id: p.id || _id,
      ...p,
    }));

    const assembledData = {
      ...(configDoc && configDoc.value ? configDoc.value : {}),
      patients: cleanPatients,
    };

    return NextResponse.json({ data: assembledData }, { status: 200 });
  } catch (err) {
    console.error('MongoDB fetch error:', err);
    return NextResponse.json(
      { error: 'Failed to read data from database: ' + err.message },
      { status: 500 }
    );
  }
}
