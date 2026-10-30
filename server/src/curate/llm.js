// LLM client for the curation pipeline.
//
// OpenAI-compatible chat/completions endpoint. Config from process.env:
//   DEEPSEEK_BASE   e.g. https://your-openai-compatible-endpoint/v1
//   DEEPSEEK_KEY    bearer token
//   DEEPSEEK_MODEL  explicitly configured model name
//
// 'deepseek-v4-flash' is a reasoning model: message.reasoning_content eats
// tokens; we only surface message.content. Empty content (quota consumed by
// reasoning) is surfaced as ok:false error:'empty-content' so callers can
// retry or degrade. No new dependencies — global fetch only.

const DEFAULT_MODEL = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL;
const DEFAULT_MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 3000];

// Merge a caller-provided AbortSignal with an internal timeout into one
// controller. Resolves the merged controller when either source aborts.
function mergeSignal(external, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('llm timeout')), timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason || new Error('caller aborted'));
    else external.addEventListener('abort', () => ctrl.abort(external.reason || new Error('caller aborted')), { once: true });
  }
  // Clear the timeout when the merged controller settles so the timer
  // does not keep the event loop alive or fire after a clean finish.
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return { ctrl, timer };
}

function isTransientError(err, status) {
  if (err && (err.name === 'AbortError' || /timeout|fetch failed|network|socket|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(err.message))) return true;
  if (status && (status >= 500 || status === 408 || status === 429)) return true;
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

// Core: one POST chat/completions call, no retry. Returns a result object,
// never throws. Transient failures are flagged so the retry wrapper can act.
async function callOnce({ system, user, model, maxTokens, extraBody, signal, timeoutMs }) {
  const base = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE;
  const key = process.env.LLM_API_KEY || process.env.DEEPSEEK_KEY;
  if (!base || !key || !model) return {ok:false,error:'missing-env',transient:false};
  const ctrl = new AbortController();
  let timer, abortListener;
  const cancelled = new Promise((_, reject) => {
    abortListener = () => { ctrl.abort(); reject(new Error('caller-aborted')); };
    if (signal?.aborted) abortListener();
    else signal?.addEventListener('abort', abortListener, {once:true});
    timer = setTimeout(() => { ctrl.abort(); reject(new Error('model-timeout')); }, timeoutMs || REQUEST_TIMEOUT_MS);
  });
  const operation = async () => {
    const body = {model, messages:[{role:'system',content:system},{role:'user',content:user}],max_tokens:maxTokens,temperature:0.2,...extraBody};
    // Flash defaults to reasoning, which shares this bounded output budget.
    // Structured extraction needs the final JSON; other providers stay generic.
    if(new URL(base).hostname==='api.deepseek.com' && ['deepseek-flash','deepseek-v4-flash'].includes(model))body.thinking={type:'disabled'};
    const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal,
    });
    let payload;
    try { payload = await res.json(); }
    catch { if(ctrl.signal.aborted)throw new Error(signal?.aborted?'caller-aborted':'model-timeout');return {ok:false,error:`non-json-response status=${res.status}`,transient:isTransientError(null,res.status)}; }
    if(!res.ok)return {ok:false,error:`http-${res.status}`,transient:isTransientError(null,res.status)};
    const content=payload?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim())return {ok:false,error:'empty-content',transient:false};
    return {ok:true,content,raw:payload,usage:payload.usage??null,transient:false};
  };
  try { return await Promise.race([operation(),cancelled]); }
  catch(e) { return {ok:false,error:ctrl.signal.aborted?(signal?.aborted?'caller-aborted':'model-timeout'):e.message,transient:!ctrl.signal.aborted}; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',abortListener); }
}

// Retry wrapper: re-attempts transient failures up to MAX_RETRIES with
// exponential backoff (1s, 3s). Non-transient failures return immediately.
async function callWithRetry(opts) {
  let last;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (opts.signal?.aborted) return {ok:false,error:"caller-aborted"};
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1], opts.signal);
    const r = await callOnce(opts);
    last = r;
    if (r.ok) return { ok: true, content: r.content, raw: r.raw, usage: r.usage, error: null };
    if (!r.transient) return { ok: false, content: null, raw: r.raw, usage: r.usage, error: r.error };
    // transient -> retry
  }
  return { ok: false, content: null, raw: last?.raw || null, usage: last?.usage || null, error: last?.error || 'exhausted-retries' };
}

// 1. Plain chat completion. Returns content string on success.
export async function chatCompletion({ system, user, model, maxTokens, signal } = {}) {
  return callWithRetry({
    system,
    user,
    model: model || DEFAULT_MODEL,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    signal,
  });
}

// Extract the first ```json ... ``` fenced block from a string.
function extractFencedJSON(s) {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

// Best-effort: trim surrounding non-JSON characters to recover a parseable
// object. Finds the first '{' and the matching last '}'.
function recoverJSON(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return null;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch (_) { return undefined; }
}

// 2. JSON chat completion. Adds response_format and parses content into an
// object. data is the parsed object on success; null with error on failure.
export async function chatJSON({ system, user, model, maxTokens, signal, timeoutMs } = {}) {
  const r = await callWithRetry({
    system,
    user,
    model: model || DEFAULT_MODEL,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    extraBody: { response_format: { type: 'json_object' } },
    signal,
    timeoutMs,
  });
  if (!r.ok) {
    return { ok: false, data: null, raw: r.raw, usage: r.usage, error: r.error };
  }
  const content = r.content;
  let parsed = tryParse(content.trim());
  if (parsed === undefined) {
    const fenced = extractFencedJSON(content);
    if (fenced) parsed = tryParse(fenced);
  }
  if (parsed === undefined) {
    const recovered = recoverJSON(content);
    if (recovered) parsed = tryParse(recovered);
  }
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
    return { ok: false, data: null, raw: { ...r.raw, _content: content }, usage: r.usage, error: 'invalid-json' };
  }
  return { ok: true, data: parsed, raw: r.raw, usage: r.usage, error: null };
}

// 3. Bounded-concurrency map. Returns an array aligned with arr, each entry
// { ok:true, result } or { ok:false, error }. Self-scheduling worker pool.
export async function mapLimit(arr, concurrency, asyncMapper) {
  const n = arr.length;
  const results = new Array(n);
  if (n === 0) return results;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, n) }, async () => {
    while (cursor < n) {
      const i = cursor++;
      try {
        const result = await asyncMapper(arr[i], i);
        results[i] = { ok: true, result };
      } catch (e) {
        results[i] = { ok: false, error: e?.message || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
