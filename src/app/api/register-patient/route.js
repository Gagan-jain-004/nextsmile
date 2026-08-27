import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

function dobToISO(str) {
  if (!str) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const p = str.split('/');
    return `${p[2]}-${p[1]}-${p[0]}`;
  }
  return str;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      name,
      phone,
      age,
      dob,
      gender,
      type = 'regular',
      address,
      complaint,
      medHistory,
    } = body || {};

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Patient name is required.' },
        { status: 400 }
      );
    }

    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      return NextResponse.json(
        { error: 'Valid 10-digit mobile number is required.' },
        { status: 400 }
      );
    }

    const { db } = await connectToDatabase();
    const patientCollection = db.collection('patients');

    // Check if patient already exists with this phone number
    const existing = await patientCollection.findOne({
      $or: [{ phone: cleanPhone }, { phone: phone.trim() }],
    });

    if (existing) {
      const patientId = existing.id || existing._id;
      return NextResponse.json({
        success: true,
        isExisting: true,
        patient: {
          ...existing,
          id: patientId,
          _id: patientId,
        },
        message: `Patient "${existing.name}" is already registered with this phone number.`,
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const docId =
      'PT' +
      Date.now().toString().slice(-6) +
      Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    const newPatient = {
      _id: docId,
      id: docId,
      name: name.trim(),
      phone: cleanPhone,
      age: age ? String(age).trim() : '',
      dob: dob ? dobToISO(dob.trim()) : '',
      gender: gender || 'Female',
      type: type || 'regular',
      address: (address || '').trim(),
      complaint: (complaint || '').trim(),
      medHistory: (medHistory || '').trim(),
      createdAt: todayStr,
      registeredVia: 'self-registration',
      treatmentStatus: 'ongoing',
      records: [],
      images: [],
      prescriptions: [],
      billing: [],
      orthoDetails:
        type === 'ortho'
          ? {
              startDate: todayStr,
              bracket: 'Metal Braces',
              totalCost: '',
              paidAmount: 0,
              nextAppt: '',
              nextApptTime: '10:00',
              treatmentNotes: '',
            }
          : null,
    };

    await patientCollection.insertOne(newPatient);

    // Update meta last_saved timestamp
    const metaCollection = db.collection('meta');
    await metaCollection.updateOne(
      { key: 'last_saved' },
      { $set: { value: new Date().toISOString() } },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      isExisting: false,
      patient: newPatient,
      message: 'Registration completed successfully.',
    });
  } catch (err) {
    console.error('Registration error:', err);
    return NextResponse.json(
      { error: 'Registration failed: ' + (err.message || 'Server error') },
      { status: 500 }
    );
  }
}
