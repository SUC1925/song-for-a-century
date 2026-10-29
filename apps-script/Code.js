/**
 * Song for a Century - bookings backend, filing system and admin console
 * Stellenbosch United Church centenary, Friday 30 October 2026
 *
 * Everything runs in the script owner's account. Anika needs no access to the
 * mailbox or the sheet: she works from the console URL, and every proof of
 * payment is copied to Drive as a link she can open.
 */

const CONFIG = {
  SHEET_ID:      '1wNbauO4XSytTAwd5sS-fg_4EMzZVVa_KBryfRzunD6M',
  SHEET_NAME:    'Bookings',
  NOTIFY_EMAIL:  'jared97will@gmail.com, anikawilliams.pa@gmail.com',
  REPLY_TO:      '',                             // blank = the script owner (you)
  SENDER_NAME:   'Stellenbosch United Church',
  SITE_URL:      'https://suc1925.github.io/song-for-a-century/',
  ADMIN_KEY:     'abaed2b046b9f71bf029ff3d72210f70', // console is at ?key=...  (rotateKeys overrides)
  OFFICE_KEY:    'f71c7ceb5129d108c29618a33bf45637', // office page is at ?desk=... (rotateKeys overrides)
  POP_SEARCH:    '"SFAC-" -from:me newer_than:120d', // our own mail carries SFAC- too; guests' replies are what count
  BUILD:         '2026-10-02-sec3',              // statusCheck prints this - compare it to what I gave you
  ROOT_LABEL:    'Song for a Century',
  DRIVE_FOLDER:  'Song for a Century'
};

const LABELS = {
  bookings: 'Bookings',
  pop:      'Proof of payment',
  tickets:  'Tickets sent',
  donations:'Donations',
  unmatched:'Unmatched'
};

const BANK = [
  ['Account name', 'Stellenbosch United Church'],
  ['Bank', 'Standard Bank'],
  ['Branch', 'Stellenbosch, 050610'],
  ['Account number', '072269901 (current)'],
  ['SWIFT', 'SBZAZAJJ']
];

const HEADERS = ['Timestamp', 'Reference', 'First name', 'Surname', 'Email', 'Mobile',
                 'Seats', 'Amount', 'POP received', 'POP file', 'POP email',
                 'Ticket no', 'Ticket sent', 'Ticket file', 'Notes', 'Mode', 'Lapse notice'];
const C = { ts: 1, ref: 2, first: 3, last: 4, email: 5, wa: 6, seats: 7, amount: 8,
            pop: 9, popFile: 10, popMail: 11, ticket: 12, sent: 13,
            ticketFile: 14, notes: 15, mode: 16, lapse: 17 };

/** Minutes a booking is held before the guest is told to book again. */
const LAPSE_MINUTES = 24 * 60;

/**
 * A personal Gmail account allows Apps Script only so many Gmail calls a day, and
 * a scan every 5 minutes from the trigger plus another from an open console ran
 * through it by mid-afternoon. A full scan now runs at most this often, however
 * many callers ask; the rest return at once without touching Gmail.
 */
const SCAN_EVERY_MINUTES = 10;

/* --------------------------------------------------------------- dry run */

/** A leading + or = makes Sheets parse the cell as a formula, so force text. */
function waText_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[+=\-@]/.test(s) ? "'" + s : s;
}

function props_() { return PropertiesService.getScriptProperties(); }
function isDryRun_() { return props_().getProperty('DRY_RUN') === 'on'; }
function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM HH:mm');
}

function owner_() { return Session.getEffectiveUser().getEmail(); }

/* ---------------------------------------------------------------- access */

/*
 * The web app runs as the owner for anyone, signed in or not, and any page it
 * serves can call every function whose name does not end in _ through
 * google.script.run - even the "needs the console key" page. So every function
 * without a trailing _ must check who is calling before it does anything:
 *   guard_ / deskGuard_  the console and the office page (they pass the key)
 *   ownerOnly_           the editor (an anonymous caller has no active user)
 *   runSlot_             the five-minute jobs (see below)
 * Anything else ends in _ so it cannot be called from a page at all.
 */
function isOwner_() {
  const me = String(owner_() || '').toLowerCase();
  const who = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!me && who === me;
}

function ownerOnly_() { if (!isOwner_()) throw new Error('Not authorised.'); }

/** A time-driven trigger passes its own id, which only the project's triggers know. */
function fromTrigger_(e) {
  const uid = e && e.triggerUid;
  if (!uid) return false;
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === String(uid); });
}

/*
 * The scan and the lapse chaser only do what their triggers exist to do, so they
 * must keep running even if Google changes how a trigger identifies itself. The
 * owner and the project's own triggers always may; anyone else may run one at
 * most once per slot, which is no more often than the trigger already does, so
 * nobody can burn the mail or Gmail quota with it.
 */
function runSlot_(name, e, minutes) {
  const how = fromTrigger_(e) ? 'trigger' : isOwner_() ? 'owner' : 'other';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const key = 'LAST_RUN_' + name;
    const last = Number(props_().getProperty(key) || 0);
    if (how === 'other' && Date.now() - last < minutes * 60 * 1000) throw new Error('Not authorised.');
    props_().setProperty(key, String(Date.now()));
  } finally {
    lock.releaseLock();
  }
  return how;
}

/** True, and claims the slot, when no full scan has started in the last SCAN_EVERY_MINUTES. */
function scanDue_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const last = Number(props_().getProperty('LAST_SCAN_AT') || 0);
    if (Date.now() - last < (SCAN_EVERY_MINUTES - 1) * 60 * 1000) return false;
    props_().setProperty('LAST_SCAN_AT', String(Date.now()));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Runs a scheduled job and records when it last ran, how it was started, and any error. */
function recordRun_(name, how, job) {
  try {
    const res = job();
    props_().setProperty('LAST_OK_' + name, new Date().toISOString() + ' (' + how + ')');
    return res;
  } catch (err) {
    props_().setProperty('LAST_ERR_' + name, new Date().toISOString() + ' (' + how + ') ' + err);
    throw err;
  }
}

/** Keys live in Script Properties once rotateKeys has run; CONFIG is only the fallback. */
function adminKey_()  { return props_().getProperty('ADMIN_KEY')  || CONFIG.ADMIN_KEY; }
function officeKey_() { return props_().getProperty('OFFICE_KEY') || CONFIG.OFFICE_KEY; }

/** Guests type their own names, so anything they send is escaped before it goes into HTML. */
function h_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Our own booking emails carry the reference too, so they must never be read as proofs. */
function fromUs_(msg) {
  const from = String(msg.getFrom() || '').toLowerCase();
  return from.indexOf(String(owner_()).toLowerCase()) !== -1;
}

function inbound_(thread) {
  return thread.getMessages().filter(function (m) { return !fromUs_(m); });
}
function notifyTo_() { return CONFIG.NOTIFY_EMAIL || owner_(); }
function replyTo_()  { return CONFIG.REPLY_TO || owner_(); }

/* ------------------------------------------------------------------ sheet */

function sheet_() {
  const ss = CONFIG.SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME);
  const width = sh.getLastColumn();
  const head = width ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
  if (head.join('|') !== HEADERS.join('|')) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_() {
  const sh = sheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues()
    .map(function (r, i) {
      return {
        row: i + 2,
        ts: r[C.ts - 1], ref: String(r[C.ref - 1] || ''),
        first: r[C.first - 1], last: r[C.last - 1],
        email: String(r[C.email - 1] || ''), wa: r[C.wa - 1],
        seats: r[C.seats - 1], amount: r[C.amount - 1],
        pop: r[C.pop - 1],        popFile: r[C.popFile - 1], popMail: r[C.popMail - 1],
        ticket: r[C.ticket - 1], sent: r[C.sent - 1],
        ticketFile: r[C.ticketFile - 1], notes: r[C.notes - 1],
        mode: r[C.mode - 1], lapse: r[C.lapse - 1]
      };
    });
}

