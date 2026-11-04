// The feedback board: public ideas anyone can add and vote on (no sign-in), and private problem reports that only
// admins see. Switched on with FEEDBACK_BOARD=1 on the copy that hosts it; every other copy links there instead.
//   feedback/ideas/<id>   { id, title, details, voters: [hashed voter ids], status: '' | 'planned' | 'done', hidden }
//   feedback/bugs/<id>    { id, text, contact, page, agent, createdAt, done }
//   feedback/rate/<hash>  posts and votes this hour, per visitor, to keep spam down
import { getJSON, setJSON, remove, listKeys } from './store.mjs';
import { randomId } from './crypto.mjs';
import { cfg } from './config.mjs';
import { json, readBody } from './http.mjs';

const now = () => new Date().toISOString();
const ID = /^[A-Za-z0-9_-]{6,20}$/;
const enabled = () => cfg().feedbackBoard;

async function hash(s) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`calendfree:${s}`));
  return Buffer.from(digest).toString('hex').slice(0, 24);
}

const visitor = (req) => (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();

// Up to `limit` actions of a kind per visitor per hour.
async function allowed(req, kind, limit) {
  const key = `feedback/rate/${await hash(visitor(req))}`;
  const hour = Math.floor(Date.now() / 3_600_000);
  const r = (await getJSON(key)) || {};
  if (r.hour !== hour) Object.assign(r, { hour, posts: 0, votes: 0 });
  if ((r[kind] || 0) >= limit) return false;
  r[kind] = (r[kind] || 0) + 1;
  await setJSON(key, r);
  return true;
}

const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (s, max) => String(s || '').trim().slice(0, max);
const fail = (message) => json({ error: 'invalid', message }, 400);
const tooMany = () => fail("That's a lot in a short time. Please try again in an hour.");

async function all(prefix) {
  const keys = await listKeys(prefix);
  return (await Promise.all(keys.map((k) => getJSON(k)))).filter(Boolean);
}

const publicIdea = (i) => ({ id: i.id, title: i.title, details: i.details, votes: (i.voters || []).length, status: i.status || '', createdAt: i.createdAt });
const byVotes = (a, b) => b.votes - a.votes || String(b.createdAt).localeCompare(String(a.createdAt));

export async function publicFeedback(req, path) {
  if (path === '/api/public/feedback' && req.method === 'GET') {
    if (!enabled()) return json({ enabled: false });
    const ideas = (await all('feedback/ideas/')).filter((i) => !i.hidden).map(publicIdea).sort(byVotes);
    return json({ enabled: true, ideas });
  }
  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (!enabled()) return fail("This copy of Calendfree doesn't collect feedback.");
  const b = await readBody(req);
  if (b.website) return json({ ok: true }); // hidden spam trap: only bots fill it in

  if (path === '/api/public/feedback/idea') {
    const title = oneLine(b.title, 120);
    if (title.length < 4) return fail('Please describe your idea in a few words.');
    if (!(await allowed(req, 'posts', 6))) return tooMany();
    const idea = { id: randomId(8), title, details: text(b.details, 2000), voters: b.voter ? [await hash(b.voter)] : [], status: '', createdAt: now() };
    await setJSON(`feedback/ideas/${idea.id}`, idea);
    return json({ ok: true, idea: publicIdea(idea) });
  }

  if (path === '/api/public/feedback/vote') {
    if (!ID.test(String(b.id || '')) || !b.voter) return fail('Something went wrong. Please refresh and try again.');
    const idea = await getJSON(`feedback/ideas/${b.id}`);
    if (!idea || idea.hidden) return fail('That idea has gone.');
    if (!(await allowed(req, 'votes', 60))) return tooMany();
    const voter = await hash(b.voter);
    idea.voters = idea.voters || [];
    const i = idea.voters.indexOf(voter);
    if (i >= 0) idea.voters.splice(i, 1); // clicking again takes the vote back
    else idea.voters.push(voter);
    await setJSON(`feedback/ideas/${idea.id}`, idea);
    return json({ ok: true, votes: idea.voters.length, voted: i < 0 });
  }

  if (path === '/api/public/feedback/bug') {
    const report = text(b.text, 4000);
    if (report.length < 10) return fail('Please say a little more about what happened.');
    if (!(await allowed(req, 'posts', 6))) return tooMany();
    await setJSON(`feedback/bugs/${randomId(8)}`, {
      text: report,
      contact: oneLine(b.contact, 200),
      page: oneLine(b.page, 300),
      agent: oneLine(req.headers.get('user-agent'), 200),
      createdAt: now(),
      done: false,
    });
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

// For admins: everything, including hidden ideas and private problem reports, plus tidying up.
export async function adminFeedback(req, url) {
  if (!enabled()) return json({ enabled: false });
  if (req.method === 'GET') {
    const ideas = (await all('feedback/ideas/')).map((i) => ({ ...publicIdea(i), hidden: Boolean(i.hidden) })).sort(byVotes);
    const bugKeys = await listKeys('feedback/bugs/');
    const bugs = (await Promise.all(bugKeys.map(async (k) => ({ id: k.split('/').pop(), ...(await getJSON(k)) }))))
      .sort((a, b) => Number(a.done) - Number(b.done) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return json({ enabled: true, ideas, bugs });
  }
  const kind = url.searchParams.get('kind');
  const id = String(url.searchParams.get('id') || '');
  if (!['idea', 'bug'].includes(kind) || !ID.test(id)) return fail('Not found.');
  const key = `feedback/${kind === 'idea' ? 'ideas' : 'bugs'}/${id}`;
  if (req.method === 'DELETE') {
    await remove(key);
    return json({ ok: true });
  }
  if (req.method === 'PUT') {
    const item = await getJSON(key);
    if (!item) return fail('Not found.');
    const b = await readBody(req);
    if (kind === 'idea') {
      if ('status' in b) item.status = ['planned', 'done'].includes(b.status) ? b.status : '';
      if ('hidden' in b) item.hidden = Boolean(b.hidden);
    } else if ('done' in b) item.done = Boolean(b.done);
    await setJSON(key, item);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}
