import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
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
    const { folder, timestamp } = body || {};

    if (!timestamp) {
      return NextResponse.json({ error: 'Missing required body parameter: timestamp.' }, { status: 400 });
    }

    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (!apiSecret || !apiKey || !cloudName) {
      return NextResponse.json(
        { error: 'Server configuration error: Cloudinary environment variables are missing.' },
        { status: 500 }
      );
    }

    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp: timestamp,
        folder: folder || 'home-of-smiles',
      },
      apiSecret
    );

    return NextResponse.json(
      {
        signature,
        apiKey,
        cloudName,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Cloudinary signing error:', err);
    return NextResponse.json(
      { error: 'Failed to generate upload signature: ' + err.message },
      { status: 500 }
    );
  }
}
