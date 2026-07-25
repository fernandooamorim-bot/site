'use strict';
const zlib = require('zlib');

function base64UrlDecode(token) {
  let b64 = String(token || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}

function base64UrlToBuffer(token) {
  let b64 = String(token || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64');
}

function decodePayloadToken(token) {
  const raw = String(token || '').trim();
  if (!raw) throw new Error('TOKEN_AUSENTE');

  if (raw.startsWith('gz1.')) {
    const buf = base64UrlToBuffer(raw.substring(4));
    const json = zlib.gunzipSync(buf).toString('utf8');
    return JSON.parse(json || '{}');
  }

  const decoded = base64UrlDecode(raw);
  return JSON.parse(decoded || '{}');
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
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) {
    return { h: String(Number(m[1])).padStart(2, '0'), m: String(Number(m[2])).padStart(2, '0') };
  }
  m = raw.match(/^(\d{1,2})(\d{2})$/);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) {
    return { h: String(Number(m[1])).padStart(2, '0'), m: String(Number(m[2])).padStart(2, '0') };
  }
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

function compareDateParts(a, b) {
  const left = `${a.y}${a.mo}${a.d}`;
  const right = `${b.y}${b.mo}${b.d}`;
  return left.localeCompare(right);
}

function compareHourParts(a, b) {
  return (Number(a.h) * 60 + Number(a.m)) - (Number(b.h) * 60 + Number(b.m));
}

function foldIcsLine(line) {
  const value = String(line || '');
  const chunks = [];
  let current = '';
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    const limit = chunks.length ? 74 : 75;
    if (current && currentBytes + charBytes > limit) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks.map((chunk, index) => (index ? ' ' : '') + chunk).join('\r\n');
}

function buildVEvent(item, reminderMinutes) {
  const p = toDateOnlyIsoParts(item.d);
  if (!p) return '';

  const startDate = toDateOnlyIsoParts(item.ds) || p;
  let endDate = toDateOnlyIsoParts(item.df) || p;
  const start = toHourParts(item.hi || item.s);
  const end = toHourParts(item.hf || item.f);
  const title = escapeIcsText(item.t || item.e || 'Evento FA Produções');
  const location = escapeIcsText(item.l || '');
  const details = item.e ? escapeIcsText('Ref: ' + String(item.e)) : '';
  const uidRaw = String(item.e || (`evt-${p.y}${p.mo}${p.d}`));
  const uid = uidRaw.replace(/[^a-zA-Z0-9_-]/g, '');
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  let dtStart = '';
  let dtEnd = '';
  if (start && end) {
    // Compatibilidade com tokens antigos, que não carregavam datas
    // cronológicas separadas para eventos que atravessam a meia-noite.
    if (compareDateParts(endDate, startDate) < 0 ||
        (compareDateParts(endDate, startDate) === 0 && compareHourParts(end, start) <= 0)) {
      endDate = nextDay(startDate);
    }
    dtStart = `${startDate.y}${startDate.mo}${startDate.d}T${start.h}${start.m}00`;
    dtEnd = `${endDate.y}${endDate.mo}${endDate.d}T${end.h}${end.m}00`;
  } else {
    const nd = nextDay(p);
    dtStart = `${p.y}${p.mo}${p.d}T090000`;
    dtEnd = `${nd.y}${nd.mo}${nd.d}T090000`;
  }

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    location ? `LOCATION:${location}` : '',
    details ? `DESCRIPTION:${details}` : '',
    'BEGIN:VALARM',
    `TRIGGER:-PT${reminderMinutes}M`,
    'ACTION:DISPLAY',
    'DESCRIPTION:Lembrete do evento',
    'END:VALARM',
    'END:VEVENT'
  ].filter(Boolean).map(foldIcsLine).join('\r\n');
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

    const payload = decodePayloadToken(token);
    if (!payload || typeof payload !== 'object') return badRequest('PAYLOAD_INVALIDO');
    if (payload.exp && Number(payload.exp) < Date.now()) return badRequest('LINK_EXPIRADO');

    const lista = Array.isArray(payload.evs) ? payload.evs : [];
    if (!lista.length) return badRequest('SEM_EVENTOS');
    const reminder = Number(payload.r || 180);
    const reminderMinutes = Number.isFinite(reminder) && reminder > 0 ? Math.floor(reminder) : 180;

    const vevents = [];
    for (let i = 0; i < lista.length; i++) {
      const v = buildVEvent(lista[i] || {}, reminderMinutes);
      if (v) vevents.push(v);
    }
    if (!vevents.length) return badRequest('SEM_EVENTOS_VALIDOS');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FA Producoes//Agenda Semanal//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      vevents.join('\r\n'),
      'END:VCALENDAR',
      ''
    ].join('\r\n');

    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8; method=PUBLISH',
        'content-disposition': 'attachment; filename="agenda-semanal.ics"',
        'content-length': String(Buffer.byteLength(ics, 'utf8')),
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff'
      },
      body: ics
    };
  } catch (err) {
    return badRequest('FALHA_AO_GERAR_ICS_LOTE');
  }
};
