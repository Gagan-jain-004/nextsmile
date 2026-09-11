const fs = require('fs');

const alignerCode = `/* ══════════════════════════════════════════════════════
   ALIGNER MODULE 1.0 — COMPLETE PRODUCTION SYSTEM
   Completely independent patient module for Clear Aligners.
   No wires, no monthly wire timelines.
   ══════════════════════════════════════════════════════ */

/* ── Global & Patient Data Helpers ── */
function getAlignerCases() {
  return DATA.alignerCases || (DATA.alignerCases = []);
}

function addDaysToDate(dateStr, days) {
  if (!dateStr) dateStr = todayISO();
  const d = new Date(dateStr + 'T00:00:00');
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
      setsPerBatch: 10,
      reviewIntervalDays: 30,
      totalCost: (legacy && legacy.totalAmount) || 0,
      paidAmount: (legacy && legacy.paidAmount) || 0,
      treatmentStatus: (legacy && legacy.treatmentStatus) || 'ongoing',
      notes: (legacy && legacy.notes) || '',
      batches: (legacy && legacy.batches) || [],
      reviews: (legacy && legacy.reviews) || [],
      payments: (legacy && legacy.paymentHistory) || [],
      delays: (legacy && legacy.delays) || [],
      refinements: (legacy && legacy.refinements) || []
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
    notes: details.notes || '',
    batches: details.batches || [],
    reviews: details.reviews || [],
    delays: details.delays || [],
    refinements: details.refinements || [],
    paymentHistory: details.payments || []
  };

  if (idx >= 0) cases[idx] = caseObj; else cases.unshift(caseObj);
  DATA.alignerCases = cases;

  aligner_syncToAppointments(p.id, details, stats);
  saveData();
}

/* ── Calculation Engine ── */
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

  var totalCost = (Number(details.totalCost) || 0) + addlRefinementsCost;

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

  return {
    activeSet: activeSet,
    totalSets: totalSets,
    baseTotalSets: baseTotalSets,
    setsRemaining: setsRemaining,
    totalCost: totalCost,
    totalPaid: totalPaid,
    dueAmount: dueAmount,
    totalDelayDays: totalDelayDays,
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

/* ── Render: Aligner Detail Tab in Patient Detail ── */
function renderAlignerDetailTab() {
  var p = activePt;
  var container = document.getElementById('tab-content-aligner-detail');
  if (!p || !container) return;

  var details = aligner_getPatientDetails(p.id);
  var schedule = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, schedule);

  var html = `
    <div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#1e3a5f;margin:0;display:flex;align-items:center;gap:8px">
          💎 Aligner Treatment System
          <span class="badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:12px">${esc(details.brand || 'Clear Aligners')}</span>
          ${stats.status === 'completed' ? '<span class="badge badge-green">✅ Completed</span>' : stats.status === 'paused' ? '<span class="badge badge-amber">⏸ Paused</span>' : '<span class="badge badge-blue">🔄 Active Treatment</span>'}
        </h2>
        <div style="font-size:12px;color:#64748b;margin-top:4px">
          Start: <strong>${fmtDate(details.startDate)}</strong> • Set Duration: <strong>${details.setDurationDays || 10} Days/Set</strong> • Interval: <strong>${details.reviewIntervalDays || 30}d Reviews</strong>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" style="background:#0284c7;color:#fff;border:none" onclick="showAlignerSetupModal('${p.id}')">⚙️ Treatment Setup</button>
        <button class="btn btn-sm" style="background:#4f46e5;color:#fff;border:none" onclick="showAlignerDeliverBatchModal('${p.id}')">📦 Deliver Batch</button>
        <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" onclick="showAlignerReviewModal('${p.id}')">🩺 New Review</button>
        <button class="btn btn-sm" style="background:#059669;color:#fff;border:none" onclick="showAlignerPaymentModal('${p.id}')">💰 Add Payment</button>
        <button class="btn btn-sm" style="background:#d97706;color:#fff;border:none" onclick="showAlignerIssueModal('${p.id}')">⚠️ Register Issue</button>
        <button class="btn btn-sm" style="background:#0891b2;color:#fff;border:none" onclick="showAlignerRefinementModal('${p.id}')">✨ Start Refinement</button>
        <button class="btn btn-wa btn-sm" onclick="showAlignerSmartWAModal('${p.id}')">📲 Send WA Reminder</button>
        <button class="btn btn-ghost btn-sm" onclick="printAlignerProgressReport('${p.id}')">🖨️ Print Report</button>
      </div>
    </div>

    <!-- Treatment Progress Bar -->
    <div class="card card-body" style="padding:16px 20px;margin-bottom:18px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #bae6fd">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:700;font-size:14px;color:#0369a1;display:flex;align-items:center;gap:6px">
          <span>📈 Treatment Progress</span>
          <span style="font-size:12px;color:#475569;font-weight:600">(${stats.progressPct}% Complete)</span>
        </div>
        <div style="font-size:13px;font-weight:700;color:#1e293b">
          Active: <span style="color:#0284c7;font-size:15px">Set ${stats.activeSet}</span> of ${stats.totalSets}
          <span style="color:#64748b;font-weight:500;margin-left:6px">(${stats.setsRemaining} remaining)</span>
        </div>
      </div>
      <div style="background:#cbd5e1;border-radius:20px;height:14px;overflow:hidden;position:relative">
        <div style="background:linear-gradient(90deg,#0284c7,#10b981);width:${stats.progressPct}%;height:100%;border-radius:20px;transition:width 0.4s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-top:6px">
        <span>Day 1 (${fmtDate(details.startDate)})</span>
        <span>${stats.totalDelayDays > 0 ? '⚠️ +' + stats.totalDelayDays + ' Days Delay Accumulated' : 'On Track • No Delays'}</span>
        <span>Est. Finish: <strong>${fmtDate(stats.estimatedCompletion)}</strong></span>
      </div>
    </div>

    <!-- 9 Live Dashboard Summary Cards -->
    <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">ACTIVE SET</div>
          <div style="font-size:20px;font-weight:800;color:#0284c7">#${stats.activeSet} <span style="font-size:12px;color:#94a3b8">/ ${stats.totalSets}</span></div>
        </div>
        <div class="stat-icon" style="background:#e0f2fe;font-size:16px">💎</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">SETS REMAINING</div>
          <div style="font-size:20px;font-weight:800;color:#1e293b">${stats.setsRemaining}</div>
        </div>
        <div class="stat-icon" style="background:#f1f5f9;font-size:16px">⏳</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">NEXT SET CHANGE</div>
          <div style="font-size:14px;font-weight:800;color:${stats.diffChange <= 1 ? '#dc2626' : stats.diffChange <= 3 ? '#d97706' : '#059669'}">
            ${fmtDate(stats.nextChangeDate)}
          </div>
          <div style="font-size:10px;font-weight:600;color:${stats.diffChange <= 1 ? '#dc2626' : '#64748b'}">
            ${stats.diffChange === 0 ? 'Due Today ⚠️' : stats.diffChange === 1 ? 'Tomorrow ⏰' : stats.diffChange < 0 ? Math.abs(stats.diffChange) + 'd Overdue ⚠️' : 'in ' + stats.diffChange + ' days'}
          </div>
        </div>
        <div class="stat-icon" style="background:#ecfdf5;font-size:16px">🔄</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">NEXT REVIEW</div>
          <div style="font-size:14px;font-weight:800;color:#7c3aed">${fmtDate(stats.nextReviewDate) || '—'}</div>
          <div style="font-size:10px;font-weight:600;color:#64748b">
            ${stats.diffReview === 0 ? 'Today 🩺' : stats.diffReview === 1 ? 'Tomorrow ⏰' : stats.diffReview < 0 ? 'Past Due' : stats.nextReviewDate ? 'in ' + stats.diffReview + ' days' : 'None set'}
          </div>
        </div>
        <div class="stat-icon" style="background:#f5f3ff;font-size:16px">🩺</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">TOTAL PAID</div>
          <div style="font-size:18px;font-weight:800;color:#059669">${fmtMoney(stats.totalPaid)}</div>
          <div style="font-size:10px;color:#64748b">of ${fmtMoney(stats.totalCost)}</div>
        </div>
        <div class="stat-icon" style="background:#ecfdf5;font-size:16px">💳</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">DUE AMOUNT</div>
          <div style="font-size:18px;font-weight:800;color:${stats.dueAmount > 0 ? '#d97706' : '#059669'}">
            ${fmtMoney(stats.dueAmount)}
          </div>
          <div style="font-size:10px;font-weight:600;color:${stats.dueAmount > 0 ? '#d97706' : '#059669'}">
            ${stats.dueAmount > 0 ? 'Pending Dues' : 'Fully Paid ✓'}
          </div>
        </div>
        <div class="stat-icon" style="background:${stats.dueAmount > 0 ? '#fffbeb' : '#ecfdf5'};font-size:16px">💰</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">TOTAL DELAYS</div>
          <div style="font-size:18px;font-weight:800;color:${stats.totalDelayDays > 0 ? '#dc2626' : '#1e293b'}">
            ${stats.totalDelayDays} <span style="font-size:11px;font-weight:500">Days</span>
          </div>
          <div style="font-size:10px;color:#64748b">${(details.delays || []).length} registered issue(s)</div>
        </div>
        <div class="stat-icon" style="background:#fef2f2;font-size:16px">⚠️</div>
      </div>

      <div class="stat-card" style="padding:12px 14px">
        <div>
          <div style="font-size:10.5px;color:#64748b;font-weight:700">EST. COMPLETION</div>
          <div style="font-size:14px;font-weight:800;color:#1e293b">${fmtDate(stats.estimatedCompletion)}</div>
          <div style="font-size:10px;color:#64748b">${stats.totalSets} sets total</div>
        </div>
        <div class="stat-icon" style="background:#f8fafc;font-size:16px">🏁</div>
      </div>
    </div>

    <!-- Active In-App Notifications Banner -->
    ${aligner_renderInAppAlerts(p, details, stats)}

    <!-- Navigation Sub-Sections (Schedule Grid, Smart Timeline, Reviews, Payments) -->
    <div style="display:flex;gap:8px;border-bottom:2px solid #e2e8f0;margin-bottom:16px;padding-bottom:2px">
      <button class="btn btn-ghost btn-sm aligner-view-btn active" id="alview-schedule" onclick="aligner_switchSubView('schedule')" style="font-weight:700">📅 Set Change Schedule</button>
      <button class="btn btn-ghost btn-sm aligner-view-btn" id="alview-timeline" onclick="aligner_switchSubView('timeline')">⏱️ Smart Timeline</button>
      <button class="btn btn-ghost btn-sm aligner-view-btn" id="alview-reviews" onclick="aligner_switchSubView('reviews')">🩺 Review Visits (${(details.reviews||[]).length})</button>
      <button class="btn btn-ghost btn-sm aligner-view-btn" id="alview-batches" onclick="aligner_switchSubView('batches')">📦 Batches (${(details.batches||[]).length})</button>
      <button class="btn btn-ghost btn-sm aligner-view-btn" id="alview-payments" onclick="aligner_switchSubView('payments')">💰 Payment Ledger (${(details.payments||[]).length})</button>
      <button class="btn btn-ghost btn-sm aligner-view-btn" id="alview-issues" onclick="aligner_switchSubView('issues')">⚠️ Issues / Delays (${(details.delays||[]).length})</button>
    </div>

    <!-- 1. SCHEDULE GRID VIEW -->
    <div id="aligner-sec-schedule" class="aligner-sub-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">Automatic Set Change Calendar (Day 1 → Completion)</div>
        <div style="font-size:11px;color:#64748b;display:flex;gap:12px;align-items:center">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;margin-right:4px"></span> Completed</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0284c7;margin-right:4px"></span> Current Active</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:4px"></span> Delayed</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#94a3b8;margin-right:4px"></span> Upcoming</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px">
        ${schedule.map(function(s) {
          var isDone = s.setNum < stats.activeSet;
          var isCurrent = s.setNum === stats.activeSet;
          var isDelayed = s.delayDays > 0;
          var border = isCurrent ? '2px solid #0284c7' : isDone ? '1px solid #86efac' : isDelayed ? '1.5px solid #fde68a' : '1px solid #e2e8f0';
          var bg = isCurrent ? '#eff6ff' : isDone ? '#f0fdf4' : isDelayed ? '#fffbeb' : '#ffffff';

          return `
            <div class="card" style="border:${border};background:${bg};padding:12px;border-radius:12px;position:relative">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="font-weight:800;font-size:13px;color:${isCurrent ? '#0284c7' : '#1e293b'}">
                  Set #${s.setNum} ${s.isRefinement ? '<span class="badge badge-purple" style="font-size:9px">Refinement</span>' : ''}
                </div>
                ${isCurrent ? '<span class="badge badge-blue" style="font-size:10px">Active Now</span>' : isDone ? '<span class="badge badge-green" style="font-size:10px">✓ Done</span>' : ''}
              </div>
              <div style="font-size:11.5px;color:#475569;margin-bottom:2px">
                Start: <strong>${fmtDate(s.startDate)}</strong>
              </div>
              <div style="font-size:11.5px;color:#475569;margin-bottom:4px">
                Change: <strong>${fmtDate(s.endDate)}</strong>
              </div>
              ${s.delayDays > 0 ? `<div style="font-size:10.5px;color:#b45309;background:#fef3c7;padding:3px 6px;border-radius:6px;margin-bottom:6px">⚠️ +${s.delayDays}d: ${esc(s.delayNotes || 'Delayed')}</div>` : ''}
              <div style="margin-top:8px;display:flex;gap:6px">
                ${!isCurrent ? `<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;flex:1" onclick="aligner_markSetActive('${p.id}', ${s.setNum})">Mark Active</button>` : `<button class="btn btn-wa btn-sm" style="font-size:10px;padding:3px 8px;flex:1" onclick="showAlignerSmartWAModal('${p.id}', ${s.setNum})">📲 WA</button>`}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <!-- 2. SMART CHRONOLOGICAL TIMELINE VIEW -->
    <div id="aligner-sec-timeline" class="aligner-sub-section" style="display:none">
      <div style="font-weight:700;font-size:14px;color:#1e3a5f;margin-bottom:12px">Chronological Treatment & Clinical Timeline</div>
      ${aligner_renderSmartTimeline(p, details, stats, schedule)}
    </div>

    <!-- 3. REVIEW VISITS VIEW -->
    <div id="aligner-sec-reviews" class="aligner-sub-section" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">Aligner Review Visits & Tracking Log</div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerReviewModal('${p.id}')">➕ New Review</button>
      </div>
      ${aligner_renderReviewsList(p, details)}
    </div>

    <!-- 4. BATCH DELIVERIES VIEW -->
    <div id="aligner-sec-batches" class="aligner-sub-section" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">Batch Delivery System History</div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerDeliverBatchModal('${p.id}')">➕ Deliver Batch</button>
      </div>
      ${aligner_renderBatchesList(p, details)}
    </div>

    <!-- 5. FINANCIAL LEDGER VIEW -->
    <div id="aligner-sec-payments" class="aligner-sub-section" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">Independent Aligner Payment Ledger</div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerPaymentModal('${p.id}')">➕ Add Payment</button>
      </div>
      ${aligner_renderPaymentLedger(p, details, stats)}
    </div>

    <!-- 6. ISSUES & DELAYS VIEW -->
    <div id="aligner-sec-issues" class="aligner-sub-section" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">Delays, Broken/Lost Sets & Remakes</div>
        <button class="btn btn-amber btn-sm" onclick="showAlignerIssueModal('${p.id}')">➕ Register Issue</button>
      </div>
      ${aligner_renderIssuesList(p, details)}
    </div>
  `;

  container.innerHTML = html;
}

function aligner_switchSubView(viewKey) {
  ['schedule','timeline','reviews','batches','payments','issues'].forEach(function(k) {
    var btn = document.getElementById('alview-' + k);
    var sec = document.getElementById('aligner-sec-' + k);
    if (btn) {
      if (k === viewKey) {
        btn.classList.add('active');
        btn.style.fontWeight = '700';
        btn.style.color = '#0284c7';
      } else {
        btn.classList.remove('active');
        btn.style.fontWeight = '500';
        btn.style.color = '#64748b';
      }
    }
    if (sec) sec.style.display = k === viewKey ? 'block' : 'none';
  });
}

function aligner_renderInAppAlerts(p, details, stats) {
  var alerts = [];
  if (stats.diffChange === 1) {
    alerts.push(`
      <div class="alert-box alert-blue" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div><strong>🟣 Reminder:</strong> Tomorrow (${fmtDate(stats.nextChangeDate)}) patient needs to change to <strong>Aligner Set #${stats.activeSet + 1}</strong>.</div>
        <button class="btn btn-wa btn-sm" onclick="showAlignerSmartWAModal('${p.id}', ${stats.activeSet + 1})">📲 Send Set Change WA</button>
      </div>`);
  } else if (stats.diffChange === 0) {
    alerts.push(`
      <div class="alert-box alert-amber" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div><strong>🟣 Set Change Due Today:</strong> Patient is scheduled to switch to <strong>Aligner Set #${stats.activeSet + 1}</strong> today.</div>
        <button class="btn btn-wa btn-sm" onclick="showAlignerSmartWAModal('${p.id}', ${stats.activeSet + 1})">📲 WhatsApp Reminder</button>
      </div>`);
  }

  if (stats.diffReview === 1) {
    alerts.push(`
      <div class="alert-box alert-blue" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div><strong>🔵 Review Due Tomorrow:</strong> Clinical aligner review appointment scheduled on ${fmtDate(stats.nextReviewDate)}.</div>
        <button class="btn btn-primary btn-sm" onclick="showAlignerReviewModal('${p.id}')">🩺 Open Review</button>
      </div>`);
  }

  var batches = details.batches || [];
  if (batches.length > 0) {
    var latestBatch = batches[batches.length - 1];
    if (latestBatch.expectedFinishDate) {
      var diffBatch = Math.round((new Date(latestBatch.expectedFinishDate + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / (1000 * 60 * 60 * 24));
      if (diffBatch >= 0 && diffBatch <= 5) {
        alerts.push(`
          <div class="alert-box alert-amber" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div><strong>📦 Batch Finishing Soon:</strong> Batch #${latestBatch.batchNum} (${latestBatch.fromSet || 1}–${latestBatch.toSet || 10}) finishes in ${diffBatch} days (${fmtDate(latestBatch.expectedFinishDate)}). Prepare next batch delivery.</div>
            <button class="btn btn-primary btn-sm" onclick="showAlignerDeliverBatchModal('${p.id}')">📦 Deliver Next Batch</button>
          </div>`);
      }
    }
  }

  if (stats.dueAmount > 0) {
    alerts.push(`
      <div class="alert-box" style="background:#fffbeb;border:1px solid #fde68a;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div><strong>💰 Outstanding Balance:</strong> ${fmtMoney(stats.dueAmount)} pending for this aligner treatment.</div>
        <button class="btn btn-ghost btn-sm" style="color:#b45309" onclick="showAlignerPaymentModal('${p.id}')">+ Add Payment</button>
      </div>`);
  }

  return alerts.join('');
}

/* ── Smart Timeline Event Rendering ── */
function aligner_renderSmartTimeline(p, details, stats, schedule) {
  var events = [];

  events.push({
    type: 'start',
    date: details.startDate || todayISO(),
    title: '🚀 Aligner Treatment Commenced',
    badge: 'Setup',
    color: '#0284c7',
    bg: '#f0f9ff',
    icon: '🚀',
    desc: `Brand: <strong>${esc(details.brand || 'Aligner')}</strong> • Total Sets: <strong>${details.totalSets}</strong> • Set Duration: <strong>${details.setDurationDays || 10} days</strong> • Review Interval: <strong>${details.reviewIntervalDays || 30} days</strong>`,
    notes: details.notes || ''
  });

  (details.batches || []).forEach(function(b, idx) {
    events.push({
      type: 'batch',
      id: b.id || ('bat_' + idx),
      rawIndex: idx,
      date: b.date || todayISO(),
      title: `📦 Batch #${b.batchNum || (idx + 1)} Delivered (Sets ${b.fromSet || '1'}–${b.toSet || '10'})`,
      badge: 'Batch Delivered',
      color: '#4f46e5',
      bg: '#eef2ff',
      icon: '📦',
      desc: `Expected Finish Date: <strong>${fmtDate(b.expectedFinishDate)}</strong>` + (b.amountReceived ? ` • Amount Received: <strong>${fmtMoney(b.amountReceived)}</strong>` : ''),
      notes: b.notes || ''
    });
  });

  (details.reviews || []).forEach(function(r, idx) {
    events.push({
      type: 'review',
      id: r.id || ('rev_' + idx),
      rawIndex: idx,
      date: r.date || todayISO(),
      title: `🩺 Clinical Review (Set #${r.setWearing || '—'})`,
      badge: 'Review Visit',
      color: '#7c3aed',
      bg: '#f5f3ff',
      icon: '🩺',
      desc: `Tracking: <strong>${esc(r.tracking || 'Good')}</strong> • Compliance: <strong>${esc(r.compliance || '20–22h')}</strong>` + (r.ipr ? ` • IPR: <strong>${esc(r.ipr)}</strong>` : '') + (r.attachments ? ` • Attachments: <strong>${esc(r.attachments)}</strong>` : ''),
      notes: r.notes || '',
      nextReview: r.nextReviewDate ? `Next Review: <strong>${fmtDate(r.nextReviewDate)}</strong>` : '',
      photos: r.photos || []
    });
  });

  (details.payments || []).forEach(function(pay, idx) {
    events.push({
      type: 'payment',
      id: pay.id || ('pay_' + idx),
      rawIndex: idx,
      date: pay.date || todayISO(),
      title: `💰 Payment Received: ${fmtMoney(pay.amount)}`,
      badge: 'Payment',
      color: '#059669',
      bg: '#ecfdf5',
      icon: '💰',
      desc: `Mode: <strong>${esc(pay.mode || 'Cash')}</strong>` + (pay.remark ? ` • Remark: <em>${esc(pay.remark)}</em>` : '')
    });
  });

  (details.delays || []).forEach(function(d, idx) {
    events.push({
      type: 'delay',
      id: d.id || ('del_' + idx),
      rawIndex: idx,
      date: d.date || todayISO(),
      title: `⚠️ Issue Registered: ${esc(d.issueType || 'Delay')} (+${d.delayDays || 0} Days)`,
      badge: 'Delay / Issue',
      color: '#d97706',
      bg: '#fffbeb',
      icon: '⚠️',
      desc: `Affected Set: <strong>Set #${d.affectedSet || '—'}</strong> • Resumed: <strong>${fmtDate(d.resumeDate)}</strong>`,
      notes: d.notes || ''
    });
  });

  (details.refinements || []).forEach(function(ref, idx) {
    events.push({
      type: 'refinement',
      id: ref.id || ('ref_' + idx),
      rawIndex: idx,
      date: ref.deliveryDate || ref.scanDate || todayISO(),
      title: `✨ Refinement Phase: ${esc(ref.refNum || ('R' + (idx + 1)))} (+${ref.additionalSets || 0} Sets)`,
      badge: 'Refinement',
      color: '#0891b2',
      bg: '#ecfeff',
      icon: '✨',
      desc: `Scan Date: <strong>${fmtDate(ref.scanDate)}</strong> • Delivery: <strong>${fmtDate(ref.deliveryDate)}</strong>` + (ref.cost ? ` • Cost: <strong>${fmtMoney(ref.cost)}</strong>` : ''),
      notes: ref.notes || ''
    });
  });

  events.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  if (!events.length) {
    return '<div class="empty"><div class="empty-title">No timeline events recorded</div></div>';
  }

  return `
    <div style="position:relative;padding-left:24px;border-left:2px solid #e2e8f0;margin-left:12px">
      ${events.map(function(ev) {
        return `
          <div style="position:relative;margin-bottom:18px">
            <div style="position:absolute;left:-33px;top:0;width:20px;height:20px;border-radius:50%;background:${ev.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;border:2px solid #fff;box-shadow:0 0 0 2px ${ev.color}">
              ${ev.icon}
            </div>
            <div class="card" style="padding:14px 16px;background:${ev.bg};border:1px solid ${ev.color}40;border-radius:12px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;margin-bottom:4px">
                <div>
                  <span style="font-size:11px;font-weight:700;color:${ev.color};text-transform:uppercase;letter-spacing:.4px">${ev.badge}</span>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px">📅 ${fmtDate(ev.date)}</span>
                  <div style="font-weight:700;font-size:14px;color:#1e293b;margin-top:2px">${ev.title}</div>
                </div>
                ${ev.type !== 'start' ? `
                  <button class="btn btn-ghost btn-sm" style="font-size:11px;color:#dc2626;padding:2px 6px" onclick="aligner_deleteTimelineEvent('${p.id}', '${ev.type}', ${ev.rawIndex})">🗑️ Delete</button>
                ` : ''}
              </div>
              <div style="font-size:12.5px;color:#475569;margin-top:4px">${ev.desc}</div>
              ${ev.notes ? `<div style="font-size:12px;color:#64748b;margin-top:6px;background:rgba(255,255,255,0.7);padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0">📝 ${esc(ev.notes)}</div>` : ''}
              ${ev.nextReview ? `<div style="font-size:12px;color:#7c3aed;margin-top:4px">📅 ${ev.nextReview}</div>` : ''}
              ${ev.photos && ev.photos.length > 0 ? `
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                  ${ev.photos.map(function(src) {
                    return `<img src="${src}" onclick="openLightbox('${src}')" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer"/>`;
                  }).join('')}
                </div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function aligner_renderReviewsList(p, details) {
  var revs = details.reviews || [];
  if (!revs.length) {
    return `<div class="empty"><div class="empty-title">No clinical reviews logged yet</div><div class="empty-sub">Click "New Review" to log tracking, compliance, IPR, and attachments.</div></div>`;
  }
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${revs.map(function(r, idx) {
        return `
          <div class="card card-body" style="padding:16px 18px;border-left:4px solid #7c3aed">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-weight:700;font-size:15px;color:#1e3a5f">Review on ${fmtDate(r.date)} — Set Wearing: #${r.setWearing || '—'}</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:12.5px">
                  <span class="badge badge-blue">Tracking: ${esc(r.tracking || 'Good')}</span>
                  <span class="badge badge-teal">Compliance: ${esc(r.compliance || '20–22h')}</span>
                  ${r.ipr ? `<span class="badge" style="background:#fef3c7;color:#b45309">IPR: ${esc(r.ipr)}</span>` : ''}
                  ${r.attachments ? `<span class="badge" style="background:#ecfeff;color:#0891b2">Attachments: ${esc(r.attachments)}</span>` : ''}
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" style="color:#dc2626" onclick="aligner_deleteTimelineEvent('${p.id}', 'review', ${idx})">🗑️ Delete</button>
            </div>
            ${r.notes ? `<div style="margin-top:10px;font-size:13px;color:#475569;background:#f8fafc;padding:8px 12px;border-radius:8px"><strong>Clinical Notes:</strong> ${esc(r.notes)}</div>` : ''}
            ${r.nextReviewDate ? `<div style="margin-top:8px;font-size:12px;color:#7c3aed;font-weight:600">📅 Next Review Scheduled: ${fmtDate(r.nextReviewDate)}</div>` : ''}
            ${r.photos && r.photos.length > 0 ? `
              <div style="display:flex;gap:8px;margin-top:10px">
                ${r.photos.map(function(src) {
                  return `<img src="${src}" onclick="openLightbox('${src}')" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1.5px solid #e2e8f0;cursor:pointer"/>`;
                }).join('')}
              </div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

function aligner_renderBatchesList(p, details) {
  var batches = details.batches || [];
  if (!batches.length) {
    return `<div class="empty"><div class="empty-title">No batches delivered yet</div><div class="empty-sub">Click "Deliver Batch" to deliver aligner trays (e.g. Sets 1–10).</div></div>`;
  }
  return `
    <div class="table-wrap">
      <div class="table-head" style="grid-template-columns:100px 1.5fr 1fr 1fr 1.5fr auto">
        <div>Date</div><div>Batch #</div><div>Sets Included</div><div>Expected Finish</div><div>Notes</div><div></div>
      </div>
      ${batches.map(function(b, idx) {
        return `
          <div class="table-row" style="grid-template-columns:100px 1.5fr 1fr 1fr 1.5fr auto">
            <div>${fmtDate(b.date)}</div>
            <div style="font-weight:700">Batch #${b.batchNum || (idx + 1)}</div>
            <div><span class="badge badge-blue">Sets ${b.fromSet}–${b.toSet}</span></div>
            <div>${fmtDate(b.expectedFinishDate)}</div>
            <div style="font-size:12px;color:#64748b">${esc(b.notes || '—')}</div>
            <div>
              <button class="btn btn-ghost btn-sm" style="color:#dc2626;padding:2px 6px" onclick="aligner_deleteTimelineEvent('${p.id}', 'batch', ${idx})">🗑️</button>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function aligner_renderPaymentLedger(p, details, stats) {
  var payments = details.payments || [];
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:12px">
        <div style="font-size:11px;color:#64748b;font-weight:700">TOTAL TREATMENT COST</div>
        <div style="font-size:20px;font-weight:800;color:#1e293b">${fmtMoney(stats.totalCost)}</div>
      </div>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;padding:12px 16px;border-radius:12px">
        <div style="font-size:11px;color:#059669;font-weight:700">TOTAL RECEIVED</div>
        <div style="font-size:20px;font-weight:800;color:#059669">${fmtMoney(stats.totalPaid)}</div>
      </div>
      <div style="background:${stats.dueAmount > 0 ? '#fffbeb' : '#f0fdf4'};border:1px solid ${stats.dueAmount > 0 ? '#fde68a' : '#bbf7d0'};padding:12px 16px;border-radius:12px">
        <div style="font-size:11px;color:${stats.dueAmount > 0 ? '#d97706' : '#16a34a'};font-weight:700">OUTSTANDING DUE</div>
        <div style="font-size:20px;font-weight:800;color:${stats.dueAmount > 0 ? '#dc2626' : '#16a34a'}">${fmtMoney(stats.dueAmount)}</div>
      </div>
    </div>

    ${!payments.length ? `
      <div class="empty"><div class="empty-title">No payments logged in aligner ledger</div><div class="empty-sub">Click "Add Payment" to record an installment.</div></div>
    ` : `
      <div class="table-wrap">
        <div class="table-head" style="grid-template-columns:110px 1.2fr 1.2fr 2fr auto">
          <div>Date</div><div>Amount</div><div>Mode</div><div>Remark / Receipt</div><div></div>
        </div>
        ${payments.map(function(pay, idx) {
          return `
            <div class="table-row" style="grid-template-columns:110px 1.2fr 1.2fr 2fr auto">
              <div>${fmtDate(pay.date)}</div>
              <div style="font-weight:800;color:#059669">${fmtMoney(pay.amount)}</div>
              <div><span class="badge badge-teal">${esc(pay.mode || 'Cash')}</span></div>
              <div style="font-size:12px;color:#475569">${esc(pay.remark || '—')}</div>
              <div>
                <button class="btn btn-ghost btn-sm" style="color:#dc2626;padding:2px 6px" onclick="aligner_deleteTimelineEvent('${p.id}', 'payment', ${idx})">🗑️</button>
              </div>
            </div>`;
        }).join('')}
      </div>
    `}`;
}

function aligner_renderIssuesList(p, details) {
  var delays = details.delays || [];
  if (!delays.length) {
    return `<div class="empty"><div class="empty-title">No issues or delays registered</div><div class="empty-sub">If an aligner is broken, lost, or tracking poorly, click "Register Issue" to auto-shift future set dates.</div></div>`;
  }
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${delays.map(function(d, idx) {
        return `
          <div class="card card-body" style="padding:14px 18px;border-left:4px solid #d97706;background:#fffbeb">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:700;font-size:14px;color:#92400e">${esc(d.issueType || 'Delay')} — ${d.delayDays || 0} Days Pushed</div>
                <div style="font-size:12px;color:#78350f;margin-top:2px">
                  Date: <strong>${fmtDate(d.date)}</strong> • Affected Set: <strong>Set #${d.affectedSet || '—'}</strong> • Resumed: <strong>${fmtDate(d.resumeDate)}</strong>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" style="color:#dc2626" onclick="aligner_deleteTimelineEvent('${p.id}', 'delay', ${idx})">🗑️ Delete</button>
            </div>
            ${d.notes ? `<div style="margin-top:8px;font-size:12px;color:#78350f;background:rgba(255,255,255,0.7);padding:6px 10px;border-radius:6px">📝 ${esc(d.notes)}</div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

/* ── Active Set Trigger Helper ── */
function aligner_markSetActive(ptId, setNum) {
  var details = aligner_getPatientDetails(ptId);
  if (!details) return;
  if (!confirm('Switch patient to Aligner Set #' + setNum + ' as current active set?')) return;
  details.currentSet = parseInt(setNum);
  aligner_savePatientDetails(ptId, details);
  renderAlignerDetailTab();
}

/* ── Timeline Delete & Edit ── */
function aligner_deleteTimelineEvent(ptId, type, index) {
  var details = aligner_getPatientDetails(ptId);
  if (!details) return;
  if (!confirm('Delete this ' + type + ' entry? This cannot be undone.')) return;

  if (type === 'batch' && details.batches) {
    details.batches.splice(index, 1);
  } else if (type === 'review' && details.reviews) {
    details.reviews.splice(index, 1);
  } else if (type === 'payment' && details.payments) {
    details.payments.splice(index, 1);
  } else if (type === 'delay' && details.delays) {
    details.delays.splice(index, 1);
  } else if (type === 'refinement' && details.refinements) {
    details.refinements.splice(index, 1);
  }

  aligner_savePatientDetails(ptId, details);
  renderAlignerDetailTab();
}

/* ══════════════════════════════════════════════════════
   ALIGNER MODALS (Setup, Deliver, Review, Payment, Delay, Refinement, WA)
   ══════════════════════════════════════════════════════ */

/* 1. INITIAL TREATMENT SETUP MODAL */
function showAlignerSetupModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};

  var overlay = document.createElement('div');
  overlay.id = 'al-setup-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-setup-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">💎 Initial Treatment Setup — ${esc(p.name)}</h3>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Treatment Start Date *</label>
          <input class="form-input" id="als-start" type="date" value="${d.startDate || todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">First Set Start Date *</label>
          <input class="form-input" id="als-firstSet" type="date" value="${d.firstSetDate || d.startDate || todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Company / Brand</label>
          <select class="form-input" id="als-brand">
            <option ${d.brand==='Invisalign'?'selected':''}>Invisalign</option>
            <option ${d.brand==='Flash'?'selected':''}>Flash</option>
            <option ${d.brand==='Toothsi'?'selected':''}>Toothsi</option>
            <option ${d.brand==='Illusion'?'selected':''}>Illusion</option>
            <option ${d.brand==='ClearCorrect'?'selected':''}>ClearCorrect</option>
            <option ${d.brand==='In-House 3D'?'selected':''}>In-House 3D</option>
            <option ${d.brand==='Other'?'selected':''}>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Total Aligner Sets *</label>
          <input class="form-input" id="als-totalSets" type="number" min="1" value="${d.totalSets || 20}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Standard Set Duration</label>
          <select class="form-input" id="als-duration">
            <option value="7" ${parseInt(d.setDurationDays)===7?'selected':''}>7 Days / Set</option>
            <option value="10" ${parseInt(d.setDurationDays)===10||!d.setDurationDays?'selected':''}>10 Days / Set (Standard)</option>
            <option value="14" ${parseInt(d.setDurationDays)===14?'selected':''}>14 Days / Set</option>
            <option value="21" ${parseInt(d.setDurationDays)===21?'selected':''}>21 Days / Set</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Sets Per Batch (Default)</label>
          <input class="form-input" id="als-setsPerBatch" type="number" min="1" value="${d.setsPerBatch || 10}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Review Interval (Days)</label>
          <input class="form-input" id="als-reviewInterval" type="number" min="7" value="${d.reviewIntervalDays || 30}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Total Treatment Cost (₹)</label>
          <input class="form-input" id="als-totalCost" type="number" min="0" value="${d.totalCost || 0}" placeholder="e.g. 120000"/>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Clinical Notes / Case Description</label>
        <textarea class="form-input" id="als-notes" rows="2" placeholder="e.g. Moderate crowding, Class I, non-extraction approach...">${esc(d.notes || '')}</textarea>
      </div>

      <div class="alert-box alert-blue" style="font-size:12px;margin-bottom:14px">
        ℹ️ The system will automatically calculate and generate the entire set-change schedule from Day 1.
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="saveAlignerSetupModal('${p.id}')">💾 Save Treatment Setup</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-setup-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function saveAlignerSetupModal(ptId) {
  var d = aligner_getPatientDetails(ptId) || {};
  d.startDate = document.getElementById('als-start').value || todayISO();
  d.firstSetDate = document.getElementById('als-firstSet').value || d.startDate;
  d.brand = document.getElementById('als-brand').value;
  d.totalSets = parseInt(document.getElementById('als-totalSets').value) || 20;
  d.setDurationDays = parseInt(document.getElementById('als-duration').value) || 10;
  d.setsPerBatch = parseInt(document.getElementById('als-setsPerBatch').value) || 10;
  d.reviewIntervalDays = parseInt(document.getElementById('als-reviewInterval').value) || 30;
  d.totalCost = Number(document.getElementById('als-totalCost').value) || 0;
  d.notes = document.getElementById('als-notes').value;

  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-setup-modal').remove();
  renderAlignerDetailTab();
}

/* 2. BATCH DELIVERY MODAL */
function showAlignerDeliverBatchModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var batches = d.batches || [];
  var nextBatchNum = batches.length + 1;

  var lastToSet = 0;
  if (batches.length > 0) {
    lastToSet = parseInt(batches[batches.length - 1].toSet) || 0;
  }
  var fromSet = lastToSet + 1;
  var toSet = Math.min(parseInt(d.totalSets || 20), fromSet + (parseInt(d.setsPerBatch || 10) - 1));
  var setsCount = Math.max(1, (toSet - fromSet + 1));
  var expFinish = addDaysToDate(todayISO(), setsCount * (parseInt(d.setDurationDays) || 10));

  var overlay = document.createElement('div');
  overlay.id = 'al-batch-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:550px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-batch-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">📦 Deliver Aligner Batch — ${esc(p.name)}</h3>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Delivery Date *</label>
          <input class="form-input" id="alb-date" type="date" value="${todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Batch Number (Auto)</label>
          <input class="form-input" id="alb-num" type="number" value="${nextBatchNum}" readonly style="background:#f8fafc"/>
        </div>
        <div class="form-group">
          <label class="form-label">From Set #</label>
          <input class="form-input" id="alb-from" type="number" min="1" value="${fromSet}" oninput="aligner_recalcBatchFinish()"/>
        </div>
        <div class="form-group">
          <label class="form-label">To Set #</label>
          <input class="form-input" id="alb-to" type="number" min="1" value="${toSet}" oninput="aligner_recalcBatchFinish()"/>
        </div>
        <div class="form-group">
          <label class="form-label">Expected Finish Date (Auto)</label>
          <input class="form-input" id="alb-finish" type="date" value="${expFinish}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Amount Received (Optional ₹)</label>
          <input class="form-input" id="alb-amount" type="number" min="0" placeholder="0"/>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Batch Delivery Notes</label>
        <textarea class="form-input" id="alb-notes" rows="2" placeholder="e.g. Trays 1–10 handed over with case box, chewies & remover hook..."></textarea>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="saveAlignerDeliverBatchModal('${p.id}')">💾 Record Batch Delivery</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-batch-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function aligner_recalcBatchFinish() {
  var from = parseInt(document.getElementById('alb-from').value) || 1;
  var to = parseInt(document.getElementById('alb-to').value) || from;
  var count = Math.max(1, to - from + 1);
  var finishEl = document.getElementById('alb-finish');
  var dateEl = document.getElementById('alb-date');
  if (finishEl) {
    finishEl.value = addDaysToDate(dateEl ? dateEl.value : todayISO(), count * 10);
  }
}

function saveAlignerDeliverBatchModal(ptId) {
  var d = aligner_getPatientDetails(ptId);
  if (!d) return;

  var date = document.getElementById('alb-date').value || todayISO();
  var num = parseInt(document.getElementById('alb-num').value) || (d.batches || []).length + 1;
  var fromSet = parseInt(document.getElementById('alb-from').value) || 1;
  var toSet = parseInt(document.getElementById('alb-to').value) || fromSet;
  var finish = document.getElementById('alb-finish').value || addDaysToDate(date, (toSet - fromSet + 1) * 10);
  var amt = Number(document.getElementById('alb-amount').value) || 0;
  var notes = document.getElementById('alb-notes').value;

  if (!d.batches) d.batches = [];
  d.batches.push({
    id: 'bat_' + Date.now(),
    batchNum: num,
    date: date,
    fromSet: fromSet,
    toSet: toSet,
    expectedFinishDate: finish,
    amountReceived: amt,
    notes: notes
  });

  if (amt > 0) {
    if (!d.payments) d.payments = [];
    d.payments.push({
      id: 'pay_' + Date.now(),
      date: date,
      amount: amt,
      mode: 'Cash / Batch Delivery',
      remark: 'Payment received during Batch #' + num + ' delivery'
    });
  }

  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-batch-modal').remove();
  renderAlignerDetailTab();
}

/* 3. REVIEW VISIT MODAL */
function showAlignerReviewModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var stats = aligner_calcStats(d);
  var nextRev = addDaysToDate(todayISO(), parseInt(d.reviewIntervalDays) || 30);

  var overlay = document.createElement('div');
  overlay.id = 'al-review-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-review-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">🩺 Aligner Clinical Review — ${esc(p.name)}</h3>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Review Date *</label>
          <input class="form-input" id="alr-date" type="date" value="${todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Current Set Wearing *</label>
          <input class="form-input" id="alr-set" type="number" min="1" max="${stats.totalSets}" value="${stats.activeSet}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Tracking Quality</label>
          <select class="form-input" id="alr-tracking">
            <option>Good / Ideal</option>
            <option>Fair (minor lag)</option>
            <option>Poor / Lagging</option>
            <option>Air Gap Observed</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Patient Compliance</label>
          <select class="form-input" id="alr-compliance">
            <option>Excellent (22h+ daily)</option>
            <option selected>20–22 hours daily</option>
            <option>Irregular (14–18h)</option>
            <option>Poor (&lt;14h daily)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">IPR Performed / Planned</label>
          <input class="form-input" id="alr-ipr" placeholder="e.g. 0.3mm mesial of 14, 24 done"/>
        </div>
        <div class="form-group">
          <label class="form-label">Attachment Status</label>
          <select class="form-input" id="alr-attachments">
            <option>All Intact</option>
            <option>Replaced Broken Attachment</option>
            <option>Added New Attachments</option>
            <option>Removed Attachments</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Next Review Date</label>
          <input class="form-input" id="alr-nextDate" type="date" value="${nextRev}"/>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Clinical Notes</label>
        <textarea class="form-input" id="alr-notes" rows="2" placeholder="Clinical observations, seating assessment, patient feedback..."></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Upload Progress Photos (Optional)</label>
        <input type="file" id="alr-photos" multiple accept="image/*" class="form-input" onchange="aligner_handleReviewPhotoPreview(this)"/>
        <div id="alr-photo-preview" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"></div>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="saveAlignerReviewModal('${p.id}')">💾 Save Review Visit</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-review-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

var _alignerReviewPhotosTemp = [];
function aligner_handleReviewPhotoPreview(input) {
  _alignerReviewPhotosTemp = [];
  var wrap = document.getElementById('alr-photo-preview');
  if (!wrap) return;
  wrap.innerHTML = '';
  var files = Array.from(input.files || []);
  files.forEach(function(f) {
    var r = new FileReader();
    r.onload = function(e) {
      _alignerReviewPhotosTemp.push(e.target.result);
      var img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1';
      wrap.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}

function saveAlignerReviewModal(ptId) {
  var d = aligner_getPatientDetails(ptId);
  if (!d) return;

  var date = document.getElementById('alr-date').value || todayISO();
  var setWearing = parseInt(document.getElementById('alr-set').value) || d.currentSet || 1;
  var tracking = document.getElementById('alr-tracking').value;
  var compliance = document.getElementById('alr-compliance').value;
  var ipr = document.getElementById('alr-ipr').value;
  var attachments = document.getElementById('alr-attachments').value;
  var nextRev = document.getElementById('alr-nextDate').value;
  var notes = document.getElementById('alr-notes').value;

  if (!d.reviews) d.reviews = [];
  d.reviews.push({
    id: 'rev_' + Date.now(),
    date: date,
    setWearing: setWearing,
    tracking: tracking,
    compliance: compliance,
    ipr: ipr,
    attachments: attachments,
    nextReviewDate: nextRev,
    notes: notes,
    photos: _alignerReviewPhotosTemp.slice()
  });

  d.currentSet = setWearing;

  _alignerReviewPhotosTemp = [];
  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-review-modal').remove();
  renderAlignerDetailTab();
}

/* 4. INDEPENDENT PAYMENT MODAL */
function showAlignerPaymentModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var stats = aligner_calcStats(d);

  var overlay = document.createElement('div');
  overlay.id = 'al-pay-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:500px;width:100%;padding:24px;position:relative">
      <button onclick="document.getElementById('al-pay-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">💰 Add Aligner Payment — ${esc(p.name)}</h3>

      <div style="background:#f8fafc;padding:10px 14px;border-radius:10px;margin-bottom:14px;display:flex;justify-content:space-between;font-size:12px">
        <span>Total Cost: <strong>${fmtMoney(stats.totalCost)}</strong></span>
        <span>Balance Due: <strong style="color:#dc2626">${fmtMoney(stats.dueAmount)}</strong></span>
      </div>

      <div class="form-group">
        <label class="form-label">Payment Date *</label>
        <input class="form-input" id="alpay-date" type="date" value="${todayISO()}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Amount (₹) *</label>
        <input class="form-input" id="alpay-amount" type="number" min="1" value="${stats.dueAmount > 0 ? stats.dueAmount : ''}" placeholder="e.g. 15000" autofocus/>
      </div>
      <div class="form-group">
        <label class="form-label">Payment Mode</label>
        <select class="form-input" id="alpay-mode">
          <option>UPI / GPay / PhonePe</option>
          <option>Cash</option>
          <option>Card (POS)</option>
          <option>Bank Transfer (NEFT/IMPS)</option>
          <option>Cheque</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Remark / Receipt Note</label>
        <input class="form-input" id="alpay-remark" placeholder="e.g. 2nd installment, online receipt #..."/>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-primary" style="flex:1" onclick="saveAlignerPaymentModal('${p.id}')">💾 Record Payment</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-pay-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function saveAlignerPaymentModal(ptId) {
  var d = aligner_getPatientDetails(ptId);
  if (!d) return;

  var amt = Number(document.getElementById('alpay-amount').value) || 0;
  if (amt <= 0) { alert('Please enter a valid payment amount.'); return; }
  var date = document.getElementById('alpay-date').value || todayISO();
  var mode = document.getElementById('alpay-mode').value;
  var remark = document.getElementById('alpay-remark').value;

  if (!d.payments) d.payments = [];
  d.payments.push({
    id: 'pay_' + Date.now(),
    date: date,
    amount: amt,
    mode: mode,
    remark: remark
  });

  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-pay-modal').remove();
  renderAlignerDetailTab();
}

/* 5. DELAY / BREAK / LOST SET MODAL */
function showAlignerIssueModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var stats = aligner_calcStats(d);

  var overlay = document.createElement('div');
  overlay.id = 'al-issue-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:550px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-issue-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">⚠️ Register Issue / Delay — ${esc(p.name)}</h3>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Issue Type *</label>
          <select class="form-input" id="ali-type">
            <option>Broken Aligner</option>
            <option>Lost Aligner</option>
            <option>Poor Tracking / Non-fit</option>
            <option>Patient Not Wearing</option>
            <option>Waiting For Remake</option>
            <option>Attachment Dislodged</option>
            <option>Travel / Break</option>
            <option>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Affected Set # *</label>
          <input class="form-input" id="ali-set" type="number" min="1" max="${stats.totalSets}" value="${stats.activeSet}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Date of Issue</label>
          <input class="form-input" id="ali-date" type="date" value="${todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Days Delayed *</label>
          <input class="form-input" id="ali-days" type="number" min="1" value="7" oninput="aligner_recalcIssueResume()"/>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Resume Date (Auto-calculated)</label>
          <input class="form-input" id="ali-resume" type="date" value="${addDaysToDate(todayISO(), 7)}"/>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Clinical Notes / Action Taken</label>
        <textarea class="form-input" id="ali-notes" rows="2" placeholder="e.g. Lower aligner cracked at molar. Instructed to wear previous set until replacement is delivered..."></textarea>
      </div>

      <div class="alert-box alert-amber" style="font-size:12px;margin-bottom:14px">
        ⚡ <strong>Auto-Schedule Adjustment:</strong> Registering this issue will automatically push all remaining set dates and final completion date forward by the delayed days without modifying completed history.
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-amber" style="flex:1" onclick="saveAlignerIssueModal('${p.id}')">⚠️ Register & Push Schedule</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-issue-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function aligner_recalcIssueResume() {
  var d = document.getElementById('ali-date').value || todayISO();
  var days = parseInt(document.getElementById('ali-days').value) || 0;
  var resumeEl = document.getElementById('ali-resume');
  if (resumeEl) {
    resumeEl.value = addDaysToDate(d, days);
  }
}

function saveAlignerIssueModal(ptId) {
  var d = aligner_getPatientDetails(ptId);
  if (!d) return;

  var type = document.getElementById('ali-type').value;
  var setNum = parseInt(document.getElementById('ali-set').value) || d.currentSet || 1;
  var date = document.getElementById('ali-date').value || todayISO();
  var days = parseInt(document.getElementById('ali-days').value) || 7;
  var resume = document.getElementById('ali-resume').value || addDaysToDate(date, days);
  var notes = document.getElementById('ali-notes').value;

  if (!d.delays) d.delays = [];
  d.delays.push({
    id: 'del_' + Date.now(),
    issueType: type,
    affectedSet: setNum,
    date: date,
    delayDays: days,
    resumeDate: resume,
    notes: notes
  });

  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-issue-modal').remove();
  renderAlignerDetailTab();
}

/* 6. REFINEMENT PHASE MODAL */
function showAlignerRefinementModal(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var refs = d.refinements || [];
  var nextRefNum = 'R' + (refs.length + 1);

  var overlay = document.createElement('div');
  overlay.id = 'al-refinement-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:550px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-refinement-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 16px">✨ Start Refinement Phase — ${esc(p.name)}</h3>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Refinement Phase</label>
          <input class="form-input" id="alref-num" value="${nextRefNum}" readonly style="background:#f8fafc"/>
        </div>
        <div class="form-group">
          <label class="form-label">Additional Sets *</label>
          <input class="form-input" id="alref-sets" type="number" min="1" value="6" placeholder="e.g. 6"/>
        </div>
        <div class="form-group">
          <label class="form-label">Scan Date</label>
          <input class="form-input" id="alref-scan" type="date" value="${todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Delivery Date</label>
          <input class="form-input" id="alref-delivery" type="date" value="${addDaysToDate(todayISO(), 14)}"/>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Additional Cost (Optional ₹)</label>
          <input class="form-input" id="alref-cost" type="number" min="0" placeholder="0 if included in package"/>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Refinement Clinical Objectives / Notes</label>
        <textarea class="form-input" id="alref-notes" rows="2" placeholder="e.g. Minor rotation on 12 remaining, detailing anterior coupling..."></textarea>
      </div>

      <div class="alert-box alert-blue" style="font-size:12px;margin-bottom:14px">
        ℹ️ Original treatment history will remain untouched. Refinement sets will be appended to the total schedule.
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="saveAlignerRefinementModal('${p.id}')">💾 Start Refinement</button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-refinement-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function saveAlignerRefinementModal(ptId) {
  var d = aligner_getPatientDetails(ptId);
  if (!d) return;

  var refNum = document.getElementById('alref-num').value;
  var addlSets = parseInt(document.getElementById('alref-sets').value) || 0;
  var scanDate = document.getElementById('alref-scan').value || todayISO();
  var deliveryDate = document.getElementById('alref-delivery').value || scanDate;
  var cost = Number(document.getElementById('alref-cost').value) || 0;
  var notes = document.getElementById('alref-notes').value;

  if (addlSets <= 0) { alert('Please enter the number of additional sets.'); return; }

  if (!d.refinements) d.refinements = [];
  d.refinements.push({
    id: 'ref_' + Date.now(),
    refNum: refNum,
    scanDate: scanDate,
    deliveryDate: deliveryDate,
    additionalSets: addlSets,
    cost: cost,
    notes: notes
  });

  aligner_savePatientDetails(ptId, d);
  document.getElementById('al-refinement-modal').remove();
  renderAlignerDetailTab();
}

/* 7. ONE-TAP WHATSAPP REMINDER MODAL (CRITICAL) */
function showAlignerSmartWAModal(ptId, targetSetNum) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var stats = aligner_calcStats(d);
  var nextSet = targetSetNum || (stats.activeSet + 1 > stats.totalSets ? stats.activeSet : stats.activeSet + 1);

  var defaultMsg = `Hello ${p.name},\n\nThis is your reminder from The Home of Smiles Dental Clinic.\n\nTomorrow you need to change to Aligner Set ${nextSet}.\n\nPlease wear the new aligner for 20–22 hours daily.\n\nIf the current aligner is not fitting properly, reply to this message before changing it.\n\n— Dr. Tanmay Jain`;

  var overlay = document.createElement('div');
  overlay.id = 'al-wa-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:580px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;position:relative">
      <button onclick="document.getElementById('al-wa-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:#1e3a5f;margin:0 0 14px;display:flex;align-items:center;gap:6px">
        <span>📲 Send WhatsApp Reminder</span>
      </h3>
      <div style="font-size:12px;color:#64748b;margin-bottom:14px">
        Patient: <strong>${esc(p.name)}</strong> (${p.phone || 'No phone'})
      </div>

      <div style="font-weight:700;font-size:12px;color:#334155;margin-bottom:8px">Select Reminder Scenario:</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 10px;background:#f0fdf4;border-radius:8px;border:1px solid #86efac">
          <input type="radio" name="alwa-opt" value="set_tomorrow" checked onchange="aligner_updateWAMessage('${p.id}', ${nextSet})"/>
          <span>⭐ <strong>1 Day Before Set Change</strong> (Default — Change to Set ${nextSet} Tomorrow)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <input type="radio" name="alwa-opt" value="set_today" onchange="aligner_updateWAMessage('${p.id}', ${nextSet})"/>
          <span>🔄 <strong>On Set Change Day</strong> (Change to Set ${nextSet} Today)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <input type="radio" name="alwa-opt" value="rev_2d" onchange="aligner_updateWAMessage('${p.id}', ${nextSet})"/>
          <span>🩺 <strong>2 Days Before Review</strong> (Appointment on ${fmtDate(stats.nextReviewDate)})</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <input type="radio" name="alwa-opt" value="rev_7d" onchange="aligner_updateWAMessage('${p.id}', ${nextSet})"/>
          <span>🩺 <strong>7 Days Before Review</strong> (Upcoming checkup reminder)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <input type="radio" name="alwa-opt" value="payment" onchange="aligner_updateWAMessage('${p.id}', ${nextSet})"/>
          <span>💰 <strong>Outstanding Payment Reminder</strong> (${fmtMoney(stats.dueAmount)} balance)</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label">Message Preview (Editable)</label>
        <textarea class="form-input" id="alwa-text" rows="7" style="font-family:sans-serif;font-size:13px;line-height:1.6">${defaultMsg}</textarea>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-wa" style="flex:1;padding:12px;font-size:14px" onclick="dispatchAlignerSmartWA('${p.id}')">
          📲 One-Tap Open WhatsApp
        </button>
        <button class="btn btn-ghost" onclick="document.getElementById('al-wa-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function aligner_updateWAMessage(ptId, nextSet) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var d = aligner_getPatientDetails(p.id) || {};
  var stats = aligner_calcStats(d);
  var sel = document.querySelector('input[name="alwa-opt"]:checked');
  var val = sel ? sel.value : 'set_tomorrow';
  var txtEl = document.getElementById('alwa-text');
  if (!txtEl) return;

  var msg = '';
  if (val === 'set_tomorrow') {
    msg = `Hello ${p.name},\n\nThis is your reminder from The Home of Smiles Dental Clinic.\n\nTomorrow you need to change to Aligner Set ${nextSet}.\n\nPlease wear the new aligner for 20–22 hours daily.\n\nIf the current aligner is not fitting properly, reply to this message before changing it.\n\n— Dr. Tanmay Jain`;
  } else if (val === 'set_today') {
    msg = `Hello ${p.name},\n\nThis is your reminder from The Home of Smiles Dental Clinic.\n\nToday you need to change to Aligner Set ${nextSet}.\n\nPlease wear the new aligner for 20–22 hours daily.\n\nIf the current aligner is not fitting properly, reply to this message before changing it.\n\n— Dr. Tanmay Jain`;
  } else if (val === 'rev_2d') {
    msg = `Hello ${p.name},\n\nThis is your reminder from The Home of Smiles Dental Clinic.\n\nYour Aligner Review Appointment is scheduled on ${fmtDate(stats.nextReviewDate)}.\n\nPlease make sure to bring your current and previous aligner sets with you.\n\n— Dr. Tanmay Jain`;
  } else if (val === 'rev_7d') {
    msg = `Hello ${p.name},\n\nThis is an advance reminder from The Home of Smiles Dental Clinic regarding your upcoming Aligner Review on ${fmtDate(stats.nextReviewDate)}.\n\nLet us know if you need to adjust your appointment timing.\n\n— Dr. Tanmay Jain`;
  } else if (val === 'payment') {
    msg = `Hello ${p.name},\n\nThis is a gentle reminder from The Home of Smiles Dental Clinic regarding your pending balance of ${fmtMoney(stats.dueAmount)} for your clear aligner treatment.\n\nYou can pay during your next review or via UPI.\n\n— Dr. Tanmay Jain`;
  }
  txtEl.value = msg;
}

function dispatchAlignerSmartWA(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p || !p.phone) {
    alert('Please enter a valid phone number for this patient.');
    return;
  }
  var text = document.getElementById('alwa-text').value;
  var phone = p.phone.replace(/\D/g, '').slice(-10);
  var url = 'https://wa.me/91' + phone + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
  var m = document.getElementById('al-wa-modal');
  if (m) m.remove();
}

/* 8. APPOINTMENTS & IN-APP NOTIFICATIONS SYNC */
function aligner_syncToAppointments(ptId, details, stats) {
  if (!DATA.appointments) DATA.appointments = [];
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; });
  if (!p) return;

  DATA.appointments = DATA.appointments.filter(function(a) {
    return !(a.patientId === ptId && a.isAlignerSync === true);
  });

  if (stats.nextChangeDate && stats.status === 'ongoing') {
    DATA.appointments.push({
      id: 'al_chg_' + ptId + '_' + Date.now(),
      patientId: ptId,
      patientName: p.name,
      phone: p.phone || '',
      date: stats.nextChangeDate,
      time: '10:00',
      type: 'Aligner Set Change',
      icon: '🟣',
      notes: `🟣 Tomorrow/Scheduled — Change to Set #${stats.activeSet + 1}`,
      isAlignerSync: true
    });
  }

  if (stats.nextReviewDate && stats.status === 'ongoing') {
    DATA.appointments.push({
      id: 'al_rev_' + ptId + '_' + Date.now(),
      patientId: ptId,
      patientName: p.name,
      phone: p.phone || '',
      date: stats.nextReviewDate,
      time: '11:00',
      type: 'Aligner Review',
      icon: '🔵',
      notes: `🔵 ${fmtDate(stats.nextReviewDate)} — Aligner Review Appointment`,
      isAlignerSync: true
    });
  }
}

/* 9. PRINTABLE PROGRESS REPORT */
function printAlignerProgressReport(ptId) {
  var p = (DATA.patients || []).find(function(x) { return x.id === ptId; }) || activePt;
  if (!p) return;
  var details = aligner_getPatientDetails(p.id) || {};
  var schedule = aligner_calcSchedule(details);
  var stats = aligner_calcStats(details, schedule);

  var batches = details.batches || [];
  var reviews = details.reviews || [];
  var payments = details.payments || [];
  var delays = details.delays || [];
  var refs = details.refinements || [];

  var batchRows = batches.map(function(b) {
    return `<tr><td>${fmtDate(b.date)}</td><td>Batch #${b.batchNum}</td><td>Sets ${b.fromSet}–${b.toSet}</td><td>${fmtDate(b.expectedFinishDate)}</td><td>${esc(b.notes||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No batch deliveries recorded</td></tr>';

  var reviewRows = reviews.map(function(r) {
    return `<tr><td>${fmtDate(r.date)}</td><td>Set #${r.setWearing||'—'}</td><td>${esc(r.tracking||'Good')}</td><td>${esc(r.compliance||'20–22h')}</td><td>${esc(r.ipr||'None')}</td><td>${esc(r.attachments||'Intact')}</td><td>${esc(r.notes||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">No review visits recorded</td></tr>';

  var payRows = payments.map(function(pay) {
    return `<tr><td>${fmtDate(pay.date)}</td><td>${fmtMoney(pay.amount)}</td><td>${esc(pay.mode||'Cash')}</td><td>${esc(pay.remark||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">No payment entries</td></tr>';

  var delayRows = delays.map(function(d) {
    return `<tr><td>${fmtDate(d.date)}</td><td>${esc(d.issueType||'Delay')}</td><td>Set #${d.affectedSet||'—'}</td><td>+${d.delayDays||0} Days</td><td>${fmtDate(d.resumeDate)}</td><td>${esc(d.notes||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">No delay issues registered</td></tr>';

  var refRows = refs.map(function(r) {
    return `<tr><td>${esc(r.refNum||'R1')}</td><td>${fmtDate(r.scanDate)}</td><td>${fmtDate(r.deliveryDate)}</td><td>+${r.additionalSets} Sets</td><td>${fmtMoney(r.cost||0)}</td><td>${esc(r.notes||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">No refinement phases recorded</td></tr>';

  var win = window.open('', '_blank', 'width=850,height=950');
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Aligner Progress Report — ${esc(p.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; color: #1e293b; line-height: 1.5; }
    h2, h3 { color: #1e3a5f; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
    th { background: #1e3a5f; color: #fff; padding: 7px 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    .sec-hdr { font-size: 14px; font-weight: 700; color: #1e3a5f; margin: 18px 0 8px; border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; }
    @media print { button { display: none !important; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:16px">
    <div>
      <h2 style="margin:0;color:#1e3a5f">The Home of Smiles Dental Clinic</h2>
      <div style="font-size:13px;color:#64748b">Clear Aligner Treatment & Progress Record</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#475569">
      <strong>Dr. Tanmay Jain</strong><br/>
      Date: ${fmtDate(todayISO())}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;background:#f8fafc;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12.5px">
    <div>
      <div><strong>Patient:</strong> ${esc(p.name)} (ID: ${p.id})</div>
      <div><strong>Age / Gender:</strong> ${p.age || '—'}y / ${p.gender || '—'}</div>
      <div><strong>Phone:</strong> ${p.phone || '—'}</div>
    </div>
    <div>
      <div><strong>Brand:</strong> ${esc(details.brand || 'Invisalign')}</div>
      <div><strong>Progress:</strong> Set ${stats.activeSet} of ${stats.totalSets} (${stats.progressPct}%)</div>
      <div><strong>Start Date:</strong> ${fmtDate(details.startDate)} • <strong>Est. Finish:</strong> ${fmtDate(stats.estimatedCompletion)}</div>
    </div>
  </div>

  <div class="sec-hdr">1. Batch Delivery History</div>
  <table>
    <thead><tr><th>Date</th><th>Batch</th><th>Sets</th><th>Expected Finish</th><th>Notes</th></tr></thead>
    <tbody>${batchRows}</tbody>
  </table>

  <div class="sec-hdr">2. Review Visits & Tracking Log</div>
  <table>
    <thead><tr><th>Date</th><th>Set</th><th>Tracking</th><th>Compliance</th><th>IPR</th><th>Attachments</th><th>Notes</th></tr></thead>
    <tbody>${reviewRows}</tbody>
  </table>

  <div class="sec-hdr">3. Independent Payment Ledger</div>
  <table>
    <thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Remark</th></tr></thead>
    <tbody>${payRows}</tbody>
  </table>
  <div style="text-align:right;font-size:12px;margin-bottom:16px">
    <strong>Total Cost:</strong> ${fmtMoney(stats.totalCost)} &nbsp;|&nbsp;
    <strong>Total Paid:</strong> ${fmtMoney(stats.totalPaid)} &nbsp;|&nbsp;
    <strong>Balance Due:</strong> <span style="color:#dc2626;font-weight:700">${fmtMoney(stats.dueAmount)}</span>
  </div>

  <div class="sec-hdr">4. Delay & Issue History</div>
  <table>
    <thead><tr><th>Date</th><th>Issue Type</th><th>Affected Set</th><th>Delay</th><th>Resumed</th><th>Notes</th></tr></thead>
    <tbody>${delayRows}</tbody>
  </table>

  ${refs.length > 0 ? `
    <div class="sec-hdr">5. Refinement Phases</div>
    <table>
      <thead><tr><th>Phase</th><th>Scan Date</th><th>Delivery</th><th>Additional Sets</th><th>Cost</th><th>Notes</th></tr></thead>
      <tbody>${refRows}</tbody>
    </table>
  ` : ''}

  <div style="margin-top:40px;display:flex;justify-content:space-between;gap:40px">
    <div style="flex:1;border-top:1.5px solid #1e3a5f;text-align:center;padding-top:6px;font-size:12px">Patient Signature</div>
    <div style="flex:1;border-top:1.5px solid #1e3a5f;text-align:center;padding-top:6px;font-size:12px">Dr. Tanmay Jain (Home of Smiles)</div>
  </div>

  <div style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="background:#0284c7;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Print Report</button>
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 400);
}

/* ══════════════════════════════════════════════════════
   GLOBAL ALIGNER CASES PAGE (#page-aligner)
   ══════════════════════════════════════════════════════ */
function renderAlignerPage() {
  renderAlignerStats();
  checkAlignerReminders();
  renderAlignerList();
  var formWrap = document.getElementById('aligner-form-wrap');
  var detailWrap = document.getElementById('aligner-detail-wrap');
  var listWrap = document.getElementById('aligner-list');
  if (formWrap) formWrap.style.display = 'none';
  if (detailWrap) detailWrap.style.display = 'none';
  if (listWrap) listWrap.style.display = 'block';
}

function renderAlignerStats() {
  var cases = getAlignerCases();
  var active = cases.filter(function(c) { return c.treatmentStatus === 'ongoing'; }).length;
  var completed = cases.filter(function(c) { return c.treatmentStatus === 'completed'; }).length;
  var overdue = cases.filter(function(c) { return c.treatmentStatus === 'ongoing' && c.nextChangeDate && c.nextChangeDate < todayISO(); }).length;
  var pending = cases.reduce(function(s, c) { return s + (Number(c.pendingAmount) || 0); }, 0);

  var el = document.getElementById('aligner-stats');
  if (!el) return;
  el.innerHTML = [
    { l: 'Total Cases', v: cases.length, icon: '💎', c: '#0284c7', bg: '#e0f2fe' },
    { l: 'Active Cases', v: active, icon: '🔄', c: '#059669', bg: '#ecfdf5' },
    { l: 'Completed', v: completed, icon: '✅', c: '#7c3aed', bg: '#f5f3ff' },
    { l: 'Overdue Changes', v: overdue, icon: '⚠️', c: '#dc2626', bg: '#fef2f2' },
    { l: 'Pending Revenue', v: '₹' + pending.toLocaleString('en-IN'), icon: '💰', c: '#d97706', bg: '#fffbeb' }
  ].map(function(s) {
    return `<div class="stat-card">
      <div>
        <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:5px">${s.l}</div>
        <div style="font-size:24px;font-weight:800;color:#1e293b">${s.v}</div>
      </div>
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
    </div>`;
  }).join('');
}

function checkAlignerReminders() {
  var cases = getAlignerCases();
  var today = todayISO();
  var el = document.getElementById('aligner-reminders');
  if (!el) return;
  var overdue = cases.filter(function(c) { return c.treatmentStatus === 'ongoing' && c.nextChangeDate && c.nextChangeDate < today; });
  var upcoming = cases.filter(function(c) {
    if (c.treatmentStatus !== 'ongoing' || !c.nextChangeDate) return false;
    var diff = (new Date(c.nextChangeDate) - new Date()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 3;
  });

  var html = '';
  if (overdue.length) {
    html += overdue.map(function(c) {
      return `
        <div class="alert-box alert-red" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-weight:700;color:#dc2626">⚠️ Overdue Set Change: ${esc(c.patientName)} — Set #${c.currentSet}/${c.totalSets}</div>
            <div style="font-size:12px;color:#7f1d1d">Change was due: ${fmtDate(c.nextChangeDate)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-wa btn-sm" onclick="showAlignerSmartWAModal('${c.patientId}')">📲 Remind WA</button>
            <button class="btn btn-primary btn-sm" onclick="openPatient('${c.patientId}')">Open Patient</button>
          </div>
        </div>`;
    }).join('');
  }
  if (upcoming.length) {
    html += upcoming.map(function(c) {
      return `
        <div class="alert-box alert-amber" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-weight:700;color:#d97706">⏰ Set Change Due Soon: ${esc(c.patientName)} — Set #${c.currentSet}/${c.totalSets}</div>
            <div style="font-size:12px;color:#92400e">Change scheduled: ${fmtDate(c.nextChangeDate)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-wa btn-sm" onclick="showAlignerSmartWAModal('${c.patientId}')">📲 Remind WA</button>
            <button class="btn btn-primary btn-sm" onclick="openPatient('${c.patientId}')">Open Patient</button>
          </div>
        </div>`;
    }).join('');
  }
  el.innerHTML = html;
}

function renderAlignerList() {
  var cases = getAlignerCases();
  var el = document.getElementById('aligner-list');
  if (!el) return;
  if (!cases.length) {
    el.innerHTML = `<div class="empty"><span class="empty-icon">💎</span>
      <div class="empty-title">No aligner cases registered yet</div>
      <div class="empty-sub">Add an Aligner Patient or create a new case to get started.</div>
      <button class="btn btn-primary" style="margin-top:12px" onclick="goPage('add-patient');document.getElementById('f-type').value='aligner'">➕ Add Aligner Patient</button>
    </div>`;
    return;
  }
  var cols = '2fr 1.2fr 1.4fr 1fr 1fr auto';
  var html = `<div class="table-wrap">
    <div class="table-head" style="grid-template-columns:${cols}">
      <div>Patient / Brand</div><div>Progress</div><div>Next Change</div><div>Payment</div><div>Status</div><div></div>
    </div>`;
  cases.forEach(function(c) {
    var pct = Math.round(((c.currentSet || 1) / (c.totalSets || 1)) * 100);
    var isOverdue = c.treatmentStatus === 'ongoing' && c.nextChangeDate && c.nextChangeDate < todayISO();
    var pending = Number(c.pendingAmount) || 0;

    html += `<div class="table-row row-clickable" style="grid-template-columns:${cols}" onclick="openPatient('${c.patientId}')">
      <div>
        <div style="font-weight:700;font-size:14px;color:#1e3a5f">${esc(c.patientName)}</div>
        <div style="font-size:11px;color:#64748b">${c.phone ? '📞 ' + c.phone : ''} • ${esc(c.brand || 'Aligner')}</div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;margin-bottom:4px">Set ${c.currentSet || 1} / ${c.totalSets || 20}</div>
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%;background:${pct>=100?'#10b981':'#0284c7'}"></div></div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px">${pct}%</div>
      </div>
      <div style="font-size:13px;color:${isOverdue ? '#dc2626' : '#1e293b'};font-weight:600">
        ${fmtDate(c.nextChangeDate)}
        ${isOverdue ? '<div style="font-size:10px;color:#dc2626;font-weight:700">⚠️ Overdue</div>' : ''}
      </div>
      <div>${pending > 0
        ? `<span class="badge badge-amber">₹${pending.toLocaleString('en-IN')} due</span>`
        : `<span class="badge badge-green">Paid ✓</span>`}
      </div>
      <div>${c.treatmentStatus === 'completed' ? '<span class="badge badge-green">Done</span>' : '<span class="badge badge-blue">Active</span>'}</div>
      <div style="display:flex;gap:5px" onclick="event.stopPropagation()">
        <button class="btn btn-wa btn-sm btn-icon" onclick="showAlignerSmartWAModal('${c.patientId}')" title="Send WhatsApp Reminder">📲</button>
        <button class="btn btn-primary btn-sm" onclick="openPatient('${c.patientId}')">Open</button>
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

function showAlignerForm(editId) {
  goPage('add-patient');
  var sel = document.getElementById('f-type');
  if (sel) sel.value = 'aligner';
}

function openAlignerDetail(caseId) {
  var c = getAlignerCases().find(function(x) { return x.id === caseId; });
  if (c && c.patientId) {
    openPatient(c.patientId);
  }
}
`;

const filePath = 'public/clinic_app.js';
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = '/* ══════════════════════════════════════════════════════\r\n   ALIGNER CASES MODULE';
const endMarker = '/* ══════════════════════════════════════════════════════\r\n   RX TEMPLATES';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found: start=' + startIndex + ', end=' + endIndex);
  process.exit(1);
}

const alignerCodeCRLF = alignerCode.replace(/\r?\n/g, '\r\n') + '\r\n\r\n\r\n';
const newContent = content.slice(0, startIndex) + alignerCodeCRLF + content.slice(endIndex);
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Successfully updated public/clinic_app.js with Aligner Module 1.0!');