/** Wipe the tab and start numbering again. Ask before using. */
function resetSheet() {
  ownerOnly_();
  const sh = sheet_();
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  return 'Bookings cleared.';
}

/* ------------------------------------------------- Gmail filing and Drive */

/** Looked up once per run: every lookup counts against the daily Gmail allowance. */
const labelCache_ = {};
function label_(leaf) {
  const name = leaf ? CONFIG.ROOT_LABEL + '/' + leaf : CONFIG.ROOT_LABEL;
  if (!labelCache_[name]) labelCache_[name] = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  return labelCache_[name];
}

/** Builds the label tree in your Gmail. Safe to run again. */
function setupGmail() {
  ownerOnly_();
  return setupGmail_();
}

function setupGmail_() {
  label_('');
  const made = Object.keys(LABELS).map(function (k) { return label_(LABELS[k]).getName(); });
  return 'Labels ready:\n' + made.join('\n');
}

/**
 * Optional: writes the Gmail filters for you.
 * Needs Services -> Gmail API added to the project first.
 */
function createFilters() {
  ownerOnly_();
  if (typeof Gmail === 'undefined') {
    throw new Error('Add the Gmail API first: Services -> + -> Gmail API -> Add. Then run this again.');
  }
  setupGmail_();
  const all = (Gmail.Users.Labels.list('me') || {}).labels || [];
  const idOf = function (name) {
    const hit = all.filter(function (l) { return l.name === name; })[0];
    if (!hit) throw new Error('Label missing: ' + name);
    return hit.id;
  };
  const want = [
    { query: '"SFAC-"', label: CONFIG.ROOT_LABEL + '/' + LABELS.pop },
    { query: '"SONGFORACENTURY"', label: CONFIG.ROOT_LABEL + '/' + LABELS.donations },
    { query: 'subject:"Song for a Century" -in:chats', label: CONFIG.ROOT_LABEL }
  ];
  const existing = ((Gmail.Users.Settings.Filters.list('me') || {}).filter || [])
    .map(function (f) { return (f.criteria && f.criteria.query) || ''; });
  let made = 0;
  want.forEach(function (w) {
    if (existing.indexOf(w.query) !== -1) return;
    Gmail.Users.Settings.Filters.create({
      criteria: { query: w.query },
      action: { addLabelIds: [idOf(w.label)], removeLabelIds: ['INBOX'] }
    }, 'me');
    made++;
  });
  return made + ' filter(s) created, ' + (want.length - made) +
    ' already there. Matching mail is labelled and skips the inbox from now on.';
}

function rootFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER);
}

/** Dry-run files live in their own folders so clearing them can never touch the real ones. */
function proofsFolder_()  { return folder_()(isDryRun_() ? 'Proofs of payment (test)' : 'Proofs of payment'); }
function ticketsFolder_() { return folder_()(isDryRun_() ? 'Tickets (test)' : 'Tickets'); }

function folder_() {
  const root = rootFolder_();
  return function (sub) {
    const s = root.getFoldersByName(sub);
    return s.hasNext() ? s.next() : root.createFolder(sub);
  };
}

function shareLink_(file) {
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return file.getUrl();
}

/** Copies a thread's attachments to Drive, returns a link Anika can open. */
function saveProof_(thread, ref) {
  const sub = proofsFolder_();
  const links = [];
  inbound_(thread).forEach(function (m) {
    m.getAttachments({ includeInlineImages: true }).forEach(function (a) {
      if (a.getSize() > 12 * 1024 * 1024) return;
      if (a.getSize() < 8 * 1024) return;   // signature logos and other decoration
      const name = ref + ' - ' + a.getName();
      const existing = sub.getFilesByName(name);
      links.push(shareLink_(existing.hasNext() ? existing.next() : sub.createFile(a.copyBlob().setName(name))));
    });
  });
  return links.join('\n');
}

function labelSent_(subject, leaf) {
  const q = 'in:anywhere subject:"' + subject.replace(/"/g, '') + '" newer_than:1d';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const found = GmailApp.search(q, 0, 3);
      if (found.length) {
        found.forEach(function (t) { t.addLabel(label_(leaf)); });
        return;
      }
    } catch (e) {}
    Utilities.sleep(3000);   // a just-sent message is not in the index yet
  }
  Logger.log('Could not label the sent mail: ' + subject);
}

/**
 * Clears the inbox: labels anything belonging to the concert and archives it.
 * Unmatched proofs are left in the inbox on purpose - those need your eyes.
 */
function fileInbox_() {
  const skip = ' -label:"' + CONFIG.ROOT_LABEL + '/' + LABELS.unmatched + '"';
  // Every rule has to carry a token that belongs to this concert and nothing
  // else. A bare subject:"Booking:" swept up unrelated mail, so it is gone.
  const only = ' -in:chats newer_than:400d';
  // Our own mail carries the reference too, so it must be filed before the
  // proof-of-payment rule runs, or it ends up tagged as a proof.
  const mine = ' -subject:"your booking" -subject:"Booking:" -subject:"Extra seats:"' +
               ' -subject:"Song for a Century - ticket"';
  const rules = [
    { q: 'in:inbox subject:"Song for a Century - ticket"' + only, leaf: LABELS.tickets },
    { q: 'in:inbox subject:"Booking:" subject:"SFAC-"' + only, leaf: LABELS.bookings },
    { q: 'in:inbox subject:"Extra seats:" subject:"SFAC-"' + only, leaf: LABELS.bookings },
    { q: 'in:inbox "SFAC-"' + skip + mine + only, leaf: LABELS.pop },
    { q: 'in:inbox "SONGFORACENTURY"' + skip + only, leaf: LABELS.donations },
    { q: 'in:inbox subject:"Song for a Century"' + skip + only, leaf: '' }
  ];
  // labelSent_ can miss a message Gmail has not indexed yet, so sweep the sent
  // mail as well. These are labelled where they are, never archived.
  [{ q: 'in:sent subject:"Song for a Century - ticket"', leaf: LABELS.tickets },
   { q: 'in:sent subject:"your booking"', leaf: LABELS.bookings },
   { q: 'in:sent subject:"Booking:"', leaf: LABELS.bookings }].forEach(function (r) {
    const lab = label_(r.leaf);
    GmailApp.search(r.q + ' newer_than:400d' + notLabelled_(lab), 0, 100).forEach(function (t) {
      if (t.getLabels().some(function (l) { return l.getName() === lab.getName(); })) return;
      t.addLabel(lab);
    });
  });

  // Nothing inbound is archived here. The inbox is Anika's work queue: a booking
  // notification, a payment alert or a guest's reply stays visible until it has
  // been dealt with, and scanPop archives a proof only once its ticket has gone
  // out. Before this, the catch-all rule swept guest replies out of sight the
  // moment they arrived.
  let filed = 0;
  rules.forEach(function (r) {
    const lab = label_(r.leaf);
    GmailApp.search(r.q + notLabelled_(lab), 0, 100).forEach(function (t) {
      if (t.getLabels().some(function (l) { return l.getName() === lab.getName(); })) return;
      t.addLabel(lab);
      filed++;
    });
  });
  return filed;
}

/** Leaves already-filed threads out of a search, so each run only reads what is new. */
function notLabelled_(lab) { return ' -label:"' + lab.getName() + '"'; }

/**
 * Pulls back anything the old build archived on arrival, so replies that were
 * never seen come back to the inbox. Bookings whose ticket has gone out stay
 * archived. Run once from the editor after updating.
 */
function unarchiveOpen() {
  ownerOnly_();
  const done = {};
  rows_().forEach(function (r) {
    if (String(r.sent || '').trim()) done[String(r.ref || '').toUpperCase()] = true;
  });
  let back = 0;
  GmailApp.search('label:"' + CONFIG.ROOT_LABEL + '" -in:inbox -in:sent newer_than:120d', 0, 200)
    .forEach(function (t) {
      const hit = (t.getFirstMessageSubject() || '').toUpperCase()
        .match(/SFAC-[A-Z0-9]+-[A-Z0-9]+-\d+(?:-\d+)?/);
      if (hit && done[hit[0]]) return;
      t.moveToInbox();
      back++;
    });
  Logger.log(back + ' thread(s) back in the inbox.');
  return back + ' thread(s) back in the inbox.';
}

