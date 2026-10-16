import { getCertificateConfig } from '../constants/certificateConfig.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findItem(items, office) {
  const key = normalize(office);
  return items.find((item) => normalize(item.office_code || item.offices?.code) === key)
    || items.find((item) => normalize(item.office_name || item.offices?.name || item.office) === key);
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(date.toLocaleDateString());
}

export function generateCertificateHtml({ profile = {}, request = {}, items = [], qrCodeBase64 = '', config, generatedAt = new Date().toISOString() }) {
  const certificate = config || getCertificateConfig(profile.academic_level);
  const period = Array.isArray(request.clearance_periods) ? request.clearance_periods[0] : request.clearance_periods;
  const qrSource = qrCodeBase64.startsWith('data:image')
    ? qrCodeBase64
    : `data:image/png;base64,${qrCodeBase64}`;
  const signatoryHtml = certificate.signatories.map((signatory) => {
    const item = findItem(items, signatory.office);
    const approved = item?.status === 'APPROVED';
    const status = item?.status || 'PENDING';
    const stampClass = approved ? 'approved' : status === 'HOLD' ? 'hold' : 'pending';
    const approver = item?.approved_by_name || item?.signatory_name || 'Authorized signatory';
    return `<div class="signatory">
      <div class="signatory-title">${escapeHtml(signatory.title)}</div>
      <div class="signature-line"></div>
      <div class="signatory-name">${escapeHtml(approver)}</div>
      <div class="stamp ${stampClass}">${escapeHtml(status.replaceAll('_', ' '))}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(certificate.headerTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #183528; background: #fff; }
    .outer { min-height: 277mm; border: 7px double #174c35; padding: 7mm; }
    .inner { min-height: 260mm; border: 1px solid #88a38f; padding: 10mm 9mm 8mm; position: relative; }
    .school { text-align: center; color: #315a41; font-size: 10pt; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
    h1 { text-align: center; font-size: 19pt; margin: 7px 0 4px; color: #123e2a; letter-spacing: .4px; }
    .subhead { text-align: center; font-size: 9pt; color: #64776a; margin-bottom: 15px; }
    .rule { height: 2px; background: #d3bd55; margin: 0 auto 14px; width: 82%; }
    .cert-copy { text-align: center; font-size: 10pt; line-height: 1.5; margin: 5px 12px 14px; }
    .meta { width: 100%; border-collapse: collapse; margin: 0 0 13px; }
    .meta td { border: 1px solid #d5dfd7; padding: 7px 9px; width: 50%; vertical-align: top; }
    .label { display: block; color: #728075; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 3px; }
    .value { color: #203d2c; font-size: 10pt; font-weight: 700; }
    .qr-row { display: flex; align-items: center; justify-content: center; gap: 14px; border: 1px solid #d5dfd7; padding: 8px; margin-bottom: 11px; }
    .qr { width: 95px; height: 95px; object-fit: contain; }
    .qr-note { font-size: 8pt; line-height: 1.5; color: #627267; max-width: 220px; }
    h2 { text-align: center; font-size: 10pt; letter-spacing: 1px; color: #174c35; margin: 9px 0 8px; }
    .signatories { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 9px; }
    .signatory { min-height: 49px; border: 1px solid #d5dfd7; padding: 6px 7px; position: relative; }
    .signatory-title { color: #274936; font-size: 7.4pt; font-weight: 700; padding-right: 60px; }
    .signature-line { border-bottom: 1px solid #75877a; margin-top: 15px; width: 76%; }
    .signatory-name { color: #6d7b70; font-size: 6.5pt; margin-top: 2px; }
    .stamp { position: absolute; right: 6px; top: 22px; transform: rotate(-8deg); border: 1.5px solid; border-radius: 3px; padding: 2px 4px; font-size: 6pt; font-weight: 900; letter-spacing: .4px; }
    .approved { color: #19804b; border-color: #19804b; }
    .pending { color: #a77417; border-color: #a77417; }
    .hold { color: #a5352b; border-color: #a5352b; }
    .footer { border-top: 1px solid #d5dfd7; margin-top: 12px; padding-top: 7px; display: flex; justify-content: space-between; color: #768279; font-size: 7pt; }
  </style>
</head>
<body>
  <main class="outer"><div class="inner">
    <div class="school">Western Leyte College</div>
    <h1>${escapeHtml(certificate.headerTitle)}</h1>
    <div class="subhead">Office of Student Affairs and Services · ${escapeHtml(certificate.levelLabel)}</div>
    <div class="rule"></div>
    <p class="cert-copy">This certifies that the student named below has completed the required signatory clearances for the academic period indicated.</p>
    <table class="meta"><tr>
      <td><span class="label">Student name</span><span class="value">${escapeHtml(profile.full_name || 'Student')}</span></td>
      <td><span class="label">Student ID</span><span class="value">${escapeHtml(profile.student_id_number || '—')}</span></td>
    </tr><tr>
      <td><span class="label">Program / course</span><span class="value">${escapeHtml(profile.programs?.code || profile.program_code || '—')}</span></td>
      <td><span class="label">Department · Year</span><span class="value">${escapeHtml(profile.academic_departments?.code || profile.department_code || '—')} · ${escapeHtml(profile.year_level || '—')}</span></td>
    </tr><tr>
      <td><span class="label">Clearance period</span><span class="value">${escapeHtml(period?.title || period?.semester || 'Current period')} ${period?.academic_year ? `· ${escapeHtml(period.academic_year)}` : ''}</span></td>
      <td><span class="label">Completion date</span><span class="value">${formatDate(request.completed_at)}</span></td>
    </tr></table>
    <div class="qr-row"><img class="qr" alt="Clearance verification QR code" src="${qrSource}" /><div class="qr-note"><strong>Verification QR</strong><br />Scan this code to validate the digital clearance credential.<br /><span class="label">Clearance reference: ${escapeHtml(request.id || '—')}</span></div></div>
    <h2>SIGNATORY APPROVALS</h2>
    <div class="signatories">${signatoryHtml}</div>
    <div class="footer"><span>Generated ${formatDate(generatedAt)}</span><span>Clearance ID: ${escapeHtml(request.id || '—')}</span></div>
  </div></main>
</body>
</html>`;
}
