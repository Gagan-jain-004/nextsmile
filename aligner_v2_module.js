/* ══════════════════════════════════════════════════════
   ALIGNER MODULE 2.0 — FINAL PRODUCTION SYSTEM (The Home of Smiles)
   Completely independent Aligner Patient module.
   Private-practice workflow: Initial Records, Set Calendar, Batches,
   Reviews, Cumulative IPR, Visual FDI Attachment Map, Independent Ledger,
   Delay Recalculations, Treatment Pause/Resume, Refinements, 1-Tap WhatsApp,
   Comm History, In-App Appointments Sync, Retainer Phase, Discharge Summary,
   Global Dashboard, Filter/Sort, and Excel/JSON Exports.
   ══════════════════════════════════════════════════════ */

var aligner_currentSubTab = 'overview';
var aligner_filterStatus = 'all';
var aligner_sortBy = 'nextReview';
var aligner_searchQuery = '';

/* ── Global & Patient Data Helpers ── */
function getAlignerCases() {
  return DATA.alignerCases || (DATA.alignerCases = []);
}

function addDaysToDate(dateStr, days) {
  if (!dateStr) dateStr = todayISO();
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + parseInt(days || 0));
  return d.toISOString().slice(0, 10);
}

function aligner_getPatientDetails(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return null;
  if (!p.alignerDetails) {
    var legacy = (DATA.alignerCases || []).find(function(c) { return c.patientId === ptId; });
    p.alignerDetails = {
      brand: (legacy && legacy.brand) || 'Invisalign',
      startDate: (legacy && legacy.alignerStartDate) || todayISO(),
      firstSetDate: (legacy && legacy.alignerStartDate) || todayISO(),
      totalSets: (legacy && legacy.totalSets) || 20,
      currentSet: (legacy && legacy.currentSet) || 1,
      setDurationDays: 10,
      setsPerBatch: 5,
      reviewIntervalDays: 30,
      totalCost: (legacy && legacy.totalAmount) || 0,
      paidAmount: (legacy && legacy.paidAmount) || 0,
      treatmentStatus: (legacy && legacy.treatmentStatus) || 'ongoing',
      notes: (legacy && legacy.notes) || '',
      initialRecords: {
        photos: { frontal:'', smile:'', right:'', left:'', upper:'', lower:'', profile:'', extra:'' },
        opgUrl: '', cbctUrl: '', cephUrl: '',
        scanRefNumber: '', scanCompany: '', studyModelRef: '',
        treatmentObjectives: '',
        consentForm: { signed: false, signedDate: '', signatureDataUrl: '', consentTerms: '' },
        initialNotes: ''
      },
      batches: (legacy && legacy.batches) || [],
      reviews: (legacy && legacy.reviews) || [],
      iprLogs: [],
      attachments: [],
      payments: (legacy && legacy.paymentHistory) || [],
      delays: (legacy && legacy.delays) || [],
      pauses: [],
      refinements: (legacy && legacy.refinements) || [],
      waHistory: [],
      retention: {
        active: false,
        retainerType: 'Essix',
        deliveryDate: '',
        wearInstructions: 'Full-time wear for 3 months, then night-only',
        retainerCost: 0,
        retainerPaid: 0,
        notes: '',
        reviews: []
      }
    };
  }
  if (!p.alignerDetails.initialRecords) {
    p.alignerDetails.initialRecords = {
      photos: { frontal:'', smile:'', right:'', left:'', upper:'', lower:'', profile:'', extra:'' },
      opgUrl: '', cbctUrl: '', cephUrl: '',
      scanRefNumber: '', scanCompany: '', studyModelRef: '',
      treatmentObjectives: '',
      consentForm: { signed: false, signedDate: '', signatureDataUrl: '', consentTerms: '' },
      initialNotes: ''
    };
  }
  if (!p.alignerDetails.iprLogs) p.alignerDetails.iprLogs = [];
  if (!p.alignerDetails.attachments) p.alignerDetails.attachments = [];
  if (!p.alignerDetails.pauses) p.alignerDetails.pauses = [];
  if (!p.alignerDetails.waHistory) p.alignerDetails.waHistory = [];
  if (!p.alignerDetails.retention) {
    p.alignerDetails.retention = {
      active: false,
      retainerType: 'Essix',
      deliveryDate: '',
      wearInstructions: 'Full-time wear for 3 months, then night-only',
      retainerCost: 0,
      retainerPaid: 0,
      notes: '',
      reviews: []
    };
  }
  return p.alignerDetails;
}

function aligner_savePatientDetails(ptId, details) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  p.alignerDetails = details;
  if (!p.type || p.type === 'regular') {
    p.type = 'aligner';
  }

  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var cases = getAlignerCases();
  var idx = cases.findIndex(function(c) { return c.patientId === p.id; });
  var caseObj = {
    id: (idx >= 0 && cases[idx].id) ? cases[idx].id : ('AL_' + p.id),
    patientId: p.id,
    patientName: p.name,
    phone: p.phone || '',
    brand: details.brand || 'Invisalign',
    totalSets: stats.totalSets,
    currentSet: stats.activeSet,
    alignerStartDate: details.startDate || todayISO(),
    lastChangeDate: stats.currentSetStartDate,
    nextChangeDate: stats.nextChangeDate,
    nextReviewDate: stats.nextReviewDate,
    treatmentStatus: details.treatmentStatus || 'ongoing',
    totalAmount: stats.totalCost,
    paidAmount: stats.totalPaid,
    pendingAmount: stats.dueAmount,
    totalDelayDays: stats.totalDelayDays,
    complianceScore: stats.complianceScore,
    notes: details.notes || '',
    batches: details.batches || [],
    reviews: details.reviews || [],
    iprLogs: details.iprLogs || [],
    attachments: details.attachments || [],
    delays: details.delays || [],
    pauses: details.pauses || [],
    refinements: details.refinements || [],
    paymentHistory: details.payments || [],
    waHistory: details.waHistory || [],
    retention: details.retention || {}
  };

  if (idx >= 0) cases[idx] = caseObj; else cases.unshift(caseObj);
  DATA.alignerCases = cases;

  aligner_syncToAppointments(p.id, details, stats);
  saveData();
}

/* ── Calculation Engine with Pause and Delay Recalculation ── */
function aligner_calcSchedule(details) {
  if (!details) return [];
  var start = details.firstSetDate || details.startDate || todayISO();
  var duration = parseInt(details.setDurationDays) || 10;
  var baseTotalSets = parseInt(details.totalSets) || 1;
  var totalSets = baseTotalSets;
  (details.refinements || []).forEach(function(r) {
    totalSets += (parseInt(r.additionalSets) || 0);
  });

  var delays = (details.delays || []).slice().sort(function(a, b) {
    return (a.date || '').localeCompare(b.date || '');
  });

  var schedule = [];
  var curDate = start;

  for (var i = 1; i <= totalSets; i++) {
    var isRefinement = i > baseTotalSets;
    var applicableDelays = delays.filter(function(d) {
      return parseInt(d.affectedSet) === i;
    });
    var delayDaysForSet = 0;
    var delayNotes = [];
    applicableDelays.forEach(function(d) {
      delayDaysForSet += (parseInt(d.delayDays) || 0);
      if (d.issueType) delayNotes.push(d.issueType + (d.notes ? ': ' + d.notes : ''));
    });

    var setStartDate = curDate;
    var setEndDate = addDaysToDate(setStartDate, duration + delayDaysForSet);

    schedule.push({
      setNum: i,
      isRefinement: isRefinement,
      refinementLabel: isRefinement ? ('R' + (i - baseTotalSets)) : null,
      startDate: setStartDate,
      endDate: setEndDate,
      durationDays: duration + delayDaysForSet,
      delayDays: delayDaysForSet,
      delayNotes: delayNotes.join('; ')
    });

    curDate = setEndDate;
  }
  return schedule;
}

/* ── Cumulative IPR Calculator ── */
function aligner_calcCumulativeIpr(details) {
  var perTooth = {};
  if (!details || !details.iprLogs) return perTooth;
  details.iprLogs.forEach(function(log) {
    if (log.perTooth && typeof log.perTooth === 'object') {
      Object.keys(log.perTooth).forEach(function(t) {
        var amt = parseFloat(log.perTooth[t]) || 0;
        perTooth[t] = (perTooth[t] || 0) + amt;
      });
    } else if (Array.isArray(log.teeth)) {
      var defaultAmt = parseFloat(log.amountMm) || 0;
      log.teeth.forEach(function(t) {
        perTooth[t] = (perTooth[t] || 0) + defaultAmt;
      });
    }
  });
  Object.keys(perTooth).forEach(function(k) {
    perTooth[k] = Math.round(perTooth[k] * 100) / 100;
  });
  return perTooth;
}