/**
 * Takes the Proof of payment label off our own booking mail and notifications,
 * and gives them the Bookings label instead. Run once from the editor.
 */
function fixLabels() {
  ownerOnly_();
  const pop = GmailApp.getUserLabelByName(CONFIG.ROOT_LABEL + '/' + LABELS.pop);
  if (!pop) return 'No Proof of payment label yet.';
  const books = label_(LABELS.bookings);
  const tickets = label_(LABELS.tickets);
  let moved = 0;
  pop.getThreads(0, 200).forEach(function (t) {
    const subject = String(t.getFirstMessageSubject() || '');
    const ourTicket = /Song for a Century - ticket/i.test(subject);
    const ourBooking = /your booking|^Booking:|^Extra seats:/i.test(subject);
    if (!ourTicket && !ourBooking) return;
    // A guest reply in the same thread makes it a genuine proof, so leave it.
    if (ourBooking && inbound_(t).length) return;
    t.removeLabel(pop);
    t.addLabel(ourTicket ? tickets : books);
    moved++;
  });
  const msg = moved + ' thread(s) moved off the Proof of payment label.';
  Logger.log(msg);
  return msg;
}

/**
 * Undoes bad filing: anything under the concert label that carries none of the
 * concert's own tokens is unlabelled and put back in the inbox.
 */
function unfileStrays() {
  ownerOnly_();
  const root = CONFIG.ROOT_LABEL;
  const names = [root].concat(Object.keys(LABELS).map(function (k) { return root + '/' + LABELS[k]; }));
  let freed = 0;
  names.forEach(function (name) {
    const lab = GmailApp.getUserLabelByName(name);
    if (!lab) return;
    lab.getThreads(0, 200).forEach(function (t) {
      const hay = (t.getFirstMessageSubject() + ' ' + t.getMessages().map(function (m) {
        return m.getPlainBody();
      }).join(' ')).toUpperCase();
      const ours = hay.indexOf('SFAC-') > -1 || hay.indexOf('SONGFORACENTURY') > -1 ||
                   hay.indexOf('SONG FOR A CENTURY') > -1;
      if (ours) return;
      names.forEach(function (n2) {
        const l2 = GmailApp.getUserLabelByName(n2);
        if (l2) { try { t.removeLabel(l2); } catch (e) {} }
      });
      t.moveToInbox();
      freed++;
    });
  });
  const msg = freed + ' unrelated thread(s) unlabelled and put back in the inbox.';
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------- booking comes in */

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const first = String(p.first || '').trim();
    const last  = String(p.last  || '').trim();
    const email = String(p.email || '').trim();
    if (!first || !last || !email) return textOut_('missing fields');

    // The posted reference and amount are only what the page worked out. Anyone
    // can post anything, so both are worked out again here the same way.
    const seats  = Math.max(1, parseInt(p.seats, 10) || 1);
    const pens   = Math.min(seats, Math.max(0, parseInt(p.pensioners, 10) || 0));
    const amount = priceWith_(seats, pens);
    const b = { first: first, last: last, email: email, wa: String(p.wa || '').trim(),
                seats: seats, amount: amount, ref: webRef_(first, last, seats) };

    const dup = findDuplicate_(first, last, email);
    if (dup) return handleDuplicate_(dup, b);

    // Two different guests with the same name and seats would otherwise share a reference.
    const already = countRef_(b.ref);
    if (already) b.ref = b.ref + '-' + (already + 1);

    sheet_().appendRow([new Date(), b.ref, first, last, email, waText_(b.wa), seats, amount,
                        '', '', '', '', '', '', '', isDryRun_() ? 'TEST' : '', '']);
    const sh = sheet_();
    const row = sh.getLastRow();

    // The guest's email matters most, so it goes first and a failure is recorded
    // on the row rather than disappearing into the catch below.
    let guestOk = true;
    try {
      mailGuestBooked_(b);
    } catch (mailErr) {
      guestOk = false;
      note_(sh, row, 'BOOKING EMAIL FAILED ' + stamp_() + ' - ' + mailErr);
      Logger.log('Guest email failed for ' + email + ': ' + mailErr);
    }
    try {
      notifyOffice_(b, guestOk ? '' : 'Booking - GUEST EMAIL FAILED');
    } catch (notifyErr) {
      Logger.log('Office notification failed: ' + notifyErr);
    }
    return textOut_(guestOk ? 'ok' : 'ok-no-email');
  } catch (err) {
    return textOut_('error: ' + err);
  }
}

/** Same first name, surname and email as a booking already on the sheet. */
function findDuplicate_(first, last, email) {
  const key = (first + '|' + last + '|' + email).toLowerCase().replace(/\s+/g, '');
  const hits = rows_().filter(function (r) {
    return (String(r.first) + '|' + String(r.last) + '|' + String(r.email))
      .toLowerCase().replace(/\s+/g, '') === key;
  });
  return hits.length ? hits[hits.length - 1] : null;
}

function note_(sh, row, text) {
  const cur = String(sh.getRange(row, C.notes).getValue() || '').trim();
  sh.getRange(row, C.notes).setValue(cur ? cur + ' | ' + text : text);
}

/**
 * A repeat submission while the first booking is still unpaid just corrects that
 * booking. Once the proof is in or the ticket is out, the guest is buying extra
 * seats, so it becomes a booking of its own with its own ticket number.
 */
function handleDuplicate_(dup, b) {
  const sh = sheet_();
  const settled = String(dup.sent || '').trim() || String(dup.pop || '').trim();
  const sameSeats = Number(dup.seats) === Number(b.seats);

  // Identical resubmission of an unpaid booking: refresh it in place.
  if (!settled && sameSeats) {
    sh.getRange(dup.row, C.ts).setValue(new Date());
    sh.getRange(dup.row, C.ref).setValue(b.ref);
    sh.getRange(dup.row, C.wa).setValue(waText_(b.wa));
    sh.getRange(dup.row, C.amount).setValue(b.amount);
    sh.getRange(dup.row, C.lapse).clearContent();
    note_(sh, dup.row, 'Submitted again ' + stamp_() + ' - same ' + b.seats + ' seat(s)');
    mailGuestBooked_(b);
    notifyOffice_(b, 'Repeat booking');
    return textOut_('updated');
  }

  // Anything else is a second booking. Keep the first row exactly as it is.
  const seq = countRef_(b.ref) + 1;
  if (seq > 1) b.ref = b.ref + '-' + seq;
  const why = settled
    ? 'Extra seats - booking ' + seq + ' for this guest'
    : 'Second booking ' + stamp_() + ' - the earlier ' + dup.seats +
      '-seat booking (' + dup.ref + ') still stands';
  sh.appendRow([new Date(), b.ref, b.first, b.last, b.email, waText_(b.wa), b.seats, b.amount,
                '', '', '', '', '', '', why, isDryRun_() ? 'TEST' : '', '']);
  note_(sh, dup.row, 'Booked again ' + stamp_() + ' as ' + b.ref +
                     ' (' + b.seats + ' seat(s)) - this booking unchanged');
  mailGuestBooked_(b);
  notifyOffice_(b, settled ? 'Extra seats' : 'Second booking');
  return textOut_('ok');
}

/** How many bookings already carry this reference, so the next gets -2, -3 and so on. */
function countRef_(ref) {
  const base = String(ref).toUpperCase();
  return rows_().filter(function (r) {
    const v = String(r.ref || '').toUpperCase();
    return v === base || v.indexOf(base + '-') === 0;
  }).length;
}

/** The website's reference, built the same way index.html builds it: SFAC-FIRST-SURNAME-SEATS. */
function webRef_(first, last, seats) {
  const clean = function (s) { return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''); };
  return 'SFAC-' + (clean(first) || 'NAME') + '-' + (clean(last) || 'SURNAME') + '-' + seats;
}

