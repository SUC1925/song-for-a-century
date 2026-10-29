/**
 * Bootstrap - lets this project update its own code, from Drive.
 *
 * Paste this once, together with the appsscript.json manifest. After that,
 * whenever the code changes: Run -> pullFromDrive. It rewrites Code and Admin
 * from the files in Drive and pushes a new version of the live web app, so the
 * deployment is current without touching Manage deployments.
 *
 * Source of truth: Drive -> Song for a Century -> Script
 *   source.json    -> a list of {name, type, url} to fetch (preferred)
 *   Code.gs.txt    -> or the code pasted straight into a text file
 *   Admin.html.txt
 */

const SOURCE_PATH = ['Song for a Century', 'Script'];
const API = 'https://script.googleapis.com/v1/projects/';

function pullFromDrive() {
  ownerOnly_();
  const incoming = readSource_();
  if (!incoming.length) throw new Error('Nothing found in Drive under ' + SOURCE_PATH.join(' / '));
  const id = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();

  const current = api_('get', API + id + '/content', token);
  const merged = merge_(current.files || [], incoming);
  api_('put', API + id + '/content', token, { files: merged });

  const msg = 'Updated ' + incoming.map(function (f) { return f.name; }).join(', ');
  return msg + '. ' + republish_(id, token);
}

function sourceFolder_() {
  let folder = DriveApp.getRootFolder();
  SOURCE_PATH.forEach(function (name) {
    const it = folder.getFoldersByName(name);
    if (!it.hasNext()) throw new Error('Drive folder not found: ' + name);
    folder = it.next();
  });
  return folder;
}

/** source.json first, then any .txt files sitting in the folder. */
function readSource_() {
  const folder = sourceFolder_();
  const viaUrl = readManifest_(folder);
  if (viaUrl.length) return viaUrl;

  const out = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const n = f.getName();
    const m = n.match(/^(.+)\.(gs|html)\.txt$/i);
    if (!m) continue;
    out.push({
      name: m[1],
      type: m[2].toLowerCase() === 'html' ? 'HTML' : 'SERVER_JS',
      source: f.getBlob().getDataAsString('UTF-8')
    });
  }
  return out;
}

/** Fetches whatever source.json points at. Newest source.json wins. */
function readManifest_(folder) {
  const found = [];
  const it = folder.getFilesByName('source.json');
  while (it.hasNext()) found.push(it.next());
  if (!found.length) return [];
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });

  const list = JSON.parse(found[0].getBlob().getDataAsString('UTF-8'));
  return (list.files || list).map(function (f) {
    const res = UrlFetchApp.fetch(f.url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 300) {
      throw new Error('Could not fetch ' + f.name + ' (' + res.getResponseCode() +
        '). The links in source.json may have expired - ask for fresh ones.');
    }
    return { name: f.name, type: f.type, source: res.getContentText() };
  });
}

/** Replaces matching files, keeps everything else (manifest, this bootstrap). */
function merge_(existing, incoming) {
  const out = existing.slice();
  incoming.forEach(function (f) {
    const i = out.findIndex(function (e) { return e.name === f.name; });
    if (i >= 0) out[i] = { name: f.name, type: f.type, source: f.source };
    else out.push(f);
  });
  return out;
}

/** New version, pointed at by the existing web app deployment. */
function republish_(id, token) {
  const ver = api_('post', API + id + '/versions', token,
    { description: 'pullFromDrive ' + new Date().toISOString() });
  const list = api_('get', API + id + '/deployments', token);
  const live = (list.deployments || []).filter(function (d) {
    return d.deploymentConfig && d.deploymentConfig.versionNumber;
  })[0];
  if (!live) return 'Version ' + ver.versionNumber + ' saved. No web app deployment found yet - deploy once by hand.';
  api_('put', API + id + '/deployments/' + live.deploymentId, token, {
    deploymentConfig: {
      scriptId: id,
      versionNumber: ver.versionNumber,
      manifestFileName: 'appsscript',
      description: 'Song for a Century'
    }
  });
  return 'Live web app now on version ' + ver.versionNumber + '.';
}

function api_(method, url, token, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) {
    throw new Error(method.toUpperCase() + ' ' + code + ' as ' +
      Session.getEffectiveUser().getEmail() + ': ' + text.slice(0, 600));
  }
  return text ? JSON.parse(text) : {};
}

/** Who is running this, and does the token carry the right scopes? */
function whoAmI() {
  ownerOnly_();
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token,
    { muteHttpExceptions: true });
  return {
    effectiveUser: Session.getEffectiveUser().getEmail(),
    scriptId: ScriptApp.getScriptId(),
    tokenInfo: res.getContentText()
  };
}

/** Check the plumbing before relying on it. */
function bootstrapCheck() {
  ownerOnly_();
  const id = ScriptApp.getScriptId();
  const c = api_('get', API + id + '/content', ScriptApp.getOAuthToken());
  return 'Reached the project. Files: ' +
    (c.files || []).map(function (f) { return f.name; }).join(', ') +
    '. Drive sources: ' + readSource_().map(function (f) { return f.name; }).join(', ');
}