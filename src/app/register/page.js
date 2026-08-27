'use client';

import { useState } from 'react';
import Image from 'next/image';

const QUICK_COMPLAINTS = [
  'Toothache / Pain',
  'Routine Dental Checkup',
  'Teeth Cleaning & Polishing',
  'Braces / Aligners Consultation',
  'Cavity / Tooth Filling',
  'Sensitivity (Hot/Cold)',
  'Bleeding / Swollen Gums',
  'Broken / Chipped Tooth',
  'Wisdom Tooth Pain',
  'Missing Teeth / Implants',
];

const QUICK_MED_HISTORY = [
  'No Medical Conditions (Healthy)',
  'Diabetes',
  'Hypertension (High BP)',
  'Thyroid Disorder',
  'Asthma / Breathing Issue',
  'Heart Condition',
  'Penicillin / Drug Allergy',
  'Currently Pregnant',
  'Taking Blood Thinners',
];

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    dob: '',
    age: '',
    gender: 'Female',
    type: 'regular',
    address: '',
    complaint: '',
    medHistory: '',
  });

  const [ageHint, setAgeHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successData, setSuccessData] = useState(null);

  // Auto-format DOB (DD/MM/YYYY) and calculate Age
  const handleDobChange = (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);

    let formatted = '';
    if (v.length >= 1) formatted = v.slice(0, 2);
    if (v.length >= 3) formatted += '/' + v.slice(2, 4);
    if (v.length >= 5) formatted += '/' + v.slice(4, 8);

    let calculatedAge = formData.age;
    let hint = '';

    if (v.length === 8) {
      const d = parseInt(v.slice(0, 2), 10);
      const m = parseInt(v.slice(2, 4), 10) - 1;
      const y = parseInt(v.slice(4, 8), 10);
      const dobDate = new Date(y, m, d);

      if (!isNaN(dobDate.getTime()) && dobDate <= new Date()) {
        const today = new Date();
        let years = today.getFullYear() - dobDate.getFullYear();
        const mDiff = today.getMonth() - dobDate.getMonth();
        if (mDiff < 0 || (mDiff === 0 && today.getDate() < dobDate.getDate())) {
          years--;
        }
        calculatedAge = String(Math.max(0, years));
        hint = `(${calculatedAge} yrs old)`;
      }
    }

    setFormData((prev) => ({
      ...prev,
      dob: formatted,
      age: calculatedAge,
    }));
    setAgeHint(hint);
  };

  const handleChipClick = (field, item) => {
    setFormData((prev) => {
      const current = prev[field] ? prev[field].trim() : '';
      if (!current) return { ...prev, [field]: item };
      if (current.includes(item)) return prev;
      return { ...prev, [field]: current + ', ' + item };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.name.trim()) {
      setErrorMsg('Please enter your full name.');
      return;
    }

    const cleanPhone = formData.phone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/register-patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          phone: cleanPhone,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete registration.');
      }

      setSuccessData({
        patient: data.patient,
        isExisting: data.isExisting,
        message: data.message,
      });
    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFormData({
      name: '',
      phone: '',
      dob: '',
      age: '',
      gender: 'Female',
      type: 'regular',
      address: '',
      complaint: '',
      medHistory: '',
    });
    setAgeHint('');
    setErrorMsg('');
    setSuccessData(null);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%)',
        padding: '24px 16px',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div style={{ maxWidth: '780px', margin: '0 auto' }}>
        {/* ══ CLINIC HEADER BANNER ══ */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '20px',
            padding: '20px 24px',
            marginBottom: '20px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '16px',
              overflow: 'hidden',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img
              src="/logo.jpg"
              alt="Home of Smiles Logo"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>

          <div style={{ flex: 1, minWidth: '220px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: '#16a34a',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
              }}
            >
              The Home Of Smiles
            </div>
            <h1
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: '24px',
                fontWeight: 700,
                color: '#1e3a5f',
                margin: '2px 0 4px',
              }}
            >
              Dr. Tanmay Jain
            </h1>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              {/* MDS – Orthodontics &amp; Dentofacial Orthopedics | */}
               Dental Clinic
            </p>
          </div>

          <div
            style={{
              background: '#eff6ff',
              borderRadius: '12px',
              padding: '8px 14px',
              border: '1px solid #bfdbfe',
              textAlign: 'right',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8' }}>
              📍 Kota, Rajasthan
            </div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginTop: '2px' }}>
              Patient Self-Registration
            </div>
          </div>
        </div>

        {/* ══ SUCCESS VIEW ══ */}
        {successData ? (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              padding: '36px 28px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
              border: '1px solid #e2e8f0',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '68px',
                height: '68px',
                background: '#ecfdf5',
                color: '#059669',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
                marginBottom: '16px',
                border: '2px solid #a7f3d0',
              }}
            >
              ✓
            </div>

            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: '26px',
                fontWeight: 700,
                color: '#1e3a5f',
                marginBottom: '6px',
              }}
            >
              {successData.isExisting
                ? 'Already Registered'
                : 'Registration Successful!'}
            </h2>
            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
              {successData.message || 'Your patient details have been recorded.'}
            </p>

            {/* Token Card */}
            <div
              style={{
                maxWidth: '460px',
                margin: '0 auto 28px',
                background: '#f8fafc',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '16px',
                padding: '20px 24px',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '10px',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  PATIENT ID
                </span>
                <span
                  style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    color: '#1d4ed8',
                    letterSpacing: '0.5px',
                  }}
                >
                  {successData.patient.id || successData.patient._id}
                </span>
              </div>

              <div style={{ display: 'grid', gap: '8px', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Name:</span>
                  <strong style={{ color: '#1e293b' }}>{successData.patient.name}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Phone:</span>
                  <strong style={{ color: '#1e293b' }}>{successData.patient.phone}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Age / Gender:</span>
                  <span style={{ color: '#1e293b' }}>
                    {successData.patient.age ? `${successData.patient.age} yrs` : '—'} /{' '}
                    {successData.patient.gender || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Date:</span>
                  <span style={{ color: '#1e293b' }}>
                    {successData.patient.createdAt || new Date().toLocaleDateString('en-IN')}
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '12px',
                padding: '14px',
                maxWidth: '520px',
                margin: '0 auto 28px',
                fontSize: '13px',
                color: '#166534',
                textAlign: 'left',
              }}
            >
              💡 <strong>Next Step:</strong> Please share your Patient ID or Mobile Number at the
              clinic reception counter. The doctor will call you shortly for your consultation.
            </div>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={handlePrint}
                className="btn btn-primary"
                style={{ padding: '11px 22px', fontSize: '14px' }}
              >
                🖨️ Print / Save Slip
              </button>
              <button
                onClick={handleReset}
                className="btn btn-ghost"
                style={{ padding: '11px 22px', fontSize: '14px' }}
              >
                ➕ Register Another Person
              </button>
            </div>
          </div>
        ) : (
          /* ══ FORM VIEW ══ */
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              padding: '28px 24px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              <h2
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: '22px',
                  fontWeight: 700,
                  color: '#1e3a5f',
                  margin: '0 0 4px',
                }}
              >
                New Patient Registration
              </h2>
              <p style={{ fontSize: '13.5px', color: '#64748b', margin: 0 }}>
                Please fill in your details below. Your information will be securely saved to your clinic record.
              </p>
            </div>

            {errorMsg && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1.5px solid #fca5a5',
                  color: '#b91c1c',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  marginBottom: '18px',
                  fontSize: '13.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-grid-2">
                {/* Full Name */}
                <div className="form-group">
                  <label className="form-label">
                    Full Name <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    className="form-input"
                    placeholder="e.g. Priya Sharma"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                {/* Phone Number */}
                <div className="form-group">
                  <label className="form-label">
                    Phone Number <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    className="form-input"
                    type="tel"
                    placeholder="10-digit mobile number"
                    maxLength={10}
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })
                    }
                    required
                  />
                </div>

                {/* Date of Birth */}
                <div className="form-group">
                  <label className="form-label">Date of Birth</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
                    value={formData.dob}
                    onChange={handleDobChange}
                  />
                </div>

                {/* Age */}
                <div className="form-group">
                  <label className="form-label">
                    Age
                    {ageHint && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#059669',
                          marginLeft: '6px',
                          textTransform: 'none',
                        }}
                      >
                        {ageHint}
                      </span>
                    )}
                  </label>
                  <input
                    className="form-input"
                    type="number"
                    placeholder="Years (e.g. 28)"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                  />
                </div>

                {/* Gender */}
                <div className="form-group">
                  <label className="form-label">Gender</label>
                  <select
                    className="form-input"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Patient Type */}
                <div className="form-group">
                  <label className="form-label">Consultation Category</label>
                  <select
                    className="form-input"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  >
                    <option value="regular">Regular Dental Patient</option>
                    <option value="ortho">Orthodontics (Braces / Aligners)</option>
                    <option value="pediatric">Pediatric (Child)</option>
                  </select>
                </div>
              </div>

              {/* Address */}
              <div className="form-group">
                <label className="form-label">Address / Locality</label>
                <input
                  className="form-input"
                  placeholder="e.g. Mahaveer Nagar, Kota"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              {/* Chief Complaint */}
              <div className="form-group">
                <label className="form-label">Chief Complaint / Reason for Visit</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Tooth pain in upper jaw, sensitivity while drinking cold water, regular checkup…"
                  value={formData.complaint}
                  onChange={(e) => setFormData({ ...formData, complaint: e.target.value })}
                />
                {/* Quick chip suggestions */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginTop: '8px',
                  }}
                >
                  {QUICK_COMPLAINTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleChipClick('complaint', item)}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '20px',
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        color: '#334155',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#e2e8f0';
                        e.currentTarget.style.borderColor = '#94a3b8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                    >
                      + {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* Medical History */}
              <div className="form-group">
                <label className="form-label">Medical History / Allergies (if any)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Diabetes, Blood Pressure, Thyroid, ongoing medications, drug allergies…"
                  value={formData.medHistory}
                  onChange={(e) => setFormData({ ...formData, medHistory: e.target.value })}
                />
                {/* Quick med chips */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginTop: '8px',
                  }}
                >
                  {QUICK_MED_HISTORY.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleChipClick('medHistory', item)}
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '20px',
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        color: '#991b1b',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#fee2e2';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#fef2f2';
                      }}
                    >
                      + {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <div style={{ marginTop: '24px' }}>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: 700,
                    justifyContent: 'center',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.75 : 1,
                  }}
                >
                  {loading ? 'Submitting Registration…' : '✅ Complete Registration'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: 'center',
            fontSize: '12px',
            color: '#94a3b8',
            marginTop: '20px',
          }}
        >
          The Home of Smiles © {new Date().getFullYear()} • Dr. Tanmay Jain Clinic Management
        </div>
      </div>
    </div>
  );
}