/* ── Stats & Compliance Engine ── */
function aligner_calcStats(details, schedule) {
  if (!details) details = {};
  if (!schedule) schedule = aligner_calcSchedule(details);

  var baseTotalSets = parseInt(details.totalSets) || 1;
  var totalSets = baseTotalSets;
  var addlRefinementsCost = 0;
  (details.refinements || []).forEach(function(r) {
    totalSets += (parseInt(r.additionalSets) || 0);
    addlRefinementsCost += (Number(r.cost) || 0);
  });

  var retainerCost = (details.retention && Number(details.retention.retainerCost)) || 0;
  var totalCost = (Number(details.totalCost) || 0) + addlRefinementsCost + retainerCost;

  var totalPaid = (details.payments || []).reduce(function(sum, p) {
    return sum + (Number(p.amount) || 0);
  }, 0);
  if (totalPaid === 0 && details.paidAmount) {
    totalPaid = Number(details.paidAmount) || 0;
  }

  var dueAmount = Math.max(0, totalCost - totalPaid);

  var totalDelayDays = (details.delays || []).reduce(function(sum, d) {
    return sum + (parseInt(d.delayDays) || 0);
  }, 0);

  (details.pauses || []).forEach(function(p) {
    if (p.pauseStart && p.actualResume) {
      var d1 = new Date(p.pauseStart + 'T00:00:00');
      var d2 = new Date(p.actualResume + 'T00:00:00');
      totalDelayDays += Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
  });

  var activeSet = parseInt(details.currentSet) || 1;
  if (activeSet < 1) activeSet = 1;
  if (activeSet > totalSets) activeSet = totalSets;

  var currentSetInfo = schedule[activeSet - 1] || schedule[0] || {};
  var currentSetStartDate = currentSetInfo.startDate || details.startDate || todayISO();
  var nextChangeDate = currentSetInfo.endDate || addDaysToDate(currentSetStartDate, details.setDurationDays || 10);

  var nextReviewDate = '';
  if (details.reviews && details.reviews.length > 0) {
    var sortedReviews = details.reviews.slice().sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    nextReviewDate = sortedReviews[0].nextReviewDate || '';
  }
  if (!nextReviewDate) {
    var intDays = parseInt(details.reviewIntervalDays) || 30;
    nextReviewDate = addDaysToDate(details.startDate || todayISO(), intDays);
  }

  var estimatedCompletion = schedule.length > 0 ? schedule[schedule.length - 1].endDate : addDaysToDate(todayISO(), totalSets * (details.setDurationDays || 10));
  var setsRemaining = Math.max(0, totalSets - activeSet);
  var progressPct = totalSets > 0 ? Math.min(100, Math.round((activeSet / totalSets) * 100)) : 0;

  var today = todayISO();
  var diffChange = Math.round((new Date(nextChangeDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / (1000 * 60 * 60 * 24));
  var diffReview = nextReviewDate ? Math.round((new Date(nextReviewDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / (1000 * 60 * 60 * 24)) : 999;

  var complianceScore = 'green';
  var complianceLabel = '🟢 On Schedule';
  var complianceBadge = '<span class="badge" style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;font-size:12px;font-weight:700">🟢 On Schedule (0d delay)</span>';

  if (totalDelayDays >= 1 && totalDelayDays <= 3) {
    complianceScore = 'yellow';
    complianceLabel = '🟡 1–3 Days Lag';
    complianceBadge = '<span class="badge" style="background:#fefce8;color:#ca8a04;border:1px solid #fef08a;font-size:12px;font-weight:700">🟡 Behind Schedule (' + totalDelayDays + 'd lag)</span>';
  } else if (totalDelayDays > 3) {
    complianceScore = 'red';
    complianceLabel = '🔴 Critical Delay';
    complianceBadge = '<span class="badge" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-size:12px;font-weight:700">🔴 Critical Delay (' + totalDelayDays + 'd lag)</span>';
  }

  var isPaused = details.treatmentStatus === 'paused' || (details.pauses && details.pauses.some(function(p) { return p.active; }));
  if (isPaused) {
    complianceScore = 'paused';
    complianceLabel = '⏸️ Paused';
    complianceBadge = '<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:12px;font-weight:700">⏸️ Treatment Paused</span>';
  }

  return {
    activeSet: activeSet,
    totalSets: totalSets,
    baseTotalSets: baseTotalSets,
    setsRemaining: setsRemaining,
    totalCost: totalCost,
    totalPaid: totalPaid,
    dueAmount: dueAmount,
    totalDelayDays: totalDelayDays,
    complianceScore: complianceScore,
    complianceLabel: complianceLabel,
    complianceBadge: complianceBadge,
    isPaused: isPaused,
    currentSetStartDate: currentSetStartDate,
    nextChangeDate: nextChangeDate,
    nextReviewDate: nextReviewDate,
    estimatedCompletion: estimatedCompletion,
    progressPct: progressPct,
    diffChange: diffChange,
    diffReview: diffReview,
    status: details.treatmentStatus || 'ongoing'
  };
}

/* ── Sync to Appointments with Dedicated Aligner Icons ── */
function aligner_syncToAppointments(ptId, details, stats) {
  if (!DATA.appointments) DATA.appointments = [];
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; });
  if (!p) return;

  DATA.appointments = DATA.appointments.filter(function(a) {
    return !(a.patientId === ptId && a.isAlignerAuto);
  });

  if (stats.isPaused) return;

  if (stats.nextChangeDate && stats.activeSet < stats.totalSets) {
    var nextSetNum = stats.activeSet + 1;
    DATA.appointments.push({
      id: 'AL_CHG_' + ptId + '_' + stats.nextChangeDate,
      patientId: ptId,
      patientName: p.name,
      patientPhone: p.phone || '',
      date: stats.nextChangeDate,
      time: '09:00',
      reason: '💎 Change to Aligner Set #' + nextSetNum + ' (' + (details.brand || 'Aligner') + ')',
      status: 'scheduled',
      isAlignerAuto: true,
      category: 'aligner_set_change'
    });
  }

  if (stats.nextReviewDate) {
    DATA.appointments.push({
      id: 'AL_REV_' + ptId + '_' + stats.nextReviewDate,
      patientId: ptId,
      patientName: p.name,
      patientPhone: p.phone || '',
      date: stats.nextReviewDate,
      time: '11:00',
      reason: '💎 Aligner Review Visit (Set #' + stats.activeSet + ')',
      status: 'scheduled',
      isAlignerAuto: true,
      category: 'aligner_review'
    });
  }

  if (details.retention && details.retention.active && details.retention.reviews) {
    details.retention.reviews.forEach(function(rv, idx) {
      if (rv.expectedDate && rv.status === 'pending') {
        DATA.appointments.push({
          id: 'AL_RET_' + ptId + '_' + idx,
          patientId: ptId,
          patientName: p.name,
          patientPhone: p.phone || '',
          date: rv.expectedDate,
          time: '10:30',
          reason: '🛡️ Aligner Retention Check (' + rv.milestone + ')',
          status: 'scheduled',
          isAlignerAuto: true,
          category: 'aligner_retention'
        });
      }
    });
  }
}

/* ── Sub-tab Switcher ── */
function aligner_setSubTab(subTab) {
  aligner_currentSubTab = subTab;
  renderAlignerDetailTab();
}

/* ── Render: Aligner Detail Tab in Patient Detail ── */
function renderAlignerDetailTab() {
  var p = activePt;
  var container = document.getElementById('tab-content-aligner-detail');
  if (!p || !container) return;

  var details = aligner_getPatientDetails(p.id);
  var schedule = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, schedule);
  var iprCumulative = aligner_calcCumulativeIpr(details);

  var subTabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'records', label: '📂 Initial Records' },
    { id: 'calendar', label: '📅 Set Calendar' },
    { id: 'batches', label: '📦 Batches (' + (details.batches || []).length + ')' },
    { id: 'reviews', label: '🩺 Reviews (' + (details.reviews || []).length + ')' },
    { id: 'ipr', label: '🦷 IPR Log (' + (details.iprLogs || []).length + ')' },
    { id: 'attachments', label: '📍 Attachments (' + (details.attachments || []).filter(function(a){ return a.status !== 'Removed'; }).length + ')' },
    { id: 'payments', label: '💰 Payments (' + (details.payments || []).length + ')' },
    { id: 'issues', label: '⚠️ Issues & Pause (' + ((details.delays || []).length + (details.pauses || []).length) + ')' },
    { id: 'refinements', label: '🔄 Refinements (' + (details.refinements || []).length + ')' },
    { id: 'retention', label: '🛡️ Retainer Phase' + (details.retention && details.retention.active ? ' (Active)' : '') },
    { id: 'wa_history', label: '📱 WA History (' + (details.waHistory || []).length + ')' }
  ];

  var html = `
    <div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#1e3a5f;margin:0;display:flex;align-items:center;gap:10px">
          💎 Aligner Treatment System 2.0
          <span class="badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:13px">${esc(details.brand || 'Clear Aligners')}</span>
          ${stats.complianceBadge}
        </h2>
        <p style="font-size:12px;color:#64748b;margin:3px 0 0">
          The Home of Smiles • Private Practice Clinical Workflow • Dr. Tanmay Jain
        </p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" style="background:#25D366;color:#fff;border:none;font-weight:700" onclick="showAlignerSmartWAModal('${esc(p.id)}')">
          💬 Send WA Reminder
        </button>
        <button class="btn btn-sm" style="background:#0284c7;color:#fff;border:none;font-weight:700" onclick="showAlignerDeliverBatchModal('${esc(p.id)}')">
          📦 Deliver Batch
        </button>
        <button class="btn btn-sm" style="background:#0d9488;color:#fff;border:none;font-weight:700" onclick="showAlignerReviewModal('${esc(p.id)}')">
          🩺 New Review
        </button>
        <button class="btn btn-sm" style="background:#4f46e5;color:#fff;border:none;font-weight:700" onclick="showAlignerPaymentModal('${esc(p.id)}')">
          💰 Add Payment
        </button>
        <button class="btn btn-sm" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd" onclick="showAlignerSetupModal('${esc(p.id)}')">
          ⚙️ Setup
        </button>
        <button class="btn btn-sm btn-ghost" onclick="printAlignerProgressReport('${esc(p.id)}')">
          🖨️ Print Report
        </button>
      </div>
    </div>

    <!-- Live 9-KPI Metric Cards Grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:16px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Active Set</div>
        <div style="font-size:22px;font-weight:800;color:#0284c7;margin-top:2px">
          #${stats.activeSet} <span style="font-size:12px;font-weight:600;color:#94a3b8">/ ${stats.totalSets}</span>
        </div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Sets Left</div>
        <div style="font-size:22px;font-weight:800;color:#334155;margin-top:2px">${stats.setsRemaining}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Next Set Change</div>
        <div style="font-size:15px;font-weight:800;color:#7c3aed;margin-top:4px">${stats.nextChangeDate ? formatDate(stats.nextChangeDate) : '—'}</div>
        <div style="font-size:11px;color:#8b5cf6;font-weight:600">${stats.diffChange === 0 ? 'Today ⚡' : stats.diffChange > 0 ? 'In ' + stats.diffChange + ' days' : Math.abs(stats.diffChange) + 'd overdue'}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Next Review</div>
        <div style="font-size:15px;font-weight:800;color:#0d9488;margin-top:4px">${stats.nextReviewDate ? formatDate(stats.nextReviewDate) : '—'}</div>
        <div style="font-size:11px;color:#14b8a6;font-weight:600">${stats.diffReview >= 900 ? '—' : stats.diffReview === 0 ? 'Today ⚡' : stats.diffReview > 0 ? 'In ' + stats.diffReview + ' days' : Math.abs(stats.diffReview) + 'd overdue'}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Total Paid</div>
        <div style="font-size:20px;font-weight:800;color:#16a34a;margin-top:2px">₹${(stats.totalPaid || 0).toLocaleString()}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Due Amount</div>
        <div style="font-size:20px;font-weight:800;color:${stats.dueAmount > 0 ? '#dc2626' : '#16a34a'};margin-top:2px">
          ₹${(stats.dueAmount || 0).toLocaleString()}
        </div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Est. Completion</div>
        <div style="font-size:14px;font-weight:800;color:#1e3a5f;margin-top:5px">${stats.estimatedCompletion ? formatDate(stats.estimatedCompletion) : '—'}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Delay Days</div>
        <div style="font-size:20px;font-weight:800;color:${stats.totalDelayDays > 0 ? '#ea580c' : '#16a34a'};margin-top:2px">${stats.totalDelayDays}d</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Compliance</div>
        <div style="font-size:14px;font-weight:800;margin-top:5px">${stats.complianceLabel}</div>
      </div>
    </div>

    <!-- Treatment Progress Bar -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">
        <span>Overall Treatment Progress</span>
        <span style="color:#0284c7">${stats.progressPct}% Completed (${stats.activeSet}/${stats.totalSets} Sets)</span>
      </div>
      <div style="height:10px;background:#f1f5f9;border-radius:999px;overflow:hidden;position:relative">
        <div style="height:100%;width:${stats.progressPct}%;background:linear-gradient(90deg, #0284c7, #38bdf8, #10b981);border-radius:999px;transition:width 0.4s ease"></div>
      </div>
    </div>

    <!-- Sub-tab Navigation Bar -->
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:18px;border-bottom:1px solid #e2e8f0">
      ${subTabs.map(function(t) {
        var isActive = aligner_currentSubTab === t.id;
        return `
          <button onclick="aligner_setSubTab('${t.id}')"
            style="padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all 0.15s ease;
            background:${isActive ? '#1e3a5f' : '#f8fafc'};
            color:${isActive ? '#ffffff' : '#64748b'};
            border:1px solid ${isActive ? '#1e3a5f' : '#e2e8f0'};
            box-shadow:${isActive ? '0 2px 4px rgba(30,58,95,0.2)' : 'none'}">
            ${t.label}
          </button>
        `;
      }).join('')}
    </div>

    <!-- Active Sub-tab View Container -->
    <div id="aligner-subtab-view">
      ${aligner_renderSubTabContent(p, details, stats, schedule, iprCumulative)}
    </div>
  `;

  container.innerHTML = html;
}

/* ── Render Content for Selected Sub-Tab ── */
function aligner_renderSubTabContent(p, details, stats, schedule, iprCumulative) {
  var tab = aligner_currentSubTab;
  if (tab === 'overview') return aligner_renderOverviewTab(p, details, stats, schedule, iprCumulative);
  if (tab === 'records') return aligner_renderInitialRecordsTab(p, details);
  if (tab === 'calendar') return aligner_renderCalendarTab(p, details, stats, schedule);
  if (tab === 'batches') return aligner_renderBatchesTab(p, details, stats);
  if (tab === 'reviews') return aligner_renderReviewsTab(p, details, stats);
  if (tab === 'ipr') return aligner_renderIprTab(p, details, iprCumulative);
  if (tab === 'attachments') return aligner_renderAttachmentsTab(p, details);
  if (tab === 'payments') return aligner_renderPaymentsTab(p, details, stats);
  if (tab === 'issues') return aligner_renderIssuesTab(p, details, stats);
  if (tab === 'refinements') return aligner_renderRefinementsTab(p, details, stats);
  if (tab === 'retention') return aligner_renderRetentionTab(p, details, stats);
  if (tab === 'wa_history') return aligner_renderWaHistoryTab(p, details);
  return '<div style="padding:20px;color:#64748b">Section loading...</div>';
}

