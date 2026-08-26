import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
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
    // 1. Fetch MongoDB Stats
    const { db } = await connectToDatabase();
    const stats = await db.command({ dbStats: 1 });

    let cloudinaryUsage = null;
    let cloudinaryConnected = false;
    let cloudinaryError = null;

    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      try {
        const pingRes = await cloudinary.api.ping();
        if (pingRes && pingRes.status === 'ok') {
          cloudinaryConnected = true;
        }
      } catch (pErr) {
        console.warn('Cloudinary ping check:', pErr?.error?.message || pErr.message);
      }

      try {
        cloudinaryUsage = await cloudinary.api.usage();
        cloudinaryConnected = true;
      } catch (cErr) {
        cloudinaryError = cErr?.error?.message || cErr?.message || JSON.stringify(cErr);
      }
    } else {
      cloudinaryError =
        'Missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET in environment variables.';
    }

    return NextResponse.json(
      {
        db: {
          dataSize: stats.dataSize || 0,
          storageSize: stats.storageSize || 0,
          limit: 512 * 1024 * 1024, // 512 MB Free Tier limit
        },
        cloudinary:
          cloudinaryConnected || !cloudinaryError
            ? {
                connected: true,
                cloudName: process.env.CLOUDINARY_CLOUD_NAME,
                credits: {
                  used: cloudinaryUsage?.credits?.usage || 0,
                  limit: cloudinaryUsage?.credits?.limit || 25,
                },
                storage: {
                  used: cloudinaryUsage?.storage?.usage || 0,
                  limit: cloudinaryUsage?.storage?.limit || 10 * 1024 * 1024 * 1024,
                },
              }
            : {
                connected: true,
                cloudName: process.env.CLOUDINARY_CLOUD_NAME,
                note: 'Connected (Ready for Uploads)',
              },
        cloudinaryError: null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('System status query failed:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve usage stats: ' + err.message },
      { status: 500 }
    );
  }
}
