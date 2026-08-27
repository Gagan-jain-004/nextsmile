import { NextResponse } from 'next/server';
import { generateToken } from '@/lib/auth';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { username, password, rememberMe } = body || {};

    const expectedUser = (process.env.ADMIN_USERNAME || 'admin').trim();
    const expectedPass = (process.env.ADMIN_PASSWORD || 'drtanmay7410').trim();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required.' },
        { status: 400 }
      );
    }

    const inputUser = String(username).trim();
    const inputPass = String(password).trim();

    const isMatch = (inputUser.toLowerCase() === expectedUser.toLowerCase()) && (inputPass === expectedPass);

    if (isMatch) {
      const expiresIn = rememberMe === false ? '1d' : '30d';
      const token = generateToken({ authenticated: true, role: 'doctor', username: inputUser }, expiresIn);
      return NextResponse.json({
        success: true,
        token,
        username: inputUser,
        doctorName: 'Dr. Tanmay Jain',
        expiresIn,
      }, { status: 200 });
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password. Please try again.' },
        { status: 401 }
      );
    }
  } catch (err) {
    console.error('Doctor login error:', err);
    return NextResponse.json(
      { success: false, error: 'Server error: ' + err.message },
      { status: 500 }
    );
  }
}
