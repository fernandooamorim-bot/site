'use strict';

function base64UrlDecode(token) {
  let b64 = String(token || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}

function toDateOnlyIsoParts(value) {
  const str = String(value || '').trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: m[1], mo: m[2], d: m[3] };
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { y: m[1], mo: m[2], d: m[3] };
  m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return { y: m[3], mo: m[2], d: m[1] };
  return null;
}

function toHourParts(value) {
  const raw = String(value || '').trim();
  let m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { h: String(Number(m[1])).padStart(2, '0'), m: String(Number(m[2])).padStart(2, '0') };
  m = raw.match(/^(\d{1,2})(\d{2})$/);
  if (m) return { h: String(Number(m[1])).padStart(2, '0'), m: String(Number(m[2])).padStart(2, '0') };
  return null;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function nextDay(ymd) {
  const dt = new Date(Number(ymd.y), Number(ymd.mo) - 1, Number(ymd.d), 12, 0, 0, 0);
  dt.setDate(dt.getDate() + 1);
  return {
    y: String(dt.getFullYear()),
    mo: String(dt.getMonth() + 1).padStart(2, '0'),
    d: String(dt.getDate()).padStart(2, '0')
  };
}

function buildIcs(payload) {
  const p = toDateOnlyIsoParts(payload.d);
  if (!p) throw new Error('DATA_INVALIDA');

  const start = toHourParts(payload.hi || payload.s);
  const end = toHourParts(payload.hf || payload.f);
  const title = escapeIcsText(payload.t || payload.e || 'Evento FA Produções');
  const location = escapeIcsText(payload.l || '');
  const details = [];
  if (payload.o) details.push('Obs: ' + String(payload.o));
  if (payload.m) details.push('Maps: ' + String(payload.m));
  if (payload.e) details.push('Ref: ' + String(payload.e));
  const description = escapeIcsText(details.join('\n'));
  const reminder = Number(payload.r || 180);
  const reminderMinutes = Number.isFinite(reminder) && reminder > 0 ? Math.floor(reminder) : 180;

  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  let dtStart = '';
  let dtEnd = '';
  if (start && end) {
    dtStart = `${p.y}${p.mo}${p.d}T${start.h}${start.m}00`;
    dtEnd = `${p.y}${p.mo}${p.d}T${end.h}${end.m}00`;
  } else {
    const nd = nextDay(p);
    dtStart = `${p.y}${p.mo}${p.d}T090000`;
    dtEnd = `${nd.y}${nd.mo}${nd.d}T090000`;
  }

  const uidRaw = String(payload.e || (`evt-${p.y}${p.mo}${p.d}`));
  const uid = uidRaw.replace(/[^a-zA-Z0-9_-]/g, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FA Producoes//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    location ? `LOCATION:${location}` : '',
    description ? `DESCRIPTION:${description}` : '',
    'BEGIN:VALARM',
    `TRIGGER:-PT${reminderMinutes}M`,
    'ACTION:DISPLAY',
    'DESCRIPTION:Lembrete do evento',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return lines.join('\r\n') + '\r\n';
}

function badRequest(message) {
  return {
    statusCode: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: message
  };
}

exports.handler = async (event) => {
  try {
    const token = event?.queryStringParameters?.token;
    if (!token) return badRequest('TOKEN_AUSENTE');

    const decoded = base64UrlDecode(token);
    const payload = JSON.parse(decoded || '{}');
    if (!payload || typeof payload !== 'object') return badRequest('PAYLOAD_INVALIDO');
    if (payload.exp && Number(payload.exp) < Date.now()) return badRequest('LINK_EXPIRADO');

    const ics = buildIcs(payload);
    const safeName = String(payload.e || payload.t || 'evento-fa')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'evento-fa';

    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8; method=PUBLISH',
        'content-disposition': `attachment; filename="${safeName}.ics"`,
        'content-length': String(Buffer.byteLength(ics, 'utf8')),
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff'
      },
      body: ics
    };
  } catch (err) {
    return badRequest('FALHA_AO_GERAR_ICS');
  }
};
