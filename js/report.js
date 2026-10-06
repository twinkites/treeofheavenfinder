// "Report it" dialog: look up the address, pick the state contact, and draft
// an email the person sends from their own mail app.
import { STATE_CONTACTS, EDDMAPS_REPORT, ALL_STATE_CONTACTS } from './report-contacts.js';

const $ = sel => document.querySelector(sel);
const dialog = $('#report');
let current = null; // { lat, lng, confidence, photoLink, photoDate, uploaded, place }

async function reverseGeocode(lat, lng) {
  const q = new URLSearchParams({ format: 'jsonv2', lat, lon: lng, zoom: 18, addressdetails: 1 });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${q}`);
  const json = await res.json();
  const a = json.address ?? {};
  const iso = a['ISO3166-2-lvl4'] ?? '';
  return {
    address: [[a.house_number, a.road].filter(Boolean).join(' '), a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county, a.state]
      .filter(Boolean).join(', ') || json.display_name || '',
    state: a.state ?? '',
    code: iso.startsWith('US-') ? iso.slice(3) : null,
  };
}

function contactFor(place, sawLanternfly) {
  const c = place?.code ? STATE_CONTACTS[place.code] : null;
  if (!c) return { contact: null, sendTo: null };
  const wantsIt = c.asksForToh || sawLanternfly;
  return { contact: c, sendTo: wantsIt && c.email ? c.email : null };
}

function draft() {
  const r = current;
  const sawSlf = $('#rep-slf').checked;
  const checked = $('#rep-checked').checked;
  const name = $('#rep-name').value.trim();
  const coords = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
  const subject = sawSlf
    ? `Spotted lanternfly and tree of heaven near ${r.place?.address || coords}`
    : `Tree of heaven (Ailanthus altissima) near ${r.place?.address || coords}`;
  const lines = [
    'Hello,',
    '',
    sawSlf
      ? 'I would like to report spotted lanternfly on or near a tree of heaven (Ailanthus altissima).'
      : 'I would like to report a possible tree of heaven (Ailanthus altissima), the preferred host of spotted lanternfly.',
    '',
    `Location: ${r.place?.address ? `${r.place.address} ` : ''}(${coords})`,
    `Map: https://www.google.com/maps?q=${r.lat.toFixed(6)},${r.lng.toFixed(6)}`,
  ];
  if (r.photoLink) lines.push(`Photo: ${r.photoLink}${r.photoDate ? ` (taken ${r.photoDate})` : ''}`);
  if (r.uploaded) lines.push('Photo: attached.');
  lines.push(
    '',
    r.uploaded
      ? `I found it with the Tree of Heaven Finder photo check, which rated it ${Math.round(r.confidence * 100)}% likely to be tree of heaven.`
      : `I found it with the Tree of Heaven Finder, which flagged it in street-level imagery at ${Math.round(r.confidence * 100)}% confidence.`,
    checked
      ? 'I have since checked the tree in person and believe the identification is correct.'
      : 'I have not yet confirmed the identification in person.',
  );
  if (sawSlf) lines.push('I saw spotted lanternfly (eggs, nymphs or adults) on or near the tree.');
  lines.push('', 'Thank you,', name || '[your name]');
  return { subject, body: lines.join('\n') };
}

function renderRecipient() {
  const sawSlf = $('#rep-slf').checked;
  const { contact, sendTo } = contactFor(current.place, sawSlf);
  const el = $('#rep-recipient');
  const where = current.place?.state || 'this area';
  const phone = contact?.phone ? ` or call ${contact.phone}` : '';
  if (sendTo) {
    el.innerHTML = `Send to <b>${esc(contact.agency)}</b> at <a href="mailto:${esc(sendTo)}">${esc(sendTo)}</a>${esc(phone)}. <a href="${esc(contact.url)}" target="_blank" rel="noopener">Their guidance</a>`;
  } else if (contact) {
    el.innerHTML = `<b>${esc(contact.agency)}</b> collects spotted lanternfly reports${contact.email ? ', not reports of the tree on its own' : ''}. ` +
      `${contact.email ? 'If you see lanternflies, tick the box above to address this email to them. ' : `Use <a href="${esc(contact.url)}" target="_blank" rel="noopener">their reporting page</a>${esc(phone)}. `}` +
      `To record the tree itself, report it on <a href="${EDDMAPS_REPORT}" target="_blank" rel="noopener">EDDMapS</a>.`;
  } else {
    el.innerHTML = `We don't have a checked email contact for ${esc(where)}. Report the tree on <a href="${EDDMAPS_REPORT}" target="_blank" rel="noopener">EDDMapS</a>, which state and federal agencies use. If you see lanternflies, find your state's contact in the <a href="${ALL_STATE_CONTACTS}" target="_blank" rel="noopener">federal list</a> and send this message there.`;
  }
  const { subject, body } = draft();
  $('#rep-subject').value = subject;
  $('#rep-body').value = body;
  const mailto = `mailto:${sendTo ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $('#rep-send').href = mailto;
  $('#rep-send').textContent = sendTo ? 'Open in my email app' : 'Open as a blank email';
}

export async function openReport(r) {
  current = { ...r, place: null };
  $('#rep-slf').checked = false; // each report starts fresh; the name is kept
  $('#rep-checked').checked = false;
  $('#rep-place').textContent = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} (looking up the address…)`;
  $('#rep-attach').hidden = !r.uploaded;
  $('#rep-status').textContent = '';
  renderRecipient();
  dialog.showModal();
  try {
    current.place = await reverseGeocode(r.lat, r.lng);
    $('#rep-place').textContent = `${current.place.address || 'Address unknown'} (${r.lat.toFixed(5)}, ${r.lng.toFixed(5)})`;
  } catch {
    $('#rep-place').textContent = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} (address lookup unavailable)`;
  }
  renderRecipient();
}

// Edits to the subject or message flow into the mailto link and the copy button.
function syncEdits() {
  const sendTo = $('#rep-send').href.match(/^mailto:([^?]*)/)?.[1] ?? '';
  $('#rep-send').href = `mailto:${sendTo}?subject=${encodeURIComponent($('#rep-subject').value)}&body=${encodeURIComponent($('#rep-body').value)}`;
}

for (const id of ['#rep-slf', '#rep-checked']) $(id).onchange = renderRecipient;
$('#rep-name').oninput = renderRecipient;
$('#rep-subject').oninput = syncEdits;
$('#rep-body').oninput = syncEdits;
$('#rep-close').onclick = () => dialog.close();
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
$('#rep-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(`Subject: ${$('#rep-subject').value}\n\n${$('#rep-body').value}`);
    $('#rep-status').textContent = 'Copied. Paste it into an email or a reporting form.';
  } catch {
    $('#rep-body').select();
    $('#rep-status').textContent = 'Press Ctrl+C (or ⌘C) to copy the selected message.';
  }
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