/* ── 1. Overview Tab ── */
function aligner_renderOverviewTab(p, details, stats, schedule, iprCumulative) {
  var lastBatch = (details.batches || []).slice().pop();
  var lastReview = (details.reviews || []).slice().pop();

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0">📦 Active Aligner Batch</h3>
            <button class="btn btn-sm btn-outline" onclick="showAlignerDeliverBatchModal('${esc(p.id)}')">➕ Deliver Batch</button>
          </div>
          ${lastBatch ? `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">
              <div style="font-weight:800;font-size:14px;color:#166534">Batch #${lastBatch.batchNumber || 1}: ${esc(lastBatch.setsIncluded || 'Delivered Sets')}</div>
              <div style="font-size:12px;color:#334155;margin-top:4px">Delivered on: <b>${formatDate(lastBatch.deliveryDate)}</b></div>
              <div style="font-size:12px;color:#334155">Target Finish: <b>${lastBatch.expectedFinishDate ? formatDate(lastBatch.expectedFinishDate) : '—'}</b></div>
              ${lastBatch.notes ? `<div style="font-size:11px;color:#64748b;margin-top:4px">Notes: ${esc(lastBatch.notes)}</div>` : ''}
            </div>
          ` : `
            <div style="padding:16px;text-align:center;background:#f8fafc;border-radius:8px;color:#94a3b8;font-size:13px">
              No batches delivered yet. Click "Deliver Batch" to record first handover.
            </div>
          `}
        </div>

        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0">🩺 Latest Review Summary</h3>
            <button class="btn btn-sm btn-outline" onclick="showAlignerReviewModal('${esc(p.id)}')">➕ New Review</button>
          </div>
          ${lastReview ? `
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
              <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;color:#0369a1">
                <span>Visited: ${formatDate(lastReview.date)}</span>
                <span class="badge" style="background:#0284c7;color:#fff">Set #${lastReview.currentSet}</span>
              </div>
              <div style="font-size:12px;color:#334155;margin-top:6px">
                Tracking: <b>${esc(lastReview.trackingQuality || 'Good')}</b> • Compliance: <b>${esc(lastReview.compliance || '20-22 hrs/day')}</b>
              </div>
              <div style="font-size:12px;color:#334155">
                Attachments: <b>${esc(lastReview.attachmentStatus || 'Intact')}</b> • IPR: <b>${lastReview.iprPerformed ? 'Yes' : 'No'}</b>
              </div>
              ${lastReview.clinicalNotes ? `<div style="font-size:11px;color:#475569;margin-top:4px;font-style:italic">"${esc(lastReview.clinicalNotes)}"</div>` : ''}
            </div>
          ` : `
            <div style="padding:16px;text-align:center;background:#f8fafc;border-radius:8px;color:#94a3b8;font-size:13px">
              No reviews logged yet. Click "New Review" after in-clinic inspection.
            </div>
          `}
        </div>
      </div>

      <div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
          <h3 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 12px">⚡ 1-Tap Clinical Quick Actions</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-sm" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;text-align:left;font-weight:700" onclick="showAlignerSmartWAModal('${esc(p.id)}', '1_day_before')">
              ⭐ WA: 1 Day Before Switch
            </button>
            <button class="btn btn-sm" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;text-align:left;font-weight:700" onclick="showAlignerSmartWAModal('${esc(p.id)}', 'switch_day')">
              📲 WA: On Set Change Day
            </button>
            <button class="btn btn-sm" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;text-align:left;font-weight:700" onclick="showAlignerSmartWAModal('${esc(p.id)}', '2_days_review')">
              🩺 WA: 2 Days Before Review
            </button>
            <button class="btn btn-sm" style="background:#fefce8;color:#854d0e;border:1px solid #fef08a;text-align:left;font-weight:700" onclick="showAlignerIprModal('${esc(p.id)}')">
              🦷 Log Tooth IPR
            </button>
            <button class="btn btn-sm" style="background:#f5f3ff;color:#6b21a8;border:1px solid #ddd6fe;text-align:left;font-weight:700" onclick="showAlignerAttachmentModal('${esc(p.id)}')">
              📍 Place Attachment
            </button>
            <button class="btn btn-sm" style="background:#fff1f2;color:#9f1239;border:1px solid #fecdd3;text-align:left;font-weight:700" onclick="showAlignerIssueModal('${esc(p.id)}')">
              ⚠️ Register Issue / Delay
            </button>
            ${stats.isPaused ? `
              <button class="btn btn-sm" style="background:#16a34a;color:#fff;border:none;text-align:left;font-weight:700" onclick="showAlignerResumeModal('${esc(p.id)}')">
                ▶️ Resume Treatment
              </button>
            ` : `
              <button class="btn btn-sm" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;text-align:left;font-weight:700" onclick="showAlignerPauseModal('${esc(p.id)}')">
                ⏸️ Pause Treatment
              </button>
            `}
            <button class="btn btn-sm" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;text-align:left;font-weight:700" onclick="showAlignerRefinementModal('${esc(p.id)}')">
              🔄 Start Refinement
            </button>
          </div>
        </div>

        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h3 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0">🦷 Cumulative Tooth IPR Summary</h3>
            <span style="font-size:11px;color:#64748b">${Object.keys(iprCumulative).length} teeth stripped</span>
          </div>
          ${Object.keys(iprCumulative).length > 0 ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${Object.keys(iprCumulative).map(function(t) {
                return '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-weight:700;padding:4px 8px;font-size:12px">#' + t + ' → ' + iprCumulative[t] + ' mm</span>';
              }).join('')}
            </div>
          ` : `
            <div style="font-size:12px;color:#94a3b8;font-style:italic">No IPR recorded yet for this patient.</div>
          `}
        </div>
      </div>
    </div>
  `;
}

/* ── 2. Initial Records Tab ── */
function aligner_renderInitialRecordsTab(p, details) {
  var rec = details.initialRecords || {};
  var photos = rec.photos || {};
  var consent = rec.consentForm || {};

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">📂 Pre-Treatment Initial Records & Diagnostics</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Permanent baseline documentation, X-rays, 3D scan details & digital consent form.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" onclick="showAlignerInitialRecordsModal('${esc(p.id)}')">✏️ Edit Initial Records</button>
          <button class="btn btn-sm btn-outline" onclick="showAlignerConsentModal('${esc(p.id)}')">✍️ Digital Consent Form</button>
          <button class="btn btn-sm btn-ghost" onclick="printAlignerConsent('${esc(p.id)}')">🖨️ Print Consent</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:20px;background:#f8fafc;padding:14px;border-radius:10px;border:1px solid #e2e8f0">
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Scan / Impression Ref #</div>
          <div style="font-size:14px;font-weight:800;color:#1e3a5f">${esc(rec.scanRefNumber || 'Not recorded')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Scan Lab / Company</div>
          <div style="font-size:14px;font-weight:800;color:#1e3a5f">${esc(rec.scanCompany || details.brand || 'Invisalign')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Study Model Ref</div>
          <div style="font-size:14px;font-weight:800;color:#1e3a5f">${esc(rec.studyModelRef || 'Not recorded')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Digital Consent Status</div>
          <div style="font-size:14px;font-weight:800;color:${consent.signed ? '#16a34a' : '#dc2626'}">
            ${consent.signed ? '✅ Signed on ' + formatDate(consent.signedDate) : '⚠️ Unsigned'}
          </div>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 6px">🎯 Written Treatment Objectives</h4>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;color:#334155;line-height:1.6">
          ${rec.treatmentObjectives ? esc(rec.treatmentObjectives).replace(/\n/g, '<br>') : '<span style="color:#94a3b8;font-style:italic">No written treatment objectives entered yet. Click "Edit Initial Records" to document clinical goals.</span>'}
        </div>
      </div>

      <div style="margin-bottom:20px">
        <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 10px">📡 Baseline Radiographs & Scans</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">Panoramic OPG</div>
            ${rec.opgUrl ? `<img src="${rec.opgUrl}" style="max-height:140px;max-width:100%;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open('${rec.opgUrl}')">` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">No OPG uploaded</div>'}
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">Lateral Cephalometric X-ray</div>
            ${rec.cephUrl ? `<img src="${rec.cephUrl}" style="max-height:140px;max-width:100%;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open('${rec.cephUrl}')">` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">No Ceph uploaded</div>'}
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">CBCT Volume / 3D Slice</div>
            ${rec.cbctUrl ? `<img src="${rec.cbctUrl}" style="max-height:140px;max-width:100%;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open('${rec.cbctUrl}')">` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">No CBCT uploaded</div>'}
          </div>
        </div>
      </div>

      <div>
        <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 10px">📸 Pre-Treatment 8-Photo Clinical Protocol</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px">
          ${['frontal', 'smile', 'right', 'left', 'upper', 'lower', 'profile', 'extra'].map(function(key) {
            var labelMap = {
              frontal: '1. Extraoral Frontal',
              smile: '2. Extraoral Smile',
              right: '3. Intraoral Right Buccal',
              left: '4. Intraoral Left Buccal',
              upper: '5. Upper Occlusal',
              lower: '6. Lower Occlusal',
              profile: '7. Extraoral Profile',
              extra: '8. Frontal Occlusion'
            };
            var url = photos[key];
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
                <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${labelMap[key]}</div>
                ${url ? `<img src="${url}" style="height:100px;width:100%;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open('${url}')">` : `
                  <div style="height:100px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">No photo</div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

/* ── 3. Set Calendar Tab ── */
function aligner_renderCalendarTab(p, details, stats, schedule) {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">📅 Automatic Aligner Set Calendar</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">
            Standard: ${details.setDurationDays || 10} days per set • Start: ${formatDate(details.startDate)} • Finish: ${formatDate(stats.estimatedCompletion)}
          </p>
        </div>
        <div style="font-size:12px;color:#0284c7;font-weight:700">
          Total Sets: ${stats.totalSets} (${stats.baseTotalSets} Primary${stats.totalSets > stats.baseTotalSets ? ' + ' + (stats.totalSets - stats.baseTotalSets) + ' Refinement' : ''})
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:10px">
        ${schedule.map(function(s) {
          var isCurrent = s.setNum === stats.activeSet;
          var isPast = s.setNum < stats.activeSet;
          var isDelayed = s.delayDays > 0;

          var borderCol = isCurrent ? '#0284c7' : isDelayed ? '#fca5a5' : '#e2e8f0';
          var bgCol = isCurrent ? '#f0f9ff' : isPast ? '#f8fafc' : '#ffffff';

          return `
            <div style="border:2px solid ${borderCol};background:${bgCol};border-radius:10px;padding:12px;position:relative;box-shadow:${isCurrent ? '0 2px 8px rgba(2,132,199,0.15)' : 'none'}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-weight:800;font-size:14px;color:${isCurrent ? '#0284c7' : '#1e3a5f'}">
                  ${s.isRefinement ? '💎 ' + s.refinementLabel : 'Set #' + s.setNum}
                </span>
                ${isCurrent ? '<span class="badge" style="background:#0284c7;color:#fff;font-size:10px">CURRENT</span>' : isPast ? '<span class="badge" style="background:#ecfdf5;color:#059669;font-size:10px">DONE</span>' : '<span class="badge" style="background:#f1f5f9;color:#64748b;font-size:10px">UPCOMING</span>'}
              </div>
              <div style="font-size:12px;color:#334155;font-weight:600">Start: ${formatDate(s.startDate)}</div>
              <div style="font-size:12px;color:#334155;font-weight:600">Switch: ${formatDate(s.endDate)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:4px">Wear: ${s.durationDays} days ${isDelayed ? '<b style="color:#dc2626">(+' + s.delayDays + 'd delay)</b>' : ''}</div>
              ${s.delayNotes ? `<div style="font-size:10px;color:#dc2626;margin-top:2px;font-style:italic">${esc(s.delayNotes)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/* ── 4. Batches Tab ── */
function aligner_renderBatchesTab(p, details, stats) {
  var batches = details.batches || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">📦 Batch Delivery History</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Aligners handed over in batches to maintain compliance and clinical control.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerDeliverBatchModal('${esc(p.id)}')">➕ Deliver New Batch</button>
      </div>

      ${batches.length === 0 ? `
        <div style="padding:30px;text-align:center;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:8px">📦</div>
          <div style="font-weight:700;color:#475569">No Batch Deliveries Logged</div>
          <p style="font-size:12px;margin:4px 0 12px">Hand over the first set of aligners to the patient.</p>
          <button class="btn btn-primary btn-sm" onclick="showAlignerDeliverBatchModal('${esc(p.id)}')">Deliver Batch 1</button>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${batches.slice().reverse().map(function(b, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="badge" style="background:#0284c7;color:#fff;font-weight:800;font-size:12px">Batch #${b.batchNumber || (batches.length - idx)}</span>
                    <span style="font-weight:800;font-size:15px;color:#1e3a5f">${esc(b.setsIncluded || 'Sets Handed Over')}</span>
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:6px">
                    Delivery Date: <b>${formatDate(b.deliveryDate)}</b> • Expected Finish Date: <b>${b.expectedFinishDate ? formatDate(b.expectedFinishDate) : '—'}</b>
                  </div>
                  ${b.amountReceived ? `<div style="font-size:12px;color:#16a34a;font-weight:700;margin-top:2px">Amount Received: ₹${Number(b.amountReceived).toLocaleString()}</div>` : ''}
                  ${b.notes ? `<div style="font-size:12px;color:#64748b;margin-top:4px">Notes: ${esc(b.notes)}</div>` : ''}
                </div>
                <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteBatch('${esc(p.id)}', '${esc(b.id || idx)}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 5. Reviews Tab ── */
function aligner_renderReviewsTab(p, details, stats) {
  var reviews = details.reviews || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">🩺 Clinical Review Visits</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Tracking evaluation, attachment integrity, compliance verification, and 8-photo progress log.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerReviewModal('${esc(p.id)}')">➕ New Review Visit</button>
      </div>

      ${reviews.length === 0 ? `
        <div style="padding:30px;text-align:center;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:8px">🩺</div>
          <div style="font-weight:700;color:#475569">No Review Visits Logged</div>
          <p style="font-size:12px;margin:4px 0 12px">Record clinical observations when patient comes for routine inspection.</p>
          <button class="btn btn-primary btn-sm" onclick="showAlignerReviewModal('${esc(p.id)}')">Log Review</button>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:14px">
          ${reviews.slice().reverse().map(function(r, idx) {
            var photos = r.photos || {};
            var hasPhotos = Object.values(photos).some(Boolean);
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                  <div>
                    <span style="font-weight:800;font-size:15px;color:#1e3a5f">Visit on ${formatDate(r.date)}</span>
                    <span class="badge" style="background:#e0f2fe;color:#0369a1;margin-left:8px;font-weight:700">Wearing Set #${r.currentSet}</span>
                    <span class="badge" style="background:${r.trackingQuality === 'Excellent' || r.trackingQuality === 'Good' ? '#ecfdf5' : '#fef2f2'};color:${r.trackingQuality === 'Excellent' || r.trackingQuality === 'Good' ? '#059669' : '#dc2626'};margin-left:4px;font-weight:700">
                      Tracking: ${esc(r.trackingQuality || 'Good')}
                    </span>
                  </div>
                  <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteReview('${esc(p.id)}', '${esc(r.id || idx)}')">🗑️</button>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;font-size:12px;color:#334155;margin-bottom:8px">
                  <div>Compliance: <b>${esc(r.compliance || '20-22 hrs/day')}</b></div>
                  <div>Attachments: <b>${esc(r.attachmentStatus || 'Intact')}</b></div>
                  <div>IPR Performed: <b>${r.iprPerformed ? 'Yes' : 'No'}</b></div>
                  <div>Next Review: <b>${r.nextReviewDate ? formatDate(r.nextReviewDate) : '—'}</b></div>
                </div>
                ${r.clinicalNotes ? `<div style="font-size:12px;color:#475569;background:#fff;padding:8px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:8px">"${esc(r.clinicalNotes)}"</div>` : ''}
                ${hasPhotos ? `
                  <div style="display:flex;gap:6px;overflow-x:auto;padding-top:4px">
                    ${Object.keys(photos).map(function(k) {
                      return photos[k] ? `<img src="${photos[k]}" style="height:60px;width:60px;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open('${photos[k]}')">` : '';
                    }).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 6. Dedicated IPR Tab with Cumulative FDI Summary ── */
function aligner_renderIprTab(p, details, iprCumulative) {
  var logs = details.iprLogs || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">🦷 Dedicated Interproximal Reduction (IPR) Log</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Maintain cumulative reduction per tooth to prevent over-stripping and ensure safe enamel reduction.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerIprModal('${esc(p.id)}')">➕ Record IPR Performed</button>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:18px">
        <h4 style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 10px;text-transform:uppercase">
          Cumulative IPR Map (FDI Tooth Numbers & Reduction in mm)
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(60px, 1fr));gap:6px;text-align:center">
          ${[18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28, 48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38].map(function(t) {
            var val = iprCumulative[t] || 0;
            var isStripped = val > 0;
            return `
              <div style="border:1px solid ${isStripped ? '#f59e0b' : '#e2e8f0'};background:${isStripped ? '#fef3c7' : '#ffffff'};border-radius:6px;padding:6px 2px">
                <div style="font-size:11px;font-weight:800;color:#1e3a5f">${t}</div>
                <div style="font-size:11px;font-weight:700;color:${isStripped ? '#b45309' : '#94a3b8'};margin-top:2px">
                  ${isStripped ? val + 'mm' : '—'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${logs.length === 0 ? `
        <div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">
          No IPR entries logged yet. Click "Record IPR Performed" to add stripping details.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${logs.slice().reverse().map(function(log, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-weight:800;font-size:14px;color:#1e3a5f">${formatDate(log.date)}</span>
                    <span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700">Teeth: ${(log.teeth || []).join(', ')}</span>
                    <span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700">${log.amountMm || 0.2} mm</span>
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:4px">
                    Instrument: <b>${esc(log.instrument || 'Diamond Strip')}</b> • Surface: <b>${esc(log.surface || 'Contact')}</b>
                  </div>
                  ${log.notes ? `<div style="font-size:11px;color:#64748b;margin-top:2px">Notes: ${esc(log.notes)}</div>` : ''}
                </div>
                <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteIpr('${esc(p.id)}', '${esc(log.id || idx)}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 7. Dedicated Attachment Tab with Visual FDI Tooth Map ── */
function aligner_renderAttachmentsTab(p, details) {
  var atts = details.attachments || [];
  var activeAttMap = {};
  atts.forEach(function(a) {
    if (a.status !== 'Removed') {
      activeAttMap[a.toothNumber] = a;
    }
  });

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">📍 Dedicated Attachment Log & Visual Tooth Map</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Interactive FDI attachment placement map. Click any tooth to add or edit attachment.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerAttachmentModal('${esc(p.id)}')">➕ Place Attachment</button>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:12px;text-transform:uppercase;text-align:center">
          🦷 Upper Arch (18 to 28)
        </div>
        <div style="display:grid;grid-template-columns:repeat(16, 1fr);gap:4px;text-align:center;margin-bottom:16px">
          ${[18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28].map(function(t) {
            var hasAtt = !!activeAttMap[t];
            return `
              <div onclick="showAlignerAttachmentModal('${esc(p.id)}', '${t}')"
                style="cursor:pointer;border:2px solid ${hasAtt ? '#7c3aed' : '#e2e8f0'};background:${hasAtt ? '#f5f3ff' : '#ffffff'};border-radius:6px;padding:6px 2px;transition:all 0.15s ease">
                <div style="font-size:11px;font-weight:800;color:${hasAtt ? '#7c3aed' : '#1e3a5f'}">${t}</div>
                <div style="font-size:10px;font-weight:700;color:${hasAtt ? '#6d28d9' : '#cbd5e1'};margin-top:2px">${hasAtt ? '📍' : '—'}</div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:12px;text-transform:uppercase;text-align:center">
          🦷 Lower Arch (48 to 38)
        </div>
        <div style="display:grid;grid-template-columns:repeat(16, 1fr);gap:4px;text-align:center">
          ${[48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38].map(function(t) {
            var hasAtt = !!activeAttMap[t];
            return `
              <div onclick="showAlignerAttachmentModal('${esc(p.id)}', '${t}')"
                style="cursor:pointer;border:2px solid ${hasAtt ? '#7c3aed' : '#e2e8f0'};background:${hasAtt ? '#f5f3ff' : '#ffffff'};border-radius:6px;padding:6px 2px;transition:all 0.15s ease">
                <div style="font-size:11px;font-weight:800;color:${hasAtt ? '#7c3aed' : '#1e3a5f'}">${t}</div>
                <div style="font-size:10px;font-weight:700;color:${hasAtt ? '#6d28d9' : '#cbd5e1'};margin-top:2px">${hasAtt ? '📍' : '—'}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${atts.length === 0 ? `
        <div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">
          No attachments recorded. Click a tooth above or "Place Attachment" to record.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${atts.map(function(a, idx) {
            var isActive = a.status !== 'Removed';
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <span class="badge" style="background:#f5f3ff;color:#6b21a8;font-weight:800;font-size:13px">Tooth #${a.toothNumber}</span>
                  <span style="font-weight:700;font-size:13px;color:#1e3a5f;margin-left:8px">${esc(a.attachmentType || 'Standard Beveled')}</span>
                  <span class="badge" style="background:${isActive ? '#ecfdf5' : '#f1f5f9'};color:${isActive ? '#059669' : '#64748b'};margin-left:6px">${a.status || 'Active'}</span>
                  <div style="font-size:12px;color:#64748b;margin-top:4px">
                    Placed on: <b>${formatDate(a.placementDate)}</b> (Set #${a.placementSet || 1}) ${a.removalDate ? '• Removed on: ' + formatDate(a.removalDate) : ''}
                    ${a.notes ? ' • Notes: ' + esc(a.notes) : ''}
                  </div>
                </div>
                <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteAttachment('${esc(p.id)}', '${esc(a.id || idx)}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 8. Payments Tab ── */
function aligner_renderPaymentsTab(p, details, stats) {
  var payments = details.payments || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">💰 Independent Aligner Payment Ledger</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Dedicated financial tracking with instant printable receipts for aligner treatment.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerPaymentModal('${esc(p.id)}')">➕ Add Payment</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;margin-bottom:18px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Total Treatment Fee</div>
          <div style="font-size:22px;font-weight:800;color:#1e3a5f;margin-top:2px">₹${(stats.totalCost || 0).toLocaleString()}</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase">Total Amount Paid</div>
          <div style="font-size:22px;font-weight:800;color:#16a34a;margin-top:2px">₹${(stats.totalPaid || 0).toLocaleString()}</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase">Outstanding Balance</div>
          <div style="font-size:22px;font-weight:800;color:${stats.dueAmount > 0 ? '#dc2626' : '#16a34a'};margin-top:2px">
            ₹${(stats.dueAmount || 0).toLocaleString()}
          </div>
        </div>
      </div>

      ${payments.length === 0 ? `
        <div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">
          No payments recorded yet. Click "Add Payment" to record a transaction.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${payments.slice().reverse().map(function(pay, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-weight:800;font-size:15px;color:#16a34a">₹${Number(pay.amount || 0).toLocaleString()}</span>
                    <span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700">${esc(pay.mode || 'UPI')}</span>
                    <span style="font-size:12px;color:#64748b">on ${formatDate(pay.date)}</span>
                  </div>
                  ${pay.remark ? `<div style="font-size:12px;color:#475569;margin-top:4px">Remark: ${esc(pay.remark)}</div>` : ''}
                </div>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-sm btn-outline" onclick="printAlignerReceipt('${esc(p.id)}', '${esc(pay.id || idx)}')">🖨️ Receipt</button>
                  <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deletePayment('${esc(p.id)}', '${esc(pay.id || idx)}')">🗑️</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 9. Issues & Pause Tab ── */
function aligner_renderIssuesTab(p, details, stats) {
  var delays = details.delays || [];
  var pauses = details.pauses || [];

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">⚠️ Clinical Delays & Treatment Pause History</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">
            Registered delays and pauses dynamically adjust all future set dates without altering past history.
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="showAlignerIssueModal('${esc(p.id)}')">⚠️ Register Issue / Delay</button>
          ${stats.isPaused ? `
            <button class="btn btn-sm" style="background:#16a34a;color:#fff;border:none;font-weight:700" onclick="showAlignerResumeModal('${esc(p.id)}')">
              ▶️ Resume Treatment
            </button>
          ` : `
            <button class="btn btn-sm" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:700" onclick="showAlignerPauseModal('${esc(p.id)}')">
              ⏸️ Pause Treatment
            </button>
          `}
        </div>
      </div>

      ${stats.isPaused ? `
        <div style="background:#fef2f2;border:2px solid #f87171;border-radius:10px;padding:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:15px;font-weight:800;color:#dc2626">⏸️ Treatment Is Currently Paused</div>
            <div style="font-size:12px;color:#7f1d1d;margin-top:2px">
              Reminders and future schedule calculations are frozen until treatment is resumed.
            </div>
          </div>
          <button class="btn btn-sm" style="background:#16a34a;color:#fff;border:none;font-weight:700" onclick="showAlignerResumeModal('${esc(p.id)}')">
            ▶️ Resume Treatment
          </button>
        </div>
      ` : ''}

      <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 10px">Registered Set Delays (${delays.length})</h4>
      ${delays.length === 0 ? `
        <div style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;background:#f8fafc;border-radius:8px;margin-bottom:18px">
          No delays registered. Patient is on perfect schedule!
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
          ${delays.slice().reverse().map(function(d, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:800">Issue: ${esc(d.issueType || 'Delay')}</span>
                    <span style="font-weight:700;font-size:13px;color:#1e3a5f">Affected Set #${d.affectedSet}</span>
                    <span style="font-size:12px;color:#ea580c;font-weight:700">+${d.delayDays} Days Lost</span>
                  </div>
                  <div style="font-size:12px;color:#64748b;margin-top:4px">
                    Reported on: <b>${formatDate(d.date)}</b> ${d.resumeDate ? '• Resumed: ' + formatDate(d.resumeDate) : ''}
                    ${d.notes ? ' • Notes: ' + esc(d.notes) : ''}
                  </div>
                </div>
                <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteIssue('${esc(p.id)}', '${esc(d.id || idx)}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>
      `}

      <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 10px">Treatment Pauses History (${pauses.length})</h4>
      ${pauses.length === 0 ? `
        <div style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;background:#f8fafc;border-radius:8px">
          No planned pauses registered.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${pauses.slice().reverse().map(function(pz, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="font-weight:800;font-size:13px;color:#1e3a5f">
                    Reason: ${esc(pz.reason || 'Travel')} ${pz.active ? '<span class="badge" style="background:#fee2e2;color:#991b1b">ACTIVE PAUSE</span>' : '<span class="badge" style="background:#ecfdf5;color:#059669">COMPLETED</span>'}
                  </div>
                </div>
                <div style="font-size:12px;color:#475569;margin-top:4px">
                  Paused on: <b>${formatDate(pz.pauseStart)}</b> • Resumed on: <b>${pz.actualResume ? formatDate(pz.actualResume) : 'In Pause'}</b>
                  ${pz.notes ? ' • Notes: ' + esc(pz.notes) : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 10. Refinements Tab ── */
function aligner_renderRefinementsTab(p, details, stats) {
  var refs = details.refinements || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">🔄 Aligner Refinement Phases</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Mid-course corrections and additional finishing sets while preserving complete original phase history.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerRefinementModal('${esc(p.id)}')">➕ Start Refinement</button>
      </div>

      ${refs.length === 0 ? `
        <div style="padding:30px;text-align:center;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:8px">🔄</div>
          <div style="font-weight:700;color:#475569">No Refinements Required</div>
          <p style="font-size:12px;margin:4px 0 12px">Patient is progressing on primary aligner series.</p>
          <button class="btn btn-outline btn-sm" onclick="showAlignerRefinementModal('${esc(p.id)}')">Start Refinement (R1)</button>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${refs.map(function(r, idx) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="badge" style="background:#fef3c7;color:#92400e;font-weight:800;font-size:13px">${esc(r.refinementNumber || ('R' + (idx + 1)))}</span>
                    <span style="font-weight:800;font-size:15px;color:#1e3a5f">+${r.additionalSets || 0} Additional Sets</span>
                    ${r.cost ? `<span class="badge" style="background:#ecfdf5;color:#059669">+₹${Number(r.cost).toLocaleString()}</span>` : ''}
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:6px">
                    New Scan Date: <b>${formatDate(r.scanDate)}</b> • Delivery Date: <b>${r.deliveryDate ? formatDate(r.deliveryDate) : 'Pending Delivery'}</b>
                  </div>
                  ${r.notes ? `<div style="font-size:12px;color:#64748b;margin-top:4px">Clinical Rationale: ${esc(r.notes)}</div>` : ''}
                </div>
                <button class="btn btn-sm btn-ghost" style="color:#ef4444" onclick="aligner_deleteRefinement('${esc(p.id)}', '${esc(r.id || idx)}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ── 11. Retainer Phase Tab ── */
function aligner_renderRetentionTab(p, details, stats) {
  var ret = details.retention || {};
  var reviews = ret.reviews || [];

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">🛡️ Retainer Phase & Long-Term Stability</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">
            Post-treatment retention protocols, retainer fabrication details, and automatic 1M, 3M, 6M, 12M recall schedule.
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="showAlignerRetentionModal('${esc(p.id)}')">
            ${ret.active ? '⚙️ Update Retention Setup' : '🏁 Mark Complete & Start Retention'}
          </button>
          <button class="btn btn-outline btn-sm" onclick="printAlignerDischargeSummary('${esc(p.id)}')">
            📄 Discharge Summary PDF
          </button>
        </div>
      </div>

      ${!ret.active ? `
        <div style="padding:30px;text-align:center;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:8px">🛡️</div>
          <div style="font-weight:700;color:#475569">Active Aligner Phase in Progress</div>
          <p style="font-size:12px;margin:4px 0 14px">
            When all aligner sets are completed, click below to mark treatment complete and configure retainer delivery.
          </p>
          <button class="btn btn-primary btn-sm" onclick="showAlignerRetentionModal('${esc(p.id)}')">Mark Treatment Complete</button>
        </div>
      ` : `
        <div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="badge" style="background:#16a34a;color:#fff;font-weight:800;font-size:13px">Retention Active</span>
              <span style="font-size:13px;font-weight:700;color:#166534">Delivered on: ${formatDate(ret.deliveryDate)}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-top:10px;font-size:13px;color:#334155">
              <div>Retainer Type: <b>${esc(ret.retainerType || 'Essix')}</b></div>
              <div>Retainer Cost: <b>₹${Number(ret.retainerCost || 0).toLocaleString()}</b></div>
              <div>Wear Instructions: <b>${esc(ret.wearInstructions || 'Night-only')}</b></div>
            </div>
            ${ret.notes ? `<div style="font-size:12px;color:#64748b;margin-top:8px">Notes: ${esc(ret.notes)}</div>` : ''}
          </div>

          <h4 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 10px">Scheduled Retention Review Milestones</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px">
            ${reviews.map(function(rv, idx) {
              var isDone = rv.status === 'completed';
              return `
                <div style="border:1px solid ${isDone ? '#86efac' : '#e2e8f0'};background:${isDone ? '#f0fdf4' : '#ffffff'};border-radius:8px;padding:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:800;font-size:13px;color:#1e3a5f">${esc(rv.milestone)}</span>
                    <span class="badge" style="background:${isDone ? '#16a34a' : '#f1f5f9'};color:${isDone ? '#fff' : '#64748b'};font-size:10px">${isDone ? 'DONE' : 'PENDING'}</span>
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:6px">Target: <b>${rv.expectedDate ? formatDate(rv.expectedDate) : '—'}</b></div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `}
    </div>
  `;
}

/* ── 12. WhatsApp History Tab ── */
function aligner_renderWaHistoryTab(p, details) {
  var history = details.waHistory || [];
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #f1f5f9;padding-bottom:12px">
        <div>
          <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0">📱 WhatsApp Communication History Log</h3>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Permanent audit log of all reminders and clinical notices dispatched to patient.</p>
        </div>
        <button class="btn btn-sm" style="background:#25D366;color:#fff;border:none;font-weight:700" onclick="showAlignerSmartWAModal('${esc(p.id)}')">
          💬 Send New Reminder
        </button>
      </div>

      ${history.length === 0 ? `
        <div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">
          No WhatsApp messages sent yet. Use "Send New Reminder" above.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${history.slice().reverse().map(function(item) {
            return `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span class="badge" style="background:#ecfdf5;color:#059669;font-weight:800">WhatsApp Dispatched</span>
                    <span style="font-weight:700;font-size:13px;color:#1e3a5f">${esc(item.messageType || 'Reminder')}</span>
                  </div>
                  <span style="font-size:11px;color:#94a3b8">${esc(item.date || '')}</span>
                </div>
                <div style="font-size:12px;color:#475569;background:#fff;padding:8px;border-radius:6px;border:1px solid #e2e8f0;font-family:monospace;white-space:pre-wrap">${esc(item.preview || '')}</div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/* ══════════════════════════════════════════════════════
   MODALS & DIALOGS (ALIGNER MODULE 2.0)
   ══════════════════════════════════════════════════════ */

/* ── 1. Setup Modal ── */
function showAlignerSetupModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var modalId = 'modal-aligner-setup';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">⚙️ Initial Aligner Treatment Setup</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Start Date</label>
          <input type="date" id="al-setup-start" class="form-input" value="${details.startDate || todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Company / Brand</label>
          <input type="text" id="al-setup-brand" class="form-input" value="${esc(details.brand || 'Invisalign')}" placeholder="e.g. Invisalign, Spark, Illusion">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Total Aligner Sets</label>
          <input type="number" id="al-setup-total-sets" class="form-input" min="1" max="200" value="${details.totalSets || 20}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Sets Per Batch</label>
          <input type="number" id="al-setup-batch-sets" class="form-input" min="1" max="50" value="${details.setsPerBatch || 5}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Set Duration (Days)</label>
          <select id="al-setup-duration" class="form-input">
            <option value="7" ${details.setDurationDays == 7 ? 'selected' : ''}>7 Days</option>
            <option value="10" ${details.setDurationDays == 10 ? 'selected' : ''}>10 Days (Standard)</option>
            <option value="14" ${details.setDurationDays == 14 ? 'selected' : ''}>14 Days</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Review Interval (Days)</label>
          <input type="number" id="al-setup-review-int" class="form-input" min="7" max="90" value="${details.reviewIntervalDays || 30}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Total Treatment Cost (₹)</label>
          <input type="number" id="al-setup-cost" class="form-input" min="0" step="1000" value="${details.totalCost || 0}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Initial Advance Paid (₹)</label>
          <input type="number" id="al-setup-advance" class="form-input" min="0" step="1000" value="${details.paidAmount || 0}">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Setup Notes</label>
        <textarea id="al-setup-notes" class="form-input" rows="2" placeholder="Case complexity, extraction/non-extraction...">${esc(details.notes || '')}</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveSetupModal('${esc(p.id)}')">Save & Generate Calendar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveSetupModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var totalCost = Number(document.getElementById('al-setup-cost').value) || 0;
  var advance = Number(document.getElementById('al-setup-advance').value) || 0;

  details.startDate = document.getElementById('al-setup-start').value || todayISO();
  details.firstSetDate = details.startDate;
  details.brand = document.getElementById('al-setup-brand').value.trim() || 'Invisalign';
  details.totalSets = parseInt(document.getElementById('al-setup-total-sets').value) || 20;
  details.setsPerBatch = parseInt(document.getElementById('al-setup-batch-sets').value) || 5;
  details.setDurationDays = parseInt(document.getElementById('al-setup-duration').value) || 10;
  details.reviewIntervalDays = parseInt(document.getElementById('al-setup-review-int').value) || 30;
  details.totalCost = totalCost;
  details.notes = document.getElementById('al-setup-notes').value.trim();

  if (advance > 0 && (!details.payments || details.payments.length === 0)) {
    details.payments = [{
      id: 'pay_' + Date.now(),
      date: details.startDate,
      amount: advance,
      mode: 'UPI',
      remark: 'Initial Treatment Advance'
    }];
  }

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-setup').remove();
  renderAlignerDetailTab();
  showToast('Aligner treatment setup saved successfully!');
}

/* ── 2. Initial Records Modal ── */
function showAlignerInitialRecordsModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var rec = details.initialRecords || {};
  var photos = rec.photos || {};

  var modalId = 'modal-aligner-records';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">📂 Edit Initial Records & Diagnostics</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Scan / Impression Ref #</label>
          <input type="text" id="al-rec-scan-ref" class="form-input" value="${esc(rec.scanRefNumber || '')}" placeholder="e.g. INV-98214">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Scan Lab / Company</label>
          <input type="text" id="al-rec-scan-lab" class="form-input" value="${esc(rec.scanCompany || '')}" placeholder="e.g. Align Tech Lab">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Study Model Reference / Cast ID</label>
        <input type="text" id="al-rec-study-ref" class="form-input" value="${esc(rec.studyModelRef || '')}" placeholder="e.g. Cast Box #14">
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Written Treatment Objectives</label>
        <textarea id="al-rec-objectives" class="form-input" rows="3" placeholder="e.g. Correct Class II div 1, align upper anteriors, maintain canine Class I...">${esc(rec.treatmentObjectives || '')}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">OPG Image URL / Upload</label>
          <input type="text" id="al-rec-opg" class="form-input" value="${esc(rec.opgUrl || '')}" placeholder="https://... or upload">
          <input type="file" accept="image/*" style="font-size:11px;margin-top:4px" onchange="aligner_handleImageUpload(this, 'al-rec-opg')">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Cephalometric X-ray URL / Upload</label>
          <input type="text" id="al-rec-ceph" class="form-input" value="${esc(rec.cephUrl || '')}" placeholder="https://... or upload">
          <input type="file" accept="image/*" style="font-size:11px;margin-top:4px" onchange="aligner_handleImageUpload(this, 'al-rec-ceph')">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">CBCT Volume Slice URL / Upload</label>
        <input type="text" id="al-rec-cbct" class="form-input" value="${esc(rec.cbctUrl || '')}" placeholder="https://... or upload">
        <input type="file" accept="image/*" style="font-size:11px;margin-top:4px" onchange="aligner_handleImageUpload(this, 'al-rec-cbct')">
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:700;color:#1e3a5f;display:block;margin-bottom:8px">Pre-Treatment 8-Photo URLs / Uploads</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${['frontal', 'smile', 'right', 'left', 'upper', 'lower', 'profile', 'extra'].map(function(k) {
            return `
              <div>
                <span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">${k}</span>
                <input type="text" id="al-rec-photo-${k}" class="form-input" style="font-size:11px" value="${esc(photos[k] || '')}" placeholder="URL">
                <input type="file" accept="image/*" style="font-size:10px;margin-top:2px" onchange="aligner_handleImageUpload(this, 'al-rec-photo-${k}')">
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveInitialRecordsModal('${esc(p.id)}')">Save Records</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_handleImageUpload(inputEl, targetInputId) {
  if (inputEl.files && inputEl.files[0]) {
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById(targetInputId).value = e.target.result;
    };
    reader.readAsDataURL(inputEl.files[0]);
  }
}

function aligner_saveInitialRecordsModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  details.initialRecords = details.initialRecords || {};
  details.initialRecords.scanRefNumber = document.getElementById('al-rec-scan-ref').value.trim();
  details.initialRecords.scanCompany = document.getElementById('al-rec-scan-lab').value.trim();
  details.initialRecords.studyModelRef = document.getElementById('al-rec-study-ref').value.trim();
  details.initialRecords.treatmentObjectives = document.getElementById('al-rec-objectives').value.trim();
  details.initialRecords.opgUrl = document.getElementById('al-rec-opg').value.trim();
  details.initialRecords.cephUrl = document.getElementById('al-rec-ceph').value.trim();
  details.initialRecords.cbctUrl = document.getElementById('al-rec-cbct').value.trim();

  details.initialRecords.photos = details.initialRecords.photos || {};
  ['frontal', 'smile', 'right', 'left', 'upper', 'lower', 'profile', 'extra'].forEach(function(k) {
    var el = document.getElementById('al-rec-photo-' + k);
    if (el) details.initialRecords.photos[k] = el.value.trim();
  });

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-records').remove();
  renderAlignerDetailTab();
  showToast('Initial records updated successfully!');
}

/* ── 3. Digital Consent Form Modal with Signature Pad ── */
function showAlignerConsentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var rec = details.initialRecords || {};
  var consent = rec.consentForm || {};

  var modalId = 'modal-aligner-consent';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">✍️ Digital Clear Aligner Consent Form</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#334155;line-height:1.6;max-height:180px;overflow-y:auto;margin-bottom:14px">
        <b>THE HOME OF SMILES — CLEAR ALIGNER INFORMED CONSENT</b><br><br>
        1. <b>Wear Compliance</b>: I understand that aligners must be worn 20–22 hours per day, removing them only for eating, drinking hot/sugary liquids, and oral hygiene.<br>
        2. <b>IPR & Attachments</b>: I consent to composite attachments placed on teeth and interproximal reduction (IPR) as required by the digital setup.<br>
        3. <b>Treatment Duration & Delays</b>: Estimated treatment duration depends on consistent wear. Lost aligners, poor compliance, or missed reviews will extend completion time.<br>
        4. <b>Refinement & Retention</b>: Minor refinements may be required at the conclusion of active sets. Lifelong retention wear is necessary to maintain stability.<br><br>
        I have read, understood, and accept these conditions.
      </div>

      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label style="font-size:11px;font-weight:700;color:#475569">Patient / Guardian Digital Signature</label>
          <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:2px 8px" onclick="aligner_clearSignatureCanvas()">Clear Signature</button>
        </div>
        <canvas id="al-consent-canvas" width="500" height="140" style="border:1px dashed #cbd5e1;background:#ffffff;border-radius:8px;width:100%;touch-action:none;cursor:crosshair"></canvas>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveConsentModal('${esc(p.id)}')">Sign & Authorize</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(aligner_initSignatureCanvas, 100);
}

var _aligner_canvas_drawing = false;
function aligner_initSignatureCanvas() {
  var canvas = document.getElementById('al-consent-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var clientX = e.clientX || (e.touches && e.touches[0].clientX);
    var clientY = e.clientY || (e.touches && e.touches[0].clientY);
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.onmousedown = canvas.ontouchstart = function(e) {
    _aligner_canvas_drawing = true;
    var pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    if (e.preventDefault) e.preventDefault();
  };

  canvas.onmousemove = canvas.ontouchmove = function(e) {
    if (!_aligner_canvas_drawing) return;
    var pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    if (e.preventDefault) e.preventDefault();
  };

  window.onmouseup = window.ontouchend = function() {
    _aligner_canvas_drawing = false;
  };
}

function aligner_clearSignatureCanvas() {
  var canvas = document.getElementById('al-consent-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function aligner_saveConsentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var canvas = document.getElementById('al-consent-canvas');
  var sigUrl = canvas ? canvas.toDataURL() : '';

  details.initialRecords = details.initialRecords || {};
  details.initialRecords.consentForm = {
    signed: true,
    signedDate: todayISO(),
    signatureDataUrl: sigUrl,
    consentTerms: 'Signed Informed Consent at The Home of Smiles'
  };

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-consent').remove();
  renderAlignerDetailTab();
  showToast('Consent form signed & stored successfully!');
}

/* ── 4. Deliver Batch Modal ── */
function showAlignerDeliverBatchModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var batches = details.batches || [];
  var nextBatchNum = batches.length + 1;

  var currentDeliveredMax = 0;
  batches.forEach(function(b) {
    if (b.toSet && parseInt(b.toSet) > currentDeliveredMax) currentDeliveredMax = parseInt(b.toSet);
  });
  var startSet = currentDeliveredMax + 1;
  var endSet = Math.min(details.totalSets || 20, startSet + (details.setsPerBatch || 5) - 1);

  var modalId = 'modal-aligner-batch';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">📦 Deliver Aligner Batch</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Batch Number</label>
          <input type="number" id="al-batch-num" class="form-input" value="${nextBatchNum}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Delivery Date</label>
          <input type="date" id="al-batch-date" class="form-input" value="${todayISO()}">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Sets Included</label>
        <input type="text" id="al-batch-sets" class="form-input" value="Sets ${startSet} to ${endSet}" placeholder="e.g. Sets 1 to 5">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Expected Finish Date</label>
          <input type="date" id="al-batch-finish" class="form-input" value="${addDaysToDate(todayISO(), (endSet - startSet + 1) * (details.setDurationDays || 10))}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Amount Received (₹)</label>
          <input type="number" id="al-batch-amt" class="form-input" placeholder="0">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Handover Notes (Chewies, Case, Instructions)</label>
        <textarea id="al-batch-notes" class="form-input" rows="2" placeholder="Given 2 packs chewies, aligner case, wear instructions...">Handed over with aligner case and 2 packs chewies.</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveDeliverBatchModal('${esc(p.id)}')">Save Batch Handover</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveDeliverBatchModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var amt = Number(document.getElementById('al-batch-amt').value) || 0;
  var deliveryDate = document.getElementById('al-batch-date').value || todayISO();

  var newBatch = {
    id: 'batch_' + Date.now(),
    batchNumber: parseInt(document.getElementById('al-batch-num').value) || 1,
    deliveryDate: deliveryDate,
    setsIncluded: document.getElementById('al-batch-sets').value.trim(),
    expectedFinishDate: document.getElementById('al-batch-finish').value,
    amountReceived: amt,
    notes: document.getElementById('al-batch-notes').value.trim()
  };

  details.batches = details.batches || [];
  details.batches.push(newBatch);

  if (amt > 0) {
    details.payments = details.payments || [];
    details.payments.push({
      id: 'pay_' + Date.now(),
      date: deliveryDate,
      amount: amt,
      mode: 'UPI',
      remark: 'Payment on ' + newBatch.setsIncluded + ' Handover'
    });
  }

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-batch').remove();
  renderAlignerDetailTab();
  showToast('Batch delivered & recorded successfully!');
}

/* ── 5. Review Visit Modal ── */
function showAlignerReviewModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var modalId = 'modal-aligner-review';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">🩺 New Clinical Review Visit</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Review Date</label>
          <input type="date" id="al-rev-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Current Set Wearing</label>
          <input type="number" id="al-rev-current-set" class="form-input" min="1" max="${stats.totalSets}" value="${stats.activeSet}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Tracking Quality</label>
          <select id="al-rev-tracking" class="form-input">
            <option value="Excellent">Excellent (100% Fit)</option>
            <option value="Good" selected>Good (Seating well)</option>
            <option value="Fair">Fair (Minor incisal gap)</option>
            <option value="Poor">Poor (Tracking loss)</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Compliance Score</label>
          <select id="al-rev-compliance" class="form-input">
            <option value="22 hrs/day" selected>22 hrs/day (Excellent)</option>
            <option value="20 hrs/day">20 hrs/day (Good)</option>
            <option value="18 hrs/day">18 hrs/day (Fair)</option>
            <option value="<16 hrs/day">&lt;16 hrs/day (Poor)</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Attachment Status</label>
          <select id="al-rev-attachments" class="form-input">
            <option value="Intact" selected>All Intact</option>
            <option value="Rebonded">Rebonded (Done today)</option>
            <option value="Detached">Detached (Needs replacement)</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">IPR Performed Today?</label>
          <select id="al-rev-ipr" class="form-input">
            <option value="no" selected>No</option>
            <option value="yes">Yes (Recorded in IPR tab)</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Next Review Date</label>
        <input type="date" id="al-rev-next-date" class="form-input" value="${addDaysToDate(todayISO(), details.reviewIntervalDays || 30)}">
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Notes</label>
        <textarea id="al-rev-notes" class="form-input" rows="2" placeholder="Clinical observations, seating, chewies wear..."></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveReviewModal('${esc(p.id)}')">Save Review</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveReviewModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var currentSet = parseInt(document.getElementById('al-rev-current-set').value) || details.currentSet || 1;
  details.currentSet = currentSet;

  var newReview = {
    id: 'rev_' + Date.now(),
    date: document.getElementById('al-rev-date').value || todayISO(),
    currentSet: currentSet,
    trackingQuality: document.getElementById('al-rev-tracking').value,
    compliance: document.getElementById('al-rev-compliance').value,
    attachmentStatus: document.getElementById('al-rev-attachments').value,
    iprPerformed: document.getElementById('al-rev-ipr').value === 'yes',
    nextReviewDate: document.getElementById('al-rev-next-date').value,
    clinicalNotes: document.getElementById('al-rev-notes').value.trim()
  };

  details.reviews = details.reviews || [];
  details.reviews.push(newReview);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-review').remove();
  renderAlignerDetailTab();
  showToast('Clinical review logged successfully!');
}

/* ── 6. Dedicated IPR Modal ── */
function showAlignerIprModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;

  var modalId = 'modal-aligner-ipr';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">🦷 Log Interproximal Reduction (IPR)</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Visit Date</label>
          <input type="date" id="al-ipr-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Amount Removed (mm)</label>
          <select id="al-ipr-amt" class="form-input">
            <option value="0.1">0.1 mm</option>
            <option value="0.2" selected>0.2 mm</option>
            <option value="0.3">0.3 mm</option>
            <option value="0.4">0.4 mm</option>
            <option value="0.5">0.5 mm</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Select FDI Teeth Stripped</label>
        <div style="display:grid;grid-template-columns:repeat(16, 1fr);gap:2px;text-align:center;margin-bottom:6px">
          ${[18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28].map(function(t) {
            return `<label style="font-size:10px;cursor:pointer"><input type="checkbox" class="ipr-tooth-chk" value="${t}"><br>${t}</label>`;
          }).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(16, 1fr);gap:2px;text-align:center">
          ${[48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38].map(function(t) {
            return `<label style="font-size:10px;cursor:pointer"><input type="checkbox" class="ipr-tooth-chk" value="${t}"><br>${t}</label>`;
          }).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Instrument Used</label>
          <select id="al-ipr-instr" class="form-input">
            <option value="Diamond Strip" selected>Diamond Strip</option>
            <option value="Oscillating Disc">Oscillating Disc</option>
            <option value="Manual Strip">Manual Metal Strip</option>
            <option value="High-speed Fine Bur">High-speed Fine Bur</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Contact Surface</label>
          <select id="al-ipr-surf" class="form-input">
            <option value="Mesial & Distal" selected>Mesial & Distal</option>
            <option value="Mesial Only">Mesial Only</option>
            <option value="Distal Only">Distal Only</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Notes</label>
        <textarea id="al-ipr-notes" class="form-input" rows="2" placeholder="Space opened, contact flossed, fluoride applied..."></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveIprModal('${esc(p.id)}')">Save IPR Record</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveIprModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var selectedTeeth = [];
  document.querySelectorAll('.ipr-tooth-chk:checked').forEach(function(el) {
    selectedTeeth.push(el.value);
  });

  if (selectedTeeth.length === 0) {
    showToast('Please select at least one tooth for IPR!');
    return;
  }

  var amt = parseFloat(document.getElementById('al-ipr-amt').value) || 0.2;
  var perTooth = {};
  selectedTeeth.forEach(function(t) { perTooth[t] = amt; });

  var newIpr = {
    id: 'ipr_' + Date.now(),
    date: document.getElementById('al-ipr-date').value || todayISO(),
    teeth: selectedTeeth,
    amountMm: amt,
    perTooth: perTooth,
    instrument: document.getElementById('al-ipr-instr').value,
    surface: document.getElementById('al-ipr-surf').value,
    notes: document.getElementById('al-ipr-notes').value.trim()
  };

  details.iprLogs = details.iprLogs || [];
  details.iprLogs.push(newIpr);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-ipr').remove();
  renderAlignerDetailTab();
  showToast('IPR recorded & cumulative totals updated!');
}

/* ── 7. Dedicated Attachment Modal ── */
function showAlignerAttachmentModal(ptId, preselectTooth) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var modalId = 'modal-aligner-att';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">📍 Place / Edit Attachment</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">FDI Tooth Number</label>
          <input type="text" id="al-att-tooth" class="form-input" value="${esc(preselectTooth || '14')}" placeholder="e.g. 14, 23, 44">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Placement Set #</label>
          <input type="number" id="al-att-set" class="form-input" min="1" value="${details.currentSet || 1}">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Attachment Type</label>
        <select id="al-att-type" class="form-input">
          <option value="Rectangular Beveled" selected>Rectangular Beveled</option>
          <option value="Ellipsoidal">Ellipsoidal</option>
          <option value="Multi-plane Optimized">Multi-plane Optimized</option>
          <option value="Bite Ramp">Bite Ramp (Lingual)</option>
          <option value="Precision Hook">Precision Hook for Elastics</option>
          <option value="Bonded Button">Bonded Button</option>
        </select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Placement Date</label>
          <input type="date" id="al-att-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Status</label>
          <select id="al-att-status" class="form-input">
            <option value="Active" selected>Active</option>
            <option value="Removed">Removed</option>
            <option value="Rebonded">Rebonded</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Notes / Surface</label>
        <input type="text" id="al-att-notes" class="form-input" placeholder="Buccal surface, flowable composite...">
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveAttachmentModal('${esc(p.id)}')">Save Attachment</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveAttachmentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var tooth = document.getElementById('al-att-tooth').value.trim();
  if (!tooth) {
    showToast('Please enter tooth number!');
    return;
  }

  var newAtt = {
    id: 'att_' + Date.now(),
    toothNumber: tooth,
    attachmentType: document.getElementById('al-att-type').value,
    placementDate: document.getElementById('al-att-date').value || todayISO(),
    placementSet: parseInt(document.getElementById('al-att-set').value) || 1,
    status: document.getElementById('al-att-status').value,
    removalDate: document.getElementById('al-att-status').value === 'Removed' ? todayISO() : '',
    notes: document.getElementById('al-att-notes').value.trim()
  };

  details.attachments = details.attachments || [];
  details.attachments.push(newAtt);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-att').remove();
  renderAlignerDetailTab();
  showToast('Attachment saved & tooth map updated!');
}

/* ── 8. Payment Modal ── */
function showAlignerPaymentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var modalId = 'modal-aligner-pay';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">💰 Add Aligner Payment</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="background:#f8fafc;padding:10px;border-radius:8px;margin-bottom:12px;display:flex;justify-content:space-between;font-size:12px">
        <span>Total Fee: <b>₹${(stats.totalCost || 0).toLocaleString()}</b></span>
        <span style="color:#dc2626">Due: <b>₹${(stats.dueAmount || 0).toLocaleString()}</b></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Payment Date</label>
          <input type="date" id="al-pay-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Amount (₹)</label>
          <input type="number" id="al-pay-amt" class="form-input" min="1" step="500" value="${stats.dueAmount > 0 ? stats.dueAmount : 10000}">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Payment Mode</label>
        <select id="al-pay-mode" class="form-input">
          <option value="UPI" selected>UPI / GooglePay / PhonePe</option>
          <option value="Cash">Cash</option>
          <option value="Credit/Debit Card">Credit/Debit Card</option>
          <option value="Bank Transfer">Bank NEFT / IMPS</option>
          <option value="Cheque">Cheque</option>
        </select>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Remark / Ref Number</label>
        <input type="text" id="al-pay-ref" class="form-input" placeholder="e.g. Batch 2 installment / UPI Ref #">
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_savePaymentModal('${esc(p.id)}')">Save & Print Receipt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_savePaymentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var amt = Number(document.getElementById('al-pay-amt').value) || 0;
  if (amt <= 0) {
    showToast('Please enter a valid payment amount!');
    return;
  }

  var payId = 'pay_' + Date.now();
  var newPay = {
    id: payId,
    date: document.getElementById('al-pay-date').value || todayISO(),
    amount: amt,
    mode: document.getElementById('al-pay-mode').value,
    remark: document.getElementById('al-pay-ref').value.trim()
  };

  details.payments = details.payments || [];
  details.payments.push(newPay);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-pay').remove();
  renderAlignerDetailTab();
  showToast('Payment recorded successfully!');
  printAlignerReceipt(p.id, payId);
}

/* ── 9. Issue & Delay Modal ── */
function showAlignerIssueModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var modalId = 'modal-aligner-issue';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:460px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#dc2626">⚠️ Register Issue / Set Delay</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Date Reported</label>
          <input type="date" id="al-iss-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Affected Set #</label>
          <input type="number" id="al-iss-set" class="form-input" min="1" value="${details.currentSet || 1}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Issue Type</label>
          <select id="al-iss-type" class="form-input">
            <option value="Lost">Lost Aligner</option>
            <option value="Broken">Broken Aligner</option>
            <option value="Poor Tracking">Poor Tracking / Gap</option>
            <option value="Waiting Remake">Waiting Remake / Lab</option>
            <option value="Patient Didn't Wear">Patient Didn't Wear</option>
            <option value="Other">Other Clinical Delay</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Days Lost (Delay Days)</label>
          <input type="number" id="al-iss-days" class="form-input" min="1" max="60" value="5">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Resolution Notes</label>
        <textarea id="al-iss-notes" class="form-input" rows="2" placeholder="Patient instructed to step back to previous set until replacement..."></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" style="background:#dc2626" onclick="aligner_saveIssueModal('${esc(p.id)}')">Recalculate Schedule</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveIssueModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var delayDays = parseInt(document.getElementById('al-iss-days').value) || 0;
  var newDelay = {
    id: 'del_' + Date.now(),
    date: document.getElementById('al-iss-date').value || todayISO(),
    affectedSet: parseInt(document.getElementById('al-iss-set').value) || details.currentSet || 1,
    issueType: document.getElementById('al-iss-type').value,
    delayDays: delayDays,
    notes: document.getElementById('al-iss-notes').value.trim()
  };

  details.delays = details.delays || [];
  details.delays.push(newDelay);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-issue').remove();
  renderAlignerDetailTab();
  showToast('Issue registered & future schedule shifted forward by ' + delayDays + ' days!');
}

/* ── 10. Pause & Resume Modals ── */
function showAlignerPauseModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;

  var modalId = 'modal-aligner-pause';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">⏸️ Pause Treatment</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Pause Start Date</label>
          <input type="date" id="al-pause-start" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Expected Resume Date</label>
          <input type="date" id="al-pause-exp" class="form-input" value="${addDaysToDate(todayISO(), 30)}">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Pause Reason</label>
        <select id="al-pause-reason" class="form-input">
          <option value="Travel">Traveling Abroad / Out of Station</option>
          <option value="Pregnancy">Pregnancy / Medical Reason</option>
          <option value="Financial">Financial Pause</option>
          <option value="Illness">Illness / Surgery</option>
          <option value="Other">Other Personal Reason</option>
        </select>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Instructions During Pause</label>
        <textarea id="al-pause-notes" class="form-input" rows="2" placeholder="Instructed to wear current set at night only to hold position...">Instructed to wear current set at night only to maintain position.</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_savePauseModal('${esc(p.id)}')">Confirm Pause</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_savePauseModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var newPause = {
    id: 'pause_' + Date.now(),
    pauseStart: document.getElementById('al-pause-start').value || todayISO(),
    expectedResume: document.getElementById('al-pause-exp').value,
    actualResume: '',
    reason: document.getElementById('al-pause-reason').value,
    notes: document.getElementById('al-pause-notes').value.trim(),
    active: true
  };

  details.pauses = details.pauses || [];
  details.pauses.push(newPause);
  details.treatmentStatus = 'paused';

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-pause').remove();
  renderAlignerDetailTab();
  showToast('Treatment paused. Reminders and future schedule calculations are frozen.');
}

function showAlignerResumeModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;

  var modalId = 'modal-aligner-resume';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#16a34a">▶️ Resume Treatment</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Actual Resume Date</label>
        <input type="date" id="al-resume-date" class="form-input" value="${todayISO()}">
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Evaluation Upon Resume</label>
        <textarea id="al-resume-notes" class="form-input" rows="2" placeholder="Fit checked, tracking verified, resumed standard wear schedule...">Fit evaluated, attachments intact, resuming full-time wear.</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" style="background:#16a34a" onclick="aligner_saveResumeModal('${esc(p.id)}')">Resume & Recalculate</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveResumeModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var resumeDate = document.getElementById('al-resume-date').value || todayISO();

  (details.pauses || []).forEach(function(pz) {
    if (pz.active) {
      pz.active = false;
      pz.actualResume = resumeDate;
    }
  });

  details.treatmentStatus = 'ongoing';

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-resume').remove();
  renderAlignerDetailTab();
  showToast('Treatment resumed! All future set dates recalculated.');
}

/* ── 11. Refinement Modal ── */
function showAlignerRefinementModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var nextRefNum = 'R' + ((details.refinements || []).length + 1);

  var modalId = 'modal-aligner-ref';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">🔄 Start Refinement Phase</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Refinement Number</label>
          <input type="text" id="al-ref-num" class="form-input" value="${nextRefNum}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Additional Sets</label>
          <input type="number" id="al-ref-sets" class="form-input" min="1" max="50" value="8">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">New Scan Date</label>
          <input type="date" id="al-ref-scan-date" class="form-input" value="${todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Additional Cost (₹)</label>
          <input type="number" id="al-ref-cost" class="form-input" min="0" step="1000" value="0">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Clinical Rationale / Notes</label>
        <textarea id="al-ref-notes" class="form-input" rows="2" placeholder="Anterior rotation correction, torque settling, bite refinement...">Anterior rotation and torque correction.</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="aligner_saveRefinementModal('${esc(p.id)}')">Save Refinement Phase</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveRefinementModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var addSets = parseInt(document.getElementById('al-ref-sets').value) || 0;
  if (addSets <= 0) {
    showToast('Please enter additional refinement sets!');
    return;
  }

  var newRef = {
    id: 'ref_' + Date.now(),
    refinementNumber: document.getElementById('al-ref-num').value.trim() || 'R1',
    scanDate: document.getElementById('al-ref-scan-date').value || todayISO(),
    additionalSets: addSets,
    cost: Number(document.getElementById('al-ref-cost').value) || 0,
    notes: document.getElementById('al-ref-notes').value.trim()
  };

  details.refinements = details.refinements || [];
  details.refinements.push(newRef);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-ref').remove();
  renderAlignerDetailTab();
  showToast('Refinement phase added & calendar extended!');
}

/* ── 12. Retainer Phase Modal ── */
function showAlignerRetentionModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var ret = details.retention || {};

  var modalId = 'modal-aligner-retention';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:500px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">🛡️ Retainer Phase & Recall Setup</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Retainer Delivery Date</label>
          <input type="date" id="al-ret-date" class="form-input" value="${ret.deliveryDate || todayISO()}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Retainer Type</label>
          <select id="al-ret-type" class="form-input">
            <option value="Essix (Clear Vacuum-formed)" ${ret.retainerType && ret.retainerType.includes('Essix') ? 'selected' : ''}>Essix (Clear Vacuum-formed)</option>
            <option value="Hawley Retainer" ${ret.retainerType && ret.retainerType.includes('Hawley') ? 'selected' : ''}>Hawley Retainer</option>
            <option value="Fixed Lingual Retainer" ${ret.retainerType && ret.retainerType.includes('Fixed') ? 'selected' : ''}>Fixed Lingual Retainer</option>
            <option value="Bonded + Clear Combination" ${ret.retainerType && ret.retainerType.includes('Combination') ? 'selected' : ''}>Bonded + Clear Combination</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Retainer Cost (₹)</label>
          <input type="number" id="al-ret-cost" class="form-input" min="0" step="500" value="${ret.retainerCost || 0}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Wear Protocol</label>
          <input type="text" id="al-ret-wear" class="form-input" value="${esc(ret.wearInstructions || 'Full-time 3 months, then night-only')}">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Final Discharge & Retention Notes</label>
        <textarea id="al-ret-notes" class="form-input" rows="2" placeholder="Attachments removed, final polishing, retainer fit checked...">${esc(ret.notes || 'All attachments removed, final occlusion verified, retainer delivered.')}</textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" style="background:#16a34a" onclick="aligner_saveRetentionModal('${esc(p.id)}')">Activate Retention & Auto-Schedule</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function aligner_saveRetentionModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var delDate = document.getElementById('al-ret-date').value || todayISO();

  details.retention = {
    active: true,
    deliveryDate: delDate,
    retainerType: document.getElementById('al-ret-type').value,
    retainerCost: Number(document.getElementById('al-ret-cost').value) || 0,
    wearInstructions: document.getElementById('al-ret-wear').value.trim(),
    notes: document.getElementById('al-ret-notes').value.trim(),
    reviews: [
      { milestone: '1 Month', expectedDate: addDaysToDate(delDate, 30), completedDate: '', status: 'pending' },
      { milestone: '3 Months', expectedDate: addDaysToDate(delDate, 90), completedDate: '', status: 'pending' },
      { milestone: '6 Months', expectedDate: addDaysToDate(delDate, 180), completedDate: '', status: 'pending' },
      { milestone: '12 Months', expectedDate: addDaysToDate(delDate, 365), completedDate: '', status: 'pending' }
    ]
  };

  details.treatmentStatus = 'completed';

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-retention').remove();
  renderAlignerDetailTab();
  showToast('Retention activated! 1M, 3M, 6M, 12M reviews synced to calendar.');
}

/* ── 13. Smart WhatsApp Dispatcher & Communication Log ── */
function showAlignerSmartWAModal(ptId, defaultOption) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var modalId = 'modal-aligner-wa';
  var old = document.getElementById(modalId);
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:500px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#1e3a5f">💬 Send WhatsApp Reminder (Dr. Tanmay Jain)</h3>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('${modalId}').remove()">✕</button>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Select Reminder Scenario</label>
        <select id="al-wa-scenario" class="form-input" onchange="aligner_updateWaMessageText('${esc(p.id)}')">
          <option value="1_day_before" ${defaultOption === '1_day_before' ? 'selected' : ''}>1 Day Before Set Change ⭐</option>
          <option value="switch_day" ${defaultOption === 'switch_day' ? 'selected' : ''}>On Set Change Day</option>
          <option value="2_days_review" ${defaultOption === '2_days_review' ? 'selected' : ''}>2 Days Before Review Visit</option>
          <option value="7_days_review" ${defaultOption === '7_days_review' ? 'selected' : ''}>7 Days Before Review Visit</option>
          <option value="batch_pickup">Batch Pickup Reminder</option>
          <option value="custom">Custom Message</option>
        </select>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Message Preview (The Home of Smiles)</label>
        <textarea id="al-wa-preview" class="form-input" rows="9" style="font-size:13px;line-height:1.6;font-family:inherit"></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
        <button class="btn btn-primary" style="background:#25D366;border:none;font-weight:700" onclick="aligner_dispatchWaMessage('${esc(p.id)}')">
          📲 Open WhatsApp & Log
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  aligner_updateWaMessageText(p.id);
}

function aligner_updateWaMessageText(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var scenario = document.getElementById('al-wa-scenario').value;
  var previewEl = document.getElementById('al-wa-preview');
  if (!previewEl) return;

  var nextSet = stats.activeSet + 1;
  var msg = '';

  if (scenario === '1_day_before') {
    msg = 'Hello ' + p.name + ',\n\n' +
      'This is a reminder from The Home of Smiles Dental Clinic.\n\n' +
      'Tomorrow please change to Aligner Set #' + nextSet + '.\n\n' +
      'Wear your aligners 20–22 hours/day.\n\n' +
      'If your current aligner is not fitting properly, do NOT move to the next set.\n\n' +
      '📞 9257562207\n— Dr. Tanmay Jain';
  } else if (scenario === 'switch_day') {
    msg = 'Hello ' + p.name + ',\n\n' +
      'This is a reminder from The Home of Smiles Dental Clinic.\n\n' +
      'Today is your scheduled day to switch to Aligner Set #' + nextSet + '.\n\n' +
      'Please use your chewies for 10-15 minutes after placing the new set.\n\n' +
      '📞 9257562207\n— Dr. Tanmay Jain';
  } else if (scenario === '2_days_review' || scenario === '7_days_review') {
    msg = 'Hello ' + p.name + ',\n\n' +
      'This is a reminder from The Home of Smiles regarding your upcoming Aligner Review Appointment on ' + (stats.nextReviewDate ? formatDate(stats.nextReviewDate) : 'this week') + '.\n\n' +
      'Please bring your current aligners, chewies, and next sets with you.\n\n' +
      '📞 9257562207\n— Dr. Tanmay Jain';
  } else if (scenario === 'batch_pickup') {
    msg = 'Hello ' + p.name + ',\n\n' +
      'Your next batch of Clear Aligners is ready for pickup at The Home of Smiles.\n\n' +
      'Please visit us for your clinical review and collection.\n\n' +
      '📞 9257562207\n— Dr. Tanmay Jain';
  } else {
    msg = 'Hello ' + p.name + ',\n\n' +
      'This is a message from The Home of Smiles regarding your Clear Aligner treatment.\n\n' +
      '📞 9257562207\n— Dr. Tanmay Jain';
  }

  previewEl.value = msg;
}

function aligner_dispatchWaMessage(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);

  var msgText = document.getElementById('al-wa-preview').value.trim();
  var scenario = document.getElementById('al-wa-scenario').value;

  var historyItem = {
    id: 'wa_' + Date.now(),
    date: new Date().toLocaleString(),
    messageType: scenario,
    setNumber: details.currentSet || 1,
    reminderType: 'WhatsApp Reminder',
    status: 'Dispatched',
    preview: msgText
  };

  details.waHistory = details.waHistory || [];
  details.waHistory.push(historyItem);

  aligner_savePatientDetails(p.id, details);
  document.getElementById('modal-aligner-wa').remove();
  renderAlignerDetailTab();

  var cleanPhone = (p.phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

  var waUrl = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msgText);
  window.open(waUrl, '_blank');
  showToast('WhatsApp reminder dispatched & logged in patient history!');
}

/* ── Deletion Handlers ── */
function aligner_deleteBatch(ptId, batchId) {
  if (!confirm('Are you sure you want to remove this batch record?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.batches = (details.batches || []).filter(function(b, idx) { return b.id !== batchId && idx !== parseInt(batchId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Batch record removed.');
}

function aligner_deleteReview(ptId, revId) {
  if (!confirm('Are you sure you want to remove this review visit?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.reviews = (details.reviews || []).filter(function(r, idx) { return r.id !== revId && idx !== parseInt(revId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Review record removed.');
}

function aligner_deleteIpr(ptId, iprId) {
  if (!confirm('Are you sure you want to remove this IPR record?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.iprLogs = (details.iprLogs || []).filter(function(i, idx) { return i.id !== iprId && idx !== parseInt(iprId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('IPR record removed.');
}

function aligner_deleteAttachment(ptId, attId) {
  if (!confirm('Are you sure you want to remove this attachment?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.attachments = (details.attachments || []).filter(function(a, idx) { return a.id !== attId && idx !== parseInt(attId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Attachment removed.');
}

function aligner_deletePayment(ptId, payId) {
  if (!confirm('Are you sure you want to remove this payment entry?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.payments = (details.payments || []).filter(function(py, idx) { return py.id !== payId && idx !== parseInt(payId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Payment entry removed.');
}

function aligner_deleteIssue(ptId, issId) {
  if (!confirm('Are you sure you want to remove this issue/delay record?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.delays = (details.delays || []).filter(function(d, idx) { return d.id !== issId && idx !== parseInt(issId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Delay record removed & schedule recalibrated.');
}

function aligner_deleteRefinement(ptId, refId) {
  if (!confirm('Are you sure you want to remove this refinement phase?')) return;
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  details.refinements = (details.refinements || []).filter(function(rf, idx) { return rf.id !== refId && idx !== parseInt(refId); });
  aligner_savePatientDetails(p.id, details);
  renderAlignerDetailTab();
  showToast('Refinement phase removed.');
}

/* ══════════════════════════════════════════════════════
   PRINTABLES & REPORTS
   ══════════════════════════════════════════════════════ */

/* ── 1. Printable Aligner Payment Receipt ── */
function printAlignerReceipt(ptId, paymentId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);

  var pay = (details.payments || []).find(function(py, idx) {
    return py.id === paymentId || idx === parseInt(paymentId);
  }) || (details.payments || []).slice().pop();

  var w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Receipt - ${p.name}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 600px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 20px; }
        .clinic-name { font-size: 22px; font-weight: 800; color: #1e3a5f; }
        .clinic-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
        .receipt-title { font-size: 16px; font-weight: 700; color: #0284c7; margin: 15px 0; text-align: center; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; margin-bottom: 20px; }
        .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .amt-row { display: flex; justify-content: space-between; font-size: 14px; padding: 6px 0; border-bottom: 1px dashed #cbd5e1; }
        .total-row { display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; color: #16a34a; padding-top: 8px; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="clinic-name">THE HOME OF SMILES</div>
        <div class="clinic-sub">Advanced Orthodontics & Clear Aligner Center</div>
        <div class="clinic-sub">Dr. Tanmay Jain • 📞 9257562207</div>
      </div>
      <div class="receipt-title">Official Aligner Payment Receipt</div>
      <div class="grid">
        <div><b>Patient:</b> ${p.name} (ID: ${p.id})</div>
        <div><b>Date:</b> ${pay ? formatDate(pay.date) : todayISO()}</div>
        <div><b>Brand:</b> ${details.brand || 'Clear Aligners'}</div>
        <div><b>Receipt Ref:</b> ${pay ? (pay.id || 'REC-AL') : 'REC-AL'}</div>
      </div>
      <div class="box">
        <div class="amt-row"><span>Total Treatment Fee:</span><span>₹${(stats.totalCost || 0).toLocaleString()}</span></div>
        <div class="amt-row"><span>Payment Mode:</span><span>${pay ? (pay.mode || 'UPI') : 'UPI'}</span></div>
        <div class="amt-row"><span>Remark:</span><span>${pay ? (pay.remark || 'Aligner Installment') : ''}</span></div>
        <div class="amt-row"><span>Total Paid Till Date:</span><span>₹${(stats.totalPaid || 0).toLocaleString()}</span></div>
        <div class="amt-row"><span>Remaining Balance:</span><span style="color:#dc2626">₹${(stats.dueAmount || 0).toLocaleString()}</span></div>
        <div class="total-row"><span>Amount Received:</span><span>₹${pay ? Number(pay.amount).toLocaleString() : 0}</span></div>
      </div>
      <div class="footer">
        <div>Thank you for choosing The Home of Smiles.</div>
        <div style="text-align:right">
          <div style="border-bottom:1px solid #94a3b8;width:140px;margin-bottom:4px"></div>
          <b>Authorized Signature</b>
        </div>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  w.document.close();
}

/* ── 2. Treatment Discharge Summary PDF ── */
function printAlignerDischargeSummary(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);
  var iprCumulative = aligner_calcCumulativeIpr(details);
  var ret = details.retention || {};

  var w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Aligner Discharge Summary - ${p.name}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 20px; }
        .clinic-name { font-size: 24px; font-weight: 800; color: #1e3a5f; }
        .clinic-sub { font-size: 13px; color: #64748b; margin-top: 2px; }
        .title { font-size: 18px; font-weight: 800; color: #0284c7; text-align: center; margin: 15px 0; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; margin-bottom: 20px; }
        .section-title { font-size: 14px; font-weight: 700; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 18px 0 10px; }
        .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 13px; margin-bottom: 15px; }
        .footer { margin-top: 50px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="clinic-name">THE HOME OF SMILES</div>
        <div class="clinic-sub">Clear Aligner Treatment Discharge Summary</div>
        <div class="clinic-sub">Dr. Tanmay Jain • 📞 9257562207</div>
      </div>
      <div class="title">Comprehensive Treatment Completion Certificate</div>
      <div class="grid">
        <div><b>Patient Name:</b> ${p.name}</div>
        <div><b>Case ID:</b> AL_${p.id}</div>
        <div><b>Brand / System:</b> ${details.brand || 'Clear Aligners'}</div>
        <div><b>Start Date:</b> ${formatDate(details.startDate)}</div>
        <div><b>Completion Date:</b> ${formatDate(ret.deliveryDate || todayISO())}</div>
        <div><b>Total Sets Worn:</b> ${stats.totalSets} (${stats.baseTotalSets} Primary + ${stats.totalSets - stats.baseTotalSets} Refinement)</div>
      </div>

      <div class="section-title">Cumulative Interproximal Reduction (IPR) Performed</div>
      <div class="box">
        ${Object.keys(iprCumulative).length > 0 ? Object.keys(iprCumulative).map(function(t) { return 'Tooth #' + t + ': ' + iprCumulative[t] + 'mm'; }).join(' • ') : 'No IPR required during treatment.'}
      </div>

      <div class="section-title">Post-Treatment Retention Protocol</div>
      <div class="box">
        <div><b>Retainer Type:</b> ${esc(ret.retainerType || 'Essix Vacuum-formed Retainer')}</div>
        <div style="margin-top:4px"><b>Wear Instructions:</b> ${esc(ret.wearInstructions || 'Full-time 3 months, followed by nighttime indefinite wear.')}</div>
        <div style="margin-top:4px"><b>Recall Milestones:</b> 1 Month, 3 Months, 6 Months, 12 Months Stability Checks.</div>
      </div>

      <div class="section-title">Financial Settlement Summary</div>
      <div class="box">
        Total Treatment Fee: <b>₹${(stats.totalCost || 0).toLocaleString()}</b> • Total Paid: <b>₹${(stats.totalPaid || 0).toLocaleString()}</b> • Balance Due: <b>₹${(stats.dueAmount || 0).toLocaleString()} (Settled)</b>
      </div>

      <div class="footer">
        <div>Issued with verified stability on ${todayISO()}.</div>
        <div style="text-align:right">
          <div style="border-bottom:1px solid #94a3b8;width:180px;margin-bottom:4px"></div>
          <b>Dr. Tanmay Jain</b><br>The Home of Smiles
        </div>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  w.document.close();
}

/* ── 3. Printable Aligner Progress Report ── */
function printAlignerProgressReport(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var sched = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, sched);
  var iprCumulative = aligner_calcCumulativeIpr(details);

  var w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Aligner Progress Report - ${p.name}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 16px; }
        .title { font-size: 16px; font-weight: 800; color: #0284c7; text-align: center; margin-bottom: 15px; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
        .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
        .section-title { font-size: 13px; font-weight: 700; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 14px 0 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="header">
        <div style="font-size:22px;font-weight:800;color:#1e3a5f">THE HOME OF SMILES</div>
        <div style="font-size:12px;color:#64748b">Clear Aligner Treatment Progress Report • Dr. Tanmay Jain</div>
      </div>
      <div class="title">Patient Progress Summary: ${p.name} (${details.brand || 'Clear Aligners'})</div>
      <div class="kpi-grid">
        <div class="kpi-box"><div>Current Set</div><b style="font-size:16px;color:#0284c7">#${stats.activeSet} / ${stats.totalSets}</b></div>
        <div class="kpi-box"><div>Next Change</div><b>${stats.nextChangeDate ? formatDate(stats.nextChangeDate) : '—'}</b></div>
        <div class="kpi-box"><div>Compliance</div><b>${stats.complianceLabel}</b></div>
        <div class="kpi-box"><div>Est. Finish</div><b>${stats.estimatedCompletion ? formatDate(stats.estimatedCompletion) : '—'}</b></div>
      </div>

      <div class="section-title">Recent Review History</div>
      <table>
        <tr><th>Date</th><th>Set</th><th>Tracking</th><th>Compliance</th><th>Notes</th></tr>
        ${(details.reviews || []).slice(-4).map(function(r) {
          return '<tr><td>' + formatDate(r.date) + '</td><td>#' + r.currentSet + '</td><td>' + (r.trackingQuality || 'Good') + '</td><td>' + (r.compliance || '20-22h') + '</td><td>' + (r.clinicalNotes || '—') + '</td></tr>';
        }).join('')}
      </table>

      <div class="section-title">Cumulative IPR Performed</div>
      <div style="font-size:12px;color:#475569;margin-bottom:14px">
        ${Object.keys(iprCumulative).length > 0 ? Object.keys(iprCumulative).map(function(t) { return 'Tooth #' + t + ': ' + iprCumulative[t] + 'mm'; }).join(' • ') : 'No IPR recorded.'}
      </div>

      <div style="margin-top:30px;display:flex;justify-content:space-between;font-size:11px;color:#64748b">
        <div>Generated on ${todayISO()}</div>
        <div>Dr. Tanmay Jain • The Home of Smiles</div>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  w.document.close();
}

/* ── 4. Printable Consent Document ── */
function printAlignerConsent(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id);
  var rec = details.initialRecords || {};
  var consent = rec.consentForm || {};

  var w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Signed Consent - ${p.name}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 700px; margin: 0 auto; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div style="font-size:22px;font-weight:800;color:#1e3a5f">THE HOME OF SMILES</div>
        <div style="font-size:12px;color:#64748b">Informed Consent for Clear Aligner Treatment</div>
      </div>
      <div style="font-size:13px;margin-bottom:20px">
        <b>Patient Name:</b> ${p.name} &nbsp;•&nbsp; <b>Date Signed:</b> ${consent.signedDate ? formatDate(consent.signedDate) : todayISO()}
      </div>
      <div style="font-size:12px;color:#334155;background:#f8fafc;padding:15px;border:1px solid #e2e8f0;border-radius:8px">
        I have consented to Clear Aligner therapy with The Home of Smiles. I agree to wear aligners 20–22 hours daily, attend regular review appointments, and follow all retention guidelines upon completion.
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          ${consent.signatureDataUrl ? '<img src="' + consent.signatureDataUrl + '" style="max-height:80px"><br>' : ''}
          <b>Patient / Guardian Signature</b>
        </div>
        <div style="text-align:right">
          <b>Dr. Tanmay Jain</b><br>The Home of Smiles
        </div>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  w.document.close();
}

/* ══════════════════════════════════════════════════════
   CLINIC-LEVEL ALIGNER DASHBOARD (#page-aligner)
   ══════════════════════════════════════════════════════ */

function renderAlignerPage() {
  var container = document.getElementById('page-aligner');
  if (!container) return;

  var cases = getAlignerCases();
  var totalCases = cases.length;

  var activeCases = 0;
  var reviewsDueThisWeek = 0;
  var changesTomorrow = 0;
  var totalPendingBalance = 0;
  var refinementCases = 0;
  var completedCases = 0;
  var pausedCases = 0;

  var today = todayISO();
  var tomorrow = addDaysToDate(today, 1);
  var next7 = addDaysToDate(today, 7);

  cases.forEach(function(c) {
    if (c.treatmentStatus === 'completed') completedCases++;
    else if (c.treatmentStatus === 'paused') pausedCases++;
    else activeCases++;

    if (c.treatmentStatus !== 'completed' && c.treatmentStatus !== 'paused') {
      if (c.nextReviewDate && c.nextReviewDate >= today && c.nextReviewDate <= next7) reviewsDueThisWeek++;
      if (c.nextChangeDate && (c.nextChangeDate === today || c.nextChangeDate === tomorrow)) changesTomorrow++;
      if (c.refinements && c.refinements.length > 0) refinementCases++;
    }
    totalPendingBalance += (Number(c.pendingAmount) || 0);
  });

  var html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div>
        <h1 class="page-title" style="margin:0;font-size:24px;display:flex;align-items:center;gap:10px">
          💎 Aligner Clinic Dashboard 2.0
          <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:13px;border:1px solid #bae6fd">The Home of Smiles</span>
        </h1>
        <p class="page-sub" style="margin:3px 0 0">Comprehensive clear aligner treatment, tracking, batches, reviews & financial management</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="showAlignerForm()">➕ New Aligner Patient</button>
        <button class="btn btn-sm" style="background:#10b981;color:#fff;border:none;font-weight:700" onclick="exportAlignerExcel()">📊 Export Excel (CSV)</button>
        <button class="btn btn-sm btn-ghost" onclick="backupAlignerJson()">💾 Backup JSON</button>
      </div>
    </div>

    <!-- Clinic Aligner KPI Deck -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:20px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Active Cases</div>
        <div style="font-size:24px;font-weight:800;color:#0284c7;margin-top:2px">${activeCases}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Reviews This Week</div>
        <div style="font-size:24px;font-weight:800;color:#0d9488;margin-top:2px">${reviewsDueThisWeek}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Set Switches Due</div>
        <div style="font-size:24px;font-weight:800;color:#7c3aed;margin-top:2px">${changesTomorrow}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Pending Balance</div>
        <div style="font-size:20px;font-weight:800;color:#dc2626;margin-top:4px">₹${totalPendingBalance.toLocaleString()}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Refinement Cases</div>
        <div style="font-size:24px;font-weight:800;color:#d97706;margin-top:2px">${refinementCases}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Completed</div>
        <div style="font-size:24px;font-weight:800;color:#16a34a;margin-top:2px">${completedCases}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Paused</div>
        <div style="font-size:24px;font-weight:800;color:#475569;margin-top:2px">${pausedCases}</div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${['all', 'active', 'completed', 'paused', 'refinement', 'alert'].map(function(f) {
          var isAct = aligner_filterStatus === f;
          var labelMap = { all:'All Cases', active:'Active', completed:'Completed', paused:'Paused', refinement:'Refinement', alert:'⚠️ Compliance Lag' };
          return `
            <button onclick="aligner_setFilterStatus('${f}')"
              style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;
              background:${isAct ? '#1e3a5f' : '#f8fafc'};
              color:${isAct ? '#fff' : '#64748b'};
              border:1px solid ${isAct ? '#1e3a5f' : '#e2e8f0'}">
              ${labelMap[f]}
            </button>
          `;
        }).join('')}
      </div>

      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" placeholder="🔍 Search patient / brand..." id="al-search-input" class="form-input" style="width:200px;font-size:12px;padding:6px 10px"
          value="${esc(aligner_searchQuery)}" oninput="aligner_onSearch(this.value)">
        <select class="form-input" style="font-size:12px;padding:6px 10px" onchange="aligner_onSortChange(this.value)">
          <option value="nextReview" ${aligner_sortBy === 'nextReview' ? 'selected' : ''}>Sort: Next Review</option>
          <option value="nextChange" ${aligner_sortBy === 'nextChange' ? 'selected' : ''}>Sort: Next Set Change</option>
          <option value="dueAmount" ${aligner_sortBy === 'dueAmount' ? 'selected' : ''}>Sort: Due Amount</option>
          <option value="name" ${aligner_sortBy === 'name' ? 'selected' : ''}>Sort: Patient Name</option>
        </select>
      </div>
    </div>

    <!-- Case Cards List -->
    <div id="aligner-list-container">
      ${aligner_renderCaseListHTML()}
    </div>
  `;

  container.innerHTML = html;
}

function aligner_setFilterStatus(status) {
  aligner_filterStatus = status;
  renderAlignerPage();
}

function aligner_onSearch(val) {
  aligner_searchQuery = val.toLowerCase();
  var list = document.getElementById('aligner-list-container');
  if (list) list.innerHTML = aligner_renderCaseListHTML();
}

function aligner_onSortChange(val) {
  aligner_sortBy = val;
  renderAlignerPage();
}

function aligner_renderCaseListHTML() {
  var cases = getAlignerCases().slice();

  if (aligner_filterStatus === 'active') {
    cases = cases.filter(function(c) { return c.treatmentStatus !== 'completed' && c.treatmentStatus !== 'paused'; });
  } else if (aligner_filterStatus === 'completed') {
    cases = cases.filter(function(c) { return c.treatmentStatus === 'completed'; });
  } else if (aligner_filterStatus === 'paused') {
    cases = cases.filter(function(c) { return c.treatmentStatus === 'paused'; });
  } else if (aligner_filterStatus === 'refinement') {
    cases = cases.filter(function(c) { return c.refinements && c.refinements.length > 0; });
  } else if (aligner_filterStatus === 'alert') {
    cases = cases.filter(function(c) { return (c.totalDelayDays || 0) > 0; });
  }

  if (aligner_searchQuery) {
    cases = cases.filter(function(c) {
      return (c.patientName || '').toLowerCase().includes(aligner_searchQuery) ||
             (c.brand || '').toLowerCase().includes(aligner_searchQuery) ||
             (c.phone || '').includes(aligner_searchQuery);
    });
  }

  cases.sort(function(a, b) {
    if (aligner_sortBy === 'nextReview') return (a.nextReviewDate || '9999').localeCompare(b.nextReviewDate || '9999');
    if (aligner_sortBy === 'nextChange') return (a.nextChangeDate || '9999').localeCompare(b.nextChangeDate || '9999');
    if (aligner_sortBy === 'dueAmount') return (b.pendingAmount || 0) - (a.pendingAmount || 0);
    if (aligner_sortBy === 'name') return (a.patientName || '').localeCompare(b.patientName || '');
    return 0;
  });

  if (cases.length === 0) {
    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:40px;text-align:center;color:#94a3b8">
        <div style="font-size:36px;margin-bottom:8px">💎</div>
        <div style="font-size:16px;font-weight:700;color:#475569">No Aligner Cases Found</div>
        <p style="font-size:13px;margin:6px 0 16px">Create a new aligner patient to begin tracking.</p>
        <button class="btn btn-primary btn-sm" onclick="showAlignerForm()">➕ Add Aligner Patient</button>
      </div>
    `;
  }

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px">
      ${cases.map(function(c) {
        var pct = c.totalSets > 0 ? Math.min(100, Math.round(((c.currentSet || 1) / c.totalSets) * 100)) : 0;
        return `
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03);position:relative;cursor:pointer;transition:all 0.15s ease"
            onclick="openPatientById('${esc(c.patientId)}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <h3 style="font-size:16px;font-weight:800;color:#1e3a5f;margin:0">${esc(c.patientName)}</h3>
                <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(c.phone || 'No phone')}</div>
              </div>
              <span class="badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-weight:700;font-size:11px">
                ${esc(c.brand || 'Aligners')}
              </span>
            </div>

            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">
                <span>Set #${c.currentSet || 1} of ${c.totalSets || 20}</span>
                <span style="color:#0284c7">${pct}%</span>
              </div>
              <div style="height:6px;background:#f1f5f9;border-radius:999px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg, #0284c7, #10b981);border-radius:999px"></div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#334155;margin-bottom:12px;background:#f8fafc;padding:8px;border-radius:6px">
              <div>Next Switch: <b>${c.nextChangeDate ? formatDate(c.nextChangeDate) : '—'}</b></div>
              <div>Next Review: <b>${c.nextReviewDate ? formatDate(c.nextReviewDate) : '—'}</b></div>
              <div>Due: <b style="color:${(c.pendingAmount || 0) > 0 ? '#dc2626' : '#16a34a'}">₹${Number(c.pendingAmount || 0).toLocaleString()}</b></div>
              <div>Status: <b>${c.treatmentStatus || 'ongoing'}</b></div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f1f5f9;padding-top:10px" onclick="event.stopPropagation()">
              <button class="btn btn-sm" style="background:#25D366;color:#fff;border:none;font-weight:700;padding:4px 10px;font-size:11px"
                onclick="showAlignerSmartWAModal('${esc(c.patientId)}')">
                💬 Send WA
              </button>
              <button class="btn btn-sm btn-outline" style="font-size:11px;padding:4px 10px"
                onclick="openPatientById('${esc(c.patientId)}')">
                Open Case ➔
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openPatientById(ptId) {
  var targetId = (typeof ptId === 'object' && ptId && ptId.id) ? ptId.id : ptId;
  var p = (DATA.patients || []).find(function(x) { return x.id === targetId; });
  if (p) {
    openPatient(p.id);
    setTimeout(function() { switchTab('aligner-detail'); }, 150);
  }
}

/* ── Export All Aligner Patients to Excel (CSV) ── */
function exportAlignerExcel() {
  var cases = getAlignerCases();
  if (cases.length === 0) {
    showToast('No aligner cases to export.');
    return;
  }

  var headers = ['Patient ID', 'Patient Name', 'Phone', 'Brand', 'Total Sets', 'Current Set', 'Start Date', 'Next Change Date', 'Next Review Date', 'Total Fee', 'Total Paid', 'Balance Due', 'Delay Days', 'Status'];
  var rows = [headers.join(',')];

  cases.forEach(function(c) {
    var r = [
      '"' + (c.patientId || '') + '"',
      '"' + (c.patientName || '').replace(/"/g, '""') + '"',
      '"' + (c.phone || '') + '"',
      '"' + (c.brand || 'Invisalign') + '"',
      c.totalSets || 0,
      c.currentSet || 1,
      c.alignerStartDate || '',
      c.nextChangeDate || '',
      c.nextReviewDate || '',
      c.totalAmount || 0,
      c.paidAmount || 0,
      c.pendingAmount || 0,
      c.totalDelayDays || 0,
      '"' + (c.treatmentStatus || 'ongoing') + '"'
    ];
    rows.push(r.join(','));
  });

  var csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
  var link = document.createElement('a');
  link.setAttribute('href', csvContent);
  link.setAttribute('download', 'Aligner_Cases_Home_of_Smiles_' + todayISO() + '.csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Excel CSV exported successfully!');
}

/* ── Backup Complete Aligner Database (JSON) ── */
function backupAlignerJson() {
  var cases = getAlignerCases();
  var backupData = {
    exportedAt: new Date().toISOString(),
    clinic: 'The Home of Smiles',
    doctor: 'Dr. Tanmay Jain',
    alignerCases: cases
  };

  var jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupData, null, 2));
  var link = document.createElement('a');
  link.setAttribute('href', jsonStr);
  link.setAttribute('download', 'Aligner_DB_Backup_' + todayISO() + '.json');
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Aligner database JSON backup created!');
}
