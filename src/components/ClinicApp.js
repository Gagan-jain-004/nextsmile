'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { CLINIC_HTML } from './clinicHtml';

export default function ClinicApp() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: "'DM Sans', sans-serif",
        background: '#eef2f7',
        color: '#1e3a5f',
        fontWeight: 600,
        fontSize: '16px'
      }}>
        Loading Home of Smiles...
      </div>
    );
  }

  return (
    <div id="hos-app-container">
      <div
        id="hos-app-root"
        dangerouslySetInnerHTML={{ __html: CLINIC_HTML }}
        suppressHydrationWarning
      />
      <Script
        src="/clinic_app.js"
        strategy="afterInteractive"
        onLoad={() => {
          console.log('Home of Smiles client engine loaded successfully in Next.js');
        }}
      />
    </div>
  );
}
