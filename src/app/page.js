'use client';

import dynamic from 'next/dynamic';

const ClinicApp = dynamic(() => import('@/components/ClinicApp'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: "'DM Sans', sans-serif",
        background: '#eef2f7',
        color: '#1e3a5f',
        fontWeight: 600,
        fontSize: '16px',
      }}
    >
      Loading Home of Smiles...
    </div>
  ),
});

export default function HomePage() {
  return <ClinicApp />;
}