function textOut_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}

/* --------------------------------------------------------------- outgoing */

function send_(to, subject, html, attachments) {
  MailApp.sendEmail({
    to: to, subject: (isDryRun_() ? '[TEST] ' : '') + subject, htmlBody: html,
    name: CONFIG.SENDER_NAME, replyTo: replyTo_(),
    attachments: attachments || []
  });
}

function shell_(inner) {
  return '<div style="font-family:Georgia,serif;color:#1c1a15;background:#f5f1e7;padding:32px;">' +
    '<div style="max-width:520px;margin:0 auto;">' +
    '<div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#9c4a26;">' +
    'Stellenbosch United Church &middot; 1925&ndash;2025</div>' +
    '<div style="font-size:30px;line-height:1.15;padding:6px 0 18px;">Song for a Century</div>' +
    inner +
    '<div style="border-top:1px solid #d8d0c0;margin-top:26px;padding-top:14px;font-size:12px;' +
    'font-family:Helvetica,Arial,sans-serif;color:#6b6355;line-height:1.6;">' +
    '8 Van Riebeeck Street, Stellenbosch Central 7600 &middot; Church office 021 887 0495<br>' +
    'No parking at the church, drop-off only. ' +
    '<a href="' + CONFIG.SITE_URL + '" style="color:#9c4a26;">' + CONFIG.SITE_URL + '</a></div>' +
    '</div></div>';
}

function para_(t) {
  return '<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;margin:0 0 14px;">' + t + '</p>';
}

function bankBlock_(ref) {
  let rows = BANK.map(function (b) {
    return '<tr><td style="padding:3px 16px 3px 0;color:#6b6355;">' + b[0] + '</td>' +
           '<td style="padding:3px 0;font-weight:bold;">' + b[1] + '</td></tr>';
  }).join('');
  rows += '<tr><td style="padding:3px 16px 3px 0;color:#6b6355;">Reference</td>' +
          '<td style="padding:3px 0;font-weight:bold;color:#9c4a26;">' + h_(ref) + '</td></tr>';
  return '<table style="font-family:Helvetica,Arial,sans-serif;font-size:14px;border-collapse:collapse;' +
         'background:#fff;margin:0 0 16px;width:100%;">' + rows + '</table>';
}

function mailGuestBooked_(b) {
  const subject = 'Song for a Century - your booking, ' + b.ref;
  send_(b.email, subject, shell_(
    para_('Dear ' + h_(b.first) + ',') +
    para_('Thank you for booking ' + b.seats + (b.seats === 1 ? ' seat' : ' seats') +
          ' for the centenary organ concert on Friday 30 October 2026, 18:00 for 18:30. ' +
          'Winand Grundling at the organ, with Annatjie Joubert, soprano. Cheese and wine to follow.') +
    para_('<b>Amount due: R' + b.amount + '</b>. Please pay by EFT using the reference exactly as shown, ' +
          'so we can match your payment to your name.') +
    bankBlock_(b.ref) +
    para_('Reply to this email with the proof of payment, or send it with the reference in the ' +
          'subject line. Your numbered ticket follows once the payment reflects.') +
    para_('With thanks,<br>Stellenbosch United Church')));
  labelSent_(subject, LABELS.bookings);
}

/**
 * A proof has arrived. Kept short on purpose: the whole message fits in an
 * iPhone notification banner, so Anika sees who paid without opening anything.
 */
function alertProof_(list) {
  const names = list.map(function (r) { return r.first + ' ' + r.last; }).join(', ');
  const subject = 'Payment in: ' + names +
                  (list.length === 1 ? ' (R' + list[0].amount + ')' : ' - ' + list.length + ' bookings');
  const rows = list.map(function (r) {
    return para_('<b>' + h_(r.first) + ' ' + h_(r.last) + '</b> &middot; ' + h_(r.seats) +
                 ' seat(s) &middot; R' + h_(r.amount) + '<br>' +
                 '<span style="color:#6b6355;">' + h_(r.ref) + '</span>');
  }).join('');
  send_(notifyTo_(), subject, shell_(rows +
    para_('<a href="' + consoleUrl_() + '" style="color:#9c4a26;">Open the console to send the ticket</a>')));
}

function notifyOffice_(b, heading) {
  const row = function (k, v) {
    return '<tr><td style="padding:2px 16px 2px 0;color:#6b6355;">' + k + '</td><td>' + v + '</td></tr>';
  };
  send_(notifyTo_(), (heading || 'Booking') + ': ' + b.first + ' ' + b.last +
        ' (' + b.seats + ') ' + b.ref, shell_(
    para_('<b>' + (heading || 'New booking') + '</b>') +
    '<table style="font-family:Helvetica,Arial,sans-serif;font-size:14px;border-collapse:collapse;">' +
    row('Name', h_(b.first + ' ' + b.last)) + row('Email', h_(b.email)) + row('WhatsApp', h_(b.wa || '-')) +
    row('Seats', h_(b.seats)) + row('Amount', 'R' + h_(b.amount)) + row('Reference', '<b>' + h_(b.ref) + '</b>') +
    '</table>' +
    para_('<a href="' + consoleUrl_() + '" style="color:#9c4a26;">Open the booking console</a>')));
}

/* --------------------------------------------------------- ticket as file */

function ticketHtml_(b, ticketNo) {
  const cell = function (label, value) {
    return '<td style="padding:0 22px 0 0;vertical-align:top;">' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;">' + label + '</div>' +
      '<div style="font-family:Georgia,serif;font-size:12.5pt;color:#1c1a15;padding-top:5px;line-height:1.45;">' + value + '</div></td>';
  };
  return '<html><body style="margin:0;font-family:Georgia,serif;color:#1c1a15;">' +
    '<div style="padding:64px 68px;border-top:3px solid #9c4a26;">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;color:#9c4a26;letter-spacing:3.4px;">Stellenbosch United Church &middot; 1925&ndash;2025</div>' +
    '<div style="font-size:44pt;line-height:1.02;padding:14px 0 6px;">Song for a Century</div>' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;letter-spacing:2.6px;">A centenary organ concert</div>' +
    '<div style="border-top:1px solid #d6cdba;margin:38px 0 0;"></div>' +
    '<table style="width:100%;border-collapse:collapse;"><tr>' +
    '<td style="padding:26px 0;vertical-align:bottom;">' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;">Admits</div>' +
      '<div style="font-size:24pt;line-height:1.15;padding-top:6px;">' + h_(b.first) + ' ' + h_(b.last) + '</div>' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;padding-top:8px;">' + b.seats + (b.seats === 1 ? ' seat' : ' seats') + '</div>' +
    '</td>' +
    '<td style="padding:26px 0;vertical-align:bottom;text-align:right;white-space:nowrap;">' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;">Ticket</div>' +
      '<div style="font-size:24pt;color:#9c4a26;padding-top:6px;letter-spacing:1px;">' + ticketNo + '</div>' +
    '</td></tr></table>' +
    '<div style="border-top:1px solid #d6cdba;"></div>' +
    '<table style="width:100%;border-collapse:collapse;"><tr style="vertical-align:top;">' +
      cell('When', 'Friday 30 October 2026<br>18:00 for 18:30') +
      cell('Where', '8 Van Riebeeck Street<br>Stellenbosch Central') +
      cell('Performers', 'Winand Grundling, organ<br>Annatjie Joubert, soprano') +
    '</tr></table>' +
    '<div style="border-top:1px solid #d6cdba;margin-top:26px;"></div>' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;letter-spacing:2.2px;text-transform:uppercase;color:#8a8275;color:#9c4a26;letter-spacing:3.4px;text-align:center;padding:16px 0;">Cheese and wine to follow</div>' +
    '<div style="border-top:1px solid #d6cdba;"></div>' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:9pt;color:#8a8275;padding-top:20px;line-height:1.65;">' +
    'Please bring this ticket, printed or on your phone. No parking at the church, drop-off only. ' +
    'Church office 021 887 0495.</div>' +
    '</div></body></html>';
}

