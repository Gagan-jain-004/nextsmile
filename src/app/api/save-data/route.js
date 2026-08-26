import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function POST(request) {
  if (!verifyToken(request)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing session token.' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action, config, patients, data, section, value, item, patientId, field } = body || {};

    const { db } = await connectToDatabase();

    // ── ACTION 1: Initialize Import ──
    if (action === 'init_import') {
      await db.collection('patients').deleteMany({});
      await db.collection('patient_images').deleteMany({});

      const configCollection = db.collection('clinic_config');
      await configCollection.updateOne(
        { key: 'hos_config' },
        { $set: { value: config || {} } },
        { upsert: true }
      );

      await db.collection('clinic_data').deleteMany({});
      return NextResponse.json({ success: true, message: 'Database initialized for import' });
    }

    // ── ACTION 2: Save / Clear Specific Config Section ──
    if (action === 'save_config_section') {
      if (section) {
        await db.collection('clinic_config').updateOne(
          { key: 'hos_config' },
          { $set: { [`value.${section}`]: value } },
          { upsert: true }
        );
      }
      return NextResponse.json({ success: true });
    }

    // ── ACTION 3: Append Item to Config Array (e.g. alignerCases, fmrCases) ──
    if (action === 'append_config_item') {
      if (section && item) {
        await db.collection('clinic_config').updateOne(
          { key: 'hos_config' },
          { $push: { [`value.${section}`]: item } },
          { upsert: true }
        );
      }
      return NextResponse.json({ success: true });
    }

    // ── ACTION 4: Import Patient Skeleton (No Heavy Media) ──
    if (action === 'import_chunk') {
      const patientList = patients || [];
      if (patientList.length > 0) {
        const patientCollection = db.collection('patients');
        const docs = patientList.map((p) => {
          const docId = p.id || 'PT' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
          return {
            _id: docId,
            ...p,
            id: docId,
          };
        });

        for (const doc of docs) {
          await patientCollection.replaceOne({ _id: doc._id }, doc, { upsert: true });
        }
      }
      return NextResponse.json({ success: true, inserted: patientList.length });
    }

    // ── ACTION 5: Append Media Item to Patient (images, xrayReports, signedConsents) ──
    if (action === 'append_patient_field_item') {
      if (patientId && field && item) {
        await db.collection('patients').updateOne(
          { $or: [{ id: patientId }, { _id: patientId }] },
          { $push: { [field]: item } }
        );
      }
      return NextResponse.json({ success: true });
    }

    // ── ACTION 6: Finalize Import ──
    if (action === 'finish_import') {
      const metaCollection = db.collection('meta');
      await metaCollection.updateOne(
        { key: 'last_saved' },
        { $set: { value: new Date().toISOString() } },
        { upsert: true }
      );
      return NextResponse.json({ success: true, message: 'Import finalized' });
    }

    // ── DEFAULT: Standard Full / Partial Save ──
    if (data) {
      const { patients: ptList = [], ...otherFields } = data;

      const patientCollection = db.collection('patients');
      await patientCollection.deleteMany({});

      if (ptList.length > 0) {
        const chunkSize = 10;
        for (let i = 0; i < ptList.length; i += chunkSize) {
          const chunk = ptList.slice(i, i + chunkSize).map((p) => {
            const docId = p.id || 'PT' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
            return {
              _id: docId,
              ...p,
              id: docId,
            };
          });
          await patientCollection.insertMany(chunk, { ordered: false });
        }
      }

      const configCollection = db.collection('clinic_config');
      await configCollection.updateOne(
        { key: 'hos_config' },
        { $set: { value: otherFields } },
        { upsert: true }
      );

      const metaCollection = db.collection('meta');
      await metaCollection.updateOne(
        { key: 'last_saved' },
        { $set: { value: new Date().toISOString() } },
        { upsert: true }
      );

      return NextResponse.json({ success: true, count: ptList.length });
    }

    return NextResponse.json({ error: 'Missing valid action or data payload' }, { status: 400 });
  } catch (err) {
    console.error('MongoDB save error:', err);
    return NextResponse.json(
      { error: 'Failed to write data to database: ' + err.message },
      { status: 500 }
    );
  }
}
