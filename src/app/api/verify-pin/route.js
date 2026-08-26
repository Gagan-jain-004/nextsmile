import { NextResponse } from 'next/server';
import { generateToken } from '@/lib/auth';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { pin } = body || {};
    const actualPin = process.env.CLINIC_PIN;

    if (!actualPin) {
      return NextResponse.json(
        { error: 'Server configuration error: CLINIC_PIN environment variable is missing.' },
        { status: 500 }
      );
    }

    if (String(pin) === String(actualPin)) {
      const token = generateToken();
      return NextResponse.json({ success: true, token }, { status: 200 });
    } else {
      return NextResponse.json({ success: false, error: 'Incorrect PIN code' }, { status: 401 });
    }
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error: ' + err.message }, { status: 500 });
  }
}