function ticketPdf_(b, ticketNo) {
  const blob = Utilities.newBlob(ticketHtml_(b, ticketNo), 'text/html', 'ticket.html')
    .getAs('application/pdf').setName('Song for a Century - ticket ' + ticketNo + '.pdf');
  return blob;
}

function ticketIcs_(b, ticketNo) {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stellenbosch United Church//Song for a Century//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + ticketNo + '@songforacentury',
    'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    'DTSTART:20261030T160000Z', 'DTEND:20261030T190000Z',
    'SUMMARY:Song for a Century - centenary organ concert',
    'LOCATION:Stellenbosch United Church\\, 8 Van Riebeeck Street\\, Stellenbosch Central 7600',
    'DESCRIPTION:Ticket ' + ticketNo + '. Winand Grundling at the organ\\, with Annatjie Joubert\\, ' +
      'soprano. 18:00 for 18:30. Cheese and wine to follow. ' + CONFIG.SITE_URL,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  return Utilities.newBlob(ics, 'text/calendar', 'Song for a Century.ics');
}

function mailTicket_(b, ticketNo, pdf) {
  const subject = 'Song for a Century - ticket ' + ticketNo;
  send_(b.email, subject, shell_(
    para_('Dear ' + h_(b.first) + ',') +
    para_('Your payment has reflected, thank you. This email is your ticket, and the same ticket is ' +
          'attached as a PDF to print, save to your phone or add to your files.') +
    '<div style="background:#1c1a15;color:#f5f1e7;padding:22px 24px;margin:0 0 16px;">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.2em;' +
    'text-transform:uppercase;color:#e0a172;">Ticket</div>' +
    '<div style="font-size:34px;line-height:1.1;padding-top:4px;">' + ticketNo + '</div>' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;padding-top:10px;color:#c8bfb0;">' +
    h_(b.first) + ' ' + h_(b.last) + ' &middot; ' + b.seats + (b.seats === 1 ? ' seat' : ' seats') +
    '<br>Friday 30 October 2026, 18:00 for 18:30</div>' +
    '</div>' +
    para_('The second attachment adds the evening to your calendar, on iPhone, Android or a computer. ' +
          'Doors open at 18:00, the concert begins at 18:30, cheese and wine follow in the hall.') +
    para_('We look forward to seeing you,<br>Stellenbosch United Church')),
    [pdf, ticketIcs_(b, ticketNo)]);
  labelSent_(subject, LABELS.tickets);
}

function mailAlreadyBooked_(b) {
  const subject = 'Song for a Century - you are already booked, ' + b.ref;
  send_(b.email, subject, shell_(
    para_('Dear ' + h_(b.first) + ',') +
    para_('That booking is already paid and your ticket has been sent, so there is nothing more to do. ' +
          'If you meant to book extra seats, please reply to this email and say how many.') +
    para_('With thanks,<br>Stellenbosch United Church')));
  labelSent_(subject, LABELS.bookings);
}

function mailLapsed_(b) {
  const subject = 'Song for a Century - booking ' + b.ref + ' has lapsed';
  send_(b.email, subject, shell_(
    para_('Dear ' + h_(b.first) + ',') +
    para_('No proof of payment has reached us for <b>' + h_(b.ref) + '</b>, so those seats have gone back ' +
          'into the pool and the booking has lapsed.') +
    para_('You are welcome to book again at <a href="' + CONFIG.SITE_URL + '" style="color:#9c4a26;">' +
          CONFIG.SITE_URL + '</a>. When the new booking email arrives, <b>reply to that email</b> with the ' +
          'bank\'s proof of payment attached. Only the reply carries your reference, and the reference is ' +
          'what matches the payment to your name.') +
    para_('With thanks,<br>Stellenbosch United Church')));
  labelSent_(subject, LABELS.bookings);
}

/** Tells anyone who booked and never sent a proof that they have to book again. */
function chaseUnpaid(e) {
  const how = runSlot_('chaseUnpaid', e, 4);
  return recordRun_('chaseUnpaid', how, chaseUnpaid_);
}

function chaseUnpaid_() {
  const sh = sheet_();
  const now = Date.now();
  let sent = 0;
  rows_().forEach(function (r) {
    if (String(r.pop || '').trim() || String(r.ticket || '').trim()) return;
    if (String(r.lapse || '').trim()) return;
    const t = (r.ts instanceof Date) ? r.ts.getTime() : Date.parse(r.ts);
    if (!t || (now - t) < LAPSE_MINUTES * 60 * 1000) return;
    mailLapsed_(r);
    sh.getRange(r.row, C.lapse).setValue(new Date());
    sent++;
  });
  return sent;
}

/* ------------------------------------------------------- ticket numbering */

function nextTicketNumber_(surname) {
  const name = String(surname || 'GUEST').toUpperCase().replace(/[^A-Z]/g, '') || 'GUEST';
  const taken = {};
  rows_().forEach(function (r) {
    const t = String(r.ticket || '').trim();
    const m = t.match(/(\d{3})$/);
    if (m) taken[m[1]] = true;
  });
  for (let i = 0; i < 400; i++) {
    const n = String(Math.floor(Math.random() * 900) + 100);   // 100-999, never 001
    if (!taken[n]) return name + '-' + n;
  }
  throw new Error('Could not find an unused ticket number. Tell me and I will widen the range.');
}

/* ------------------------------------------------------------ POP scanner */

/** The trigger's entry point. Records when it last ran, so statusCheck can show it is alive. */
function scanPop(e) {
  const how = runSlot_('scanPop', e, 4);
  if (how !== 'owner' && !scanDue_()) return { skipped: true };
  return recordRun_('scanPop', how, scanPop_);
}

function scanPop_() {
  const sh = sheet_();
  const all = rows_();
  // A guest can hold more than one booking, so keep every candidate and take the
  // oldest one still waiting on a proof.
  const byRef = {}, byEmail = {};
  const open = function (list) {
    if (!list || !list.length) return null;
    const waiting = list.filter(function (r) { return !String(r.pop || '').trim(); });
    return waiting.length ? waiting[0] : list[list.length - 1];
  };
  all.forEach(function (r) {
    if (r.ref) (byRef[r.ref.toUpperCase()] = byRef[r.ref.toUpperCase()] || []).push(r);
    if (r.email) (byEmail[r.email.toLowerCase()] = byEmail[r.email.toLowerCase()] || []).push(r);
  });

  let matched = 0, files = 0, unmatched = 0, ours = 0;
  const fresh = [];
  const seen = {};

  // Takes one thread and, if it belongs to a booking, records the proof.
  // strict = the thread has to name its reference; used for the broad sweep.
  // Loose matching is only allowed on the second pass, where we already know
  // whose mailbox the thread came from.
  const consider = function (t, forced) {
    const id = t.getId();
    if (seen[id]) return;
    seen[id] = true;

    const msgs = inbound_(t);
    if (!msgs.length) { ours++; return; }   // our own booking mail, nothing to read

    let hay = t.getFirstMessageSubject() + ' ';
    msgs.forEach(function (m) {
      hay += ' ' + m.getSubject() + ' ' + m.getPlainBody();
      // A proof is often a PDF named after the reference, and some banks put
      // nothing useful in the body at all.
      try {
        m.getAttachments().forEach(function (a) { hay += ' ' + a.getName(); });
      } catch (err) {}
    });
    const up = hay.toUpperCase();

    let r = forced || null;
    if (!r) {
      const hit = up.match(/SFAC-[A-Z0-9]+-[A-Z0-9]+-\d+(?:-\d+)?/);
      if (hit) r = open(byRef[hit[0]]) || open(byRef[hit[0].replace(/-\d+$/, '')]);
    }
    if (!r) {
      const froms = msgs.map(function (m) { return m.getFrom().toLowerCase(); }).join(' ');
      Object.keys(byEmail).forEach(function (e) {
        if (!r && (froms.indexOf(e) !== -1 || hay.toLowerCase().indexOf(e) !== -1)) r = open(byEmail[e]);
      });
    }
    if (!r) { unmatched++; t.addLabel(label_(LABELS.unmatched)); return; }

    t.addLabel(label_(LABELS.pop));
    if (!String(r.pop || '').trim()) {
      sh.getRange(r.row, C.pop).setValue(msgs[msgs.length - 1].getDate());
      fresh.push(r);
      matched++;
      r.pop = 'just now';   // so a second thread for the same guest does not double up
    }
    sh.getRange(r.row, C.popMail).setValue(t.getPermalink());
    const links = saveProof_(t, r.ref || r.last);
    if (links) { sh.getRange(r.row, C.popFile).setValue(links); files++; }
    // Dealt with: the ticket is out, so it can leave the inbox.
    if (String(r.sent || '').trim()) t.moveToArchive();
  };

  // Pass one: anything quoting a reference. 300, not 100 - every booking and
  // ticket email carries SFAC- too, so the cap was filling up with our own mail.
  const threads = GmailApp.search(CONFIG.POP_SEARCH, 0, 300);
  threads.forEach(function (t) { consider(t, null); });

  // Pass two: Louis Williams replied to his booking email with the PDF attached
  // and was still missed, so every booking still waiting on a proof gets its own
  // search by sender. This catches a reply whose reference never survived the
  // quoting, and anything the first cap cut off.
  rows_().forEach(function (r) {
    if (String(r.pop || '').trim() || !r.email) return;
    const q = 'from:"' + String(r.email).replace(/"/g, '') + '" newer_than:120d';
    GmailApp.search(q, 0, 20).forEach(function (t) { consider(t, r); });
  });

  if (fresh.length) alertProof_(fresh);
  return { scanned: threads.length, matched: matched, files: files,
           unmatched: unmatched, skippedOwn: ours, filed: fileInbox_() };
}

/**
 * Prints what the scanner can see for one guest. Set the address, run it from
 * the editor, read the log. Use it when a proof plainly arrived but the row
 * stayed unpaid.
 */
function whyNotMatched() {
  ownerOnly_();
  const EMAIL = 'louis.williams@example.com';   // <- put the guest's address here
  const out = ['Looking for mail from ' + EMAIL];
  const r = rows_().filter(function (x) {
    return String(x.email || '').toLowerCase() === EMAIL.toLowerCase();
  })[0];
  out.push(r ? 'Sheet row ' + r.row + ', reference ' + r.ref + ', proof: ' +
                (String(r.pop || '').trim() || 'none')
             : 'No booking on the sheet with that address.');
  GmailApp.search('from:"' + EMAIL + '" newer_than:120d', 0, 20).forEach(function (t) {
    const msgs = inbound_(t);
    let atts = 0;
    msgs.forEach(function (m) { try { atts += m.getAttachments().length; } catch (e) {} });
    out.push('- "' + t.getFirstMessageSubject() + '"  inbound msgs: ' + msgs.length +
             ', attachments: ' + atts + ', in inbox: ' + t.isInInbox());
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* -------------------------------------------------------- console backend */

function consoleUrl_() {
  return ScriptApp.getService().getUrl() + '?key=' + adminKey_();
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  // Two pages, two keys. The office link reaches only the booking form, so a
  // screen at the front desk can never show the whole ledger.
  if (String(p.desk || '') === officeKey_()) {
    const o = HtmlService.createTemplateFromFile('Office');
    o.key = officeKey_();
    return o.evaluate()
      .setTitle('Song for a Century - office bookings')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  if (String(p.key || '') !== adminKey_()) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:Georgia,serif;background:#f5f1e7;color:#1c1a15;padding:60px;text-align:center;">' +
      '<div style="font-size:26px;">Song for a Century</div>' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;padding-top:8px;color:#6b6355;">' +
      'This link needs the console key.</div></div>');
  }
  const t = HtmlService.createTemplateFromFile('Admin');
  t.key = adminKey_();
  return t.evaluate()
    .setTitle('Song for a Century - bookings')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function guard_(key) { if (key !== adminKey_()) throw new Error('Not authorised.'); }
function deskGuard_(key) { if (key !== officeKey_()) throw new Error('Not authorised.'); }

function officeUrl_() {
  return ScriptApp.getService().getUrl() + '?desk=' + officeKey_();
}

/**
 * Deletes everything created while the dry run was on: the TEST rows, the two
 * test Drive folders, and the test emails. Real bookings are never touched.
 */
function clearTestData_() {
  const sh = sheet_();
  const test = rows_().filter(function (r) { return String(r.mode || '').toUpperCase() === 'TEST'; });

  let threads = 0;
  test.forEach(function (r) {
    if (!r.ref) return;
    try {
      GmailApp.search('"' + r.ref + '"', 0, 50).forEach(function (t) { t.moveToTrash(); threads++; });
    } catch (e) {}
  });
  try {
    GmailApp.search('subject:"[TEST]" newer_than:400d', 0, 200)
      .forEach(function (t) { t.moveToTrash(); threads++; });
  } catch (e) {}

  let folders = 0;
  const root = rootFolder_();
  ['Proofs of payment (test)', 'Tickets (test)'].forEach(function (name) {
    const it = root.getFoldersByName(name);
    while (it.hasNext()) { it.next().setTrashed(true); folders++; }
  });

  test.slice().sort(function (a, b) { return b.row - a.row; })
      .forEach(function (r) { sh.deleteRow(r.row); });

  return test.length + ' test booking(s), ' + folders + ' Drive folder(s) and ' +
         threads + ' email thread(s) deleted. Ticket numbering starts at 001 again.';
}

/**
 * Wipes everything for a fresh start: every booking row, the files in the Drive
 * folders, and this concert's email threads. Ticket numbering follows the sheet, so
 * it returns to 001 by itself. Run from the editor, or from the console's Reset
 * button, which asks you to type RESET.
 */
function resetEverything() {
  ownerOnly_();
  const msg = resetEverything_();
  Logger.log(msg);
  return msg;
}

function resetEverything_() {
  const sh = sheet_();
  const all = rows_();

  let threads = 0;
  const searches = all.map(function (r) { return r.ref ? '"' + r.ref + '"' : ''; })
    .filter(function (s) { return s; })
    .concat(['subject:"Song for a Century"', '"SFAC-"', '"SONGFORACENTURY"']);
  searches.forEach(function (q) {
    try {
      GmailApp.search(q + ' newer_than:400d', 0, 100)
        .forEach(function (t) { t.moveToTrash(); threads++; });
    } catch (e) {}
  });

  let files = 0;
  const root = rootFolder_();
  ['Proofs of payment', 'Tickets', 'Proofs of payment (test)', 'Tickets (test)'].forEach(function (name) {
    const it = root.getFoldersByName(name);
    while (it.hasNext()) {
      const f = it.next().getFiles();
      while (f.hasNext()) { f.next().setTrashed(true); files++; }
    }
  });

  const n = sh.getLastRow() - 1;
  if (n > 0) sh.deleteRows(2, n);
  props_().deleteProperty('DRY_RUN');

  return 'Reset done. ' + all.length + ' booking(s) removed, ' + files + ' Drive file(s) and ' +
         threads + ' email thread(s) moved to the bin. Ticket numbering starts at 001 again.\n\n' +
         'The bin still holds them for 30 days if you need anything back.';
}

function startDryRun() { ownerOnly_(); return startDryRun_(); }
function endDryRun()   { ownerOnly_(); return endDryRun_(); }

function startDryRun_() {
  props_().setProperty('DRY_RUN', 'on');
  return 'Dry run is ON. Every booking, file and email from now is marked TEST.';
}

function endDryRun_() {
  const wiped = clearTestData_();
  props_().deleteProperty('DRY_RUN');
  return 'Dry run is OFF. ' + wiped;
}

function setDryRun(key, on) {
  guard_(key);
  const msg = on ? startDryRun_() : endDryRun_();
  const out = listBookings(key);
  out.dryMsg = msg;
  return out;
}

function clearTestData(key) {
  guard_(key);
  const msg = clearTestData_();
  const out = listBookings(key);
  out.dryMsg = msg;
  return out;
}

function listBookings(key) {
  guard_(key);
  const fmt = function (d) {
    return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM HH:mm') : (d || '');
  };
  let seatsPaid = 0, moneyIn = 0, seatsAll = 0;
  const list = rows_().map(function (r) {
    const paid = !!String(r.pop || '').trim();
    seatsAll += Number(r.seats) || 0;
    if (paid) { seatsPaid += Number(r.seats) || 0; moneyIn += Number(r.amount) || 0; }
    return {
      row: r.row, ref: r.ref, name: r.first + ' ' + r.last, email: r.email,
      wa: r.wa || '', seats: r.seats, amount: r.amount,
      pop: fmt(r.pop),
      popFiles: String(r.popFile || '').split('\n').filter(function (s) { return s.trim(); }),
      popMail: String(r.popMail || '').trim(),
      ticket: r.ticket || '', sent: fmt(r.sent),
      ticketFile: String(r.ticketFile || '').trim(), notes: r.notes || ''
    };
  }).reverse();
  return { list: list, seatsAll: seatsAll, seatsPaid: seatsPaid, moneyIn: moneyIn,
           dryRun: isDryRun_(), build: CONFIG.BUILD, health: health_() };
}

/** What the scheduled jobs are doing. Shown to the console and printed by statusCheck. */
function health_() {
  const p = props_();
  return {
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }),
    scanOk: p.getProperty('LAST_OK_scanPop') || '', scanErr: p.getProperty('LAST_ERR_scanPop') || '',
    chaseOk: p.getProperty('LAST_OK_chaseUnpaid') || '', chaseErr: p.getProperty('LAST_ERR_chaseUnpaid') || ''
  };
}

function markPaid(key, row) {
  guard_(key);
  sheet_().getRange(row, C.pop).setValue(new Date());
  return listBookings(key);
}

function unmarkPaid(key, row) {
  guard_(key);
  sheet_().getRange(row, C.pop).clearContent();
  return listBookings(key);
}

/* ------------------------------------------------- booking taken at the office */

/** Notes on every office row start with this, which is how the desk page finds them. */
const OFFICE_TAG = 'Office booking';

/** Same shape as the website's reference: SFAC-FIRST-SURNAME-SEATS. */
function officeRef_(first, last, seats) {
  const part = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, ''); };
  return 'SFAC-' + part(first) + '-' + part(last) + '-' + seats;
}

/** Pensioner seats at R250, the rest at the couple/single rate. */
function priceWith_(seats, pensioners) {
  const p = Math.min(seats, Math.max(0, pensioners || 0));
  const rest = seats - p;
  return p * 250 + Math.floor(rest / 2) * 600 + (rest % 2) * 350;
}

/**
 * Writes a booking taken at the church office. Two ways in:
 *
 *   paid = true   they have handed over the money. The row goes down already
 *                 marked paid, so the 24-hour chaser leaves it alone and no
 *                 banking details are emailed to someone who has paid. The
 *                 ticket is numbered and emailed at once; with no email address
 *                 it is still filed in Drive to print.
 *
 *   paid = false  they have booked but will transfer later. The row waits for a
 *                 proof like any website booking, and they get the ordinary
 *                 booking email with the reference and the bank details.
 *
 * An explicit amount always wins, which is how a guest who turns the pensioner
 * rate down is recorded at full price.
 */
function officeCreate_(d) {
  d = d || {};
  const first = String(d.first || '').trim();
  const last  = String(d.last  || '').trim();
  const email = String(d.email || '').trim();
  if (!first || !last) throw new Error('First name and surname are needed.');

  const paid  = !!d.paid;
  const seats = Math.max(1, parseInt(d.seats, 10) || 1);
  const pens  = Math.min(seats, Math.max(0, parseInt(d.pensioners, 10) || 0));
  const amount = parseInt(d.amount, 10) || priceWith_(seats, pens);

  let ref = officeRef_(first, last, seats);
  const already = countRef_(ref);
  if (already) ref = ref + '-' + (already + 1);

  const bits = [OFFICE_TAG + ' ' + stamp_(), paid ? 'paid at the desk' : 'to pay by EFT'];
  if (pens) bits.push(pens + ' pensioner seat(s)');
  if (String(d.how || '').trim()) bits.push(String(d.how).trim());
  if (String(d.note || '').trim()) bits.push(String(d.note).trim());

  const b = { ref: ref, first: first, last: last, email: email,
              wa: String(d.wa || '').trim(), seats: seats, amount: amount };

  const sh = sheet_();
  sh.appendRow([new Date(), ref, first, last, email, waText_(b.wa), seats, amount,
                paid ? new Date() : '', paid ? 'Office payment' : '', '', '', '', '',
                bits.join(' | '), isDryRun_() ? 'TEST' : '', '']);
  const row = sh.getLastRow();

  let ticket = '', note = '';

  if (!paid) {
    if (email) {
      try { mailGuestBooked_(b); note = 'Booking email sent with the reference and bank details.'; }
      catch (err) { note_(sh, row, 'BOOKING EMAIL FAILED - ' + err); note = 'The booking email did not go out. Tell Anika.'; }
    } else {
      note = 'No email address, so nothing could be sent. Write the reference down for them.';
    }
  } else {
    const r = rows_().filter(function (x) { return x.row === row; })[0];
    ticket = nextTicketNumber_(last);
    sh.getRange(row, C.ticket).setValue(ticket);
    const pdf = ticketPdf_(r, ticket);
    const sub = ticketsFolder_();
    const old = sub.getFilesByName(pdf.getName());
    const file = old.hasNext() ? old.next() : sub.createFile(pdf);
    sh.getRange(row, C.ticketFile).setValue(shareLink_(file));
    if (email) {
      try { mailTicket_(r, ticket, pdf); sh.getRange(row, C.sent).setValue(new Date());
            note = 'Ticket ' + ticket + ' emailed to ' + email + '.'; }
      catch (err) { note_(sh, row, 'TICKET EMAIL FAILED - ' + err);
                    note = 'Ticket ' + ticket + ' was made but the email failed. Tell Anika.'; }
    } else {
      note_(sh, row, 'No email address - ticket ' + ticket + ' is in Drive to print');
      note = 'Ticket ' + ticket + ' is saved for printing. Anika will print it.';
    }
  }

  try {
    notifyOffice_(b, OFFICE_TAG + (paid ? ' - paid at the desk' : ' - to pay by EFT'));
  } catch (err) {
    Logger.log('Office notification failed: ' + err);
  }

  return { ref: ref, ticket: ticket, amount: amount, paid: paid, note: note,
           name: first + ' ' + last, seats: seats };
}

/* ------------------------------------------------------ the office page */

function officeAdd(key, d) {
  deskGuard_(key);
  const made = officeCreate_(d);
  const out = officeList(key);
  out.made = made;
  return out;
}

/** Only the bookings taken at the office, newest first. */
function officeList(key) {
  deskGuard_(key);
  const fmt = function (v) {
    if (!v) return '';
    const dt = (v instanceof Date) ? v : new Date(v);
    return isNaN(dt.getTime()) ? String(v)
      : Utilities.formatDate(dt, Session.getScriptTimeZone(), 'd MMM HH:mm');
  };
  const mine = rows_().filter(function (r) {
    return String(r.notes || '').indexOf(OFFICE_TAG) === 0;
  });
  const list = mine.map(function (r) {
    return {
      when: fmt(r.ts), ref: r.ref, name: r.first + ' ' + r.last,
      email: r.email, seats: r.seats, amount: r.amount,
      paid: !!String(r.pop || '').trim(),
      ticket: String(r.ticket || '').trim(),
      sent: !!String(r.sent || '').trim(),
      notes: String(r.notes || '').replace(OFFICE_TAG, '').replace(/^\s*/, '')
    };
  }).reverse();
  return {
    list: list,
    seats: list.reduce(function (n, b) { return n + (parseInt(b.seats, 10) || 0); }, 0),
    money: list.filter(function (b) { return b.paid; })
               .reduce(function (n, b) { return n + (parseInt(b.amount, 10) || 0); }, 0),
    dryRun: isDryRun_(),
    bank: BANK
  };
}

/** The one-click action: confirm payment, number the ticket, file it, email it. */
function sendTicket(key, row) {
  guard_(key);
  const sh = sheet_();
  const r = rows_().filter(function (x) { return x.row === row; })[0];
  if (!r) throw new Error('Row not found.');
  if (String(r.sent || '').trim()) throw new Error('Ticket already sent to ' + r.email + '.');

  if (!String(r.pop || '').trim()) sh.getRange(row, C.pop).setValue(new Date());
  let ticket = String(r.ticket || '').trim();
  if (!ticket) {
    ticket = nextTicketNumber_(r.last);
    sh.getRange(row, C.ticket).setValue(ticket);
  }
  const pdf = ticketPdf_(r, ticket);
  const sub = ticketsFolder_();
  const old = sub.getFilesByName(pdf.getName());
  const file = old.hasNext() ? old.next() : sub.createFile(pdf);
  sh.getRange(row, C.ticketFile).setValue(shareLink_(file));
  mailTicket_(r, ticket, pdf);
  sh.getRange(row, C.sent).setValue(new Date());
  return listBookings(key);
}

function resendTicket(key, row) {
  guard_(key);
  const r = rows_().filter(function (x) { return x.row === row; })[0];
  if (!r) throw new Error('Row not found.');
  const ticket = String(r.ticket || '').trim();
  if (!ticket) throw new Error('No ticket number yet.');
  mailTicket_(r, ticket, ticketPdf_(r, ticket));
  sheet_().getRange(row, C.sent).setValue(new Date());
  return listBookings(key);
}

function resendBookingEmail(key, row) {
  guard_(key);
  const r = rows_().filter(function (x) { return x.row === row; })[0];
  if (!r) throw new Error('Row not found.');
  mailGuestBooked_(r);
  return listBookings(key);
}

function saveNote(key, row, text) {
  guard_(key);
  sheet_().getRange(row, C.notes).setValue(text);
  return listBookings(key);
}

/** The open console asks every 5 minutes; it shares the scan slot with the trigger. */
function runScan(key) {
  guard_(key);
  const res = scanDue_() ? recordRun_('scanPop', 'console', scanPop_) : null;
  const out = listBookings(key);
  if (res) out.scan = res;
  return out;
}

function runFixMobiles(key) {
  guard_(key);
  const msg = fixMobiles_();
  const out = listBookings(key);
  out.dryMsg = msg;
  return out;
}

function runReset(key, word) {
  guard_(key);
  if (String(word).trim().toUpperCase() !== 'RESET') throw new Error('Nothing was deleted.');
  const msg = resetEverything_();
  const out = listBookings(key);
  out.dryMsg = msg;
  return out;
}

function runFile(key) {
  guard_(key);
  const n = fileInbox_();
  const out = listBookings(key);
  out.filedOnly = n;
  return out;
}

/** Rewrites any Mobile cell that Sheets turned into #ERROR! back to plain text. */
function fixMobiles() { ownerOnly_(); return fixMobiles_(); }

function fixMobiles_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return 'No bookings yet.';
  const rng = sh.getRange(2, C.wa, n, 1);
  rng.setNumberFormat('@');
  const shown = rng.getDisplayValues();
  const formulas = rng.getFormulas();
  let fixed = 0;
  const out = shown.map(function (row, i) {
    const f = String(formulas[i][0] || '');
    const d = String(row[0] || '');
    if (f) { fixed++; return [f]; }              // the typed text, before Sheets parsed it
    if (d.indexOf('#ERROR') === 0) { fixed++; return ['']; }
    return [d];
  });
  rng.setValues(out);
  return fixed ? 'Repaired ' + fixed + ' mobile number(s).' : 'All mobile numbers are fine.';
}

/**
 * One-shot check that the live script, sheet, Drive and triggers are the current
 * build. Run it from the editor.
 */
function statusCheck() {
  ownerOnly_();
  const sh = sheet_();
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0].join('|');
  const all = rows_();
  const triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  const root = rootFolder_();
  const count = function (name) {
    const it = root.getFoldersByName(name);
    if (!it.hasNext()) return name + ': not created yet';
    const f = it.next(), files = f.getFiles();
    let n = 0; while (files.hasNext()) { files.next(); n++; }
    return name + ': ' + n + ' file(s)';
  };
  const lines = [
    'Build: ' + CONFIG.BUILD + ' - every page-callable function checks the key, owner or trigger; prices worked out on the server',
    'Site URL: ' + CONFIG.SITE_URL,
    'Dry run: ' + (isDryRun_() ? 'ON - bookings are TEST' : 'off'),
    'Sheet columns: ' + (head === HEADERS.join('|') ? 'current (' + HEADERS.length + ')' : 'STALE - ' + head),
    'Bookings: ' + all.length + ' rows, ' +
      all.filter(function (r) { return String(r.pop || '').trim(); }).length + ' paid, ' +
      all.filter(function (r) { return String(r.sent || '').trim(); }).length + ' ticketed, ' +
      all.filter(function (r) { return String(r.mode || '').toUpperCase() === 'TEST'; }).length + ' test',
    'Triggers: ' + (triggers.length ? triggers.join(', ') : 'none - run installTrigger'),
    'Lapse chaser: ' + (triggers.indexOf('chaseUnpaid') > -1 ? 'installed' : 'MISSING - run installTrigger'),
    'Last scan: ' + (health_().scanOk || 'none yet on this build - check again in 5 minutes') +
      (health_().scanErr ? ' | last scan error: ' + health_().scanErr : ''),
    'Keys: ' + (adminKey_() === 'centenary26' || officeKey_() === 'desk26' ? 'STILL THE OLD ONES - run rotateKeys' : 'not the old ones'),
    'Mail quota left today: ' + MailApp.getRemainingDailyQuota(),
    'Drive: ' + count('Proofs of payment') + ' | ' + count('Tickets'),
    'Drive (test): ' + count('Proofs of payment (test)') + ' | ' + count('Tickets (test)'),
    'Console: ' + consoleUrl_(),
    'Office page: ' + officeUrl_()
  ];
  const out = lines.join('\n');
  Logger.log(out);
  return out;
}

/** Run once by hand: builds labels, the Drive folders and the sheet, and tests mail. */
function selfTest() {
  ownerOnly_();
  sheet_();
  setupGmail_();
  folder_()('Proofs of payment');
  folder_()('Tickets');
  fileInbox_();
  send_(notifyTo_(), 'Song for a Century - test', shell_(
    para_('The booking script is connected. Sheet, Gmail labels and Drive folders are in place.') +
    para_('<a href="' + consoleUrl_() + '" style="color:#9c4a26;">Booking console</a>')));
  return 'Ready. Test mail sent to ' + notifyTo_();
}

/** Scans Gmail every 5 minutes and chases unpaid bookings every 5. Run this once. */
function installTrigger() {
  ownerOnly_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'scanPop' || f === 'chaseUnpaid') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanPop').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('chaseUnpaid').timeBased().everyMinutes(5).create();
  return 'Scanning every 5 minutes, chasing unpaid bookings every 5.';
}

/**
 * Replaces both keys with long random ones and prints the new links. Run it from
 * the editor whenever a link may have leaked. The old console and desk links stop
 * working at once, so send Anika and Gabi their new ones.
 */
function rotateKeys() {
  ownerOnly_();
  const fresh = function () { return Utilities.getUuid().replace(/-/g, ''); };
  props_().setProperties({ ADMIN_KEY: fresh(), OFFICE_KEY: fresh() });
  const out = 'New console link (Anika):\n' + consoleUrl_() + '\n\nNew office link (Gabi):\n' + officeUrl_();
  Logger.log(out);
  return out;
}