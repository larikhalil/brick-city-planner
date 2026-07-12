// Pure compress/encode ⇄ decode/decompress for the '#d=' share-link payload. No DOM — fully
// unit-testable. Uses CompressionStream('gzip') when available (payload tagged 'g'); falls back
// to a plain base64url encode of the raw JSON bytes when it isn't (tagged '0'), so the format
// always round-trips even on browsers/environments without the Streams compression API.
// Both encodeCity/decodeCity are async (even the fallback path) so callers never have to branch
// on which one ran.

// ---- base64url (no padding, URL/fragment-safe) --------------------------------
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad); // throws on malformed input — callers catch
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Pump `bytes` through a Compression/DecompressionStream and collect the output. The write/close
// promise is awaited alongside the read loop (not fired-and-forgotten) so a malformed-input
// failure rejects cleanly through this function's own try/catch instead of surfacing later as an
// unhandled promise rejection.
async function pump(transformStream, bytes) {
  const writer = transformStream.writable.getWriter();
  const writeDone = writer.write(bytes).then(() => writer.close());
  const reader = transformStream.readable.getReader();
  const out = [];
  const readLoop = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
  })();
  await Promise.all([writeDone, readLoop]);
  const total = out.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of out) { merged.set(c, off); off += c.length; }
  return merged;
}
async function gzip(bytes) { return pump(new CompressionStream('gzip'), bytes); }
async function gunzip(bytes) { return pump(new DecompressionStream('gzip'), bytes); }

const hasGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// Encode a plain city object into a URL-fragment-safe string. `opts.gzip` forces the codec:
// pass `false` to force the uncompressed fallback (used by the test suite to exercise that path
// deterministically regardless of whether the runtime has CompressionStream); omitted, it uses
// gzip whenever the runtime supports it.
export async function encodeCity(obj, opts = {}) {
  const useGzip = opts.gzip !== false && hasGzip();
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  if (useGzip) {
    try {
      return 'g' + bytesToB64url(await gzip(bytes));
    } catch { /* fall through to the uncompressed path below */ }
  }
  return '0' + bytesToB64url(bytes);
}

// Decode a string produced by encodeCity back into a plain object, or null on any failure
// (malformed base64, corrupt gzip, invalid JSON, unrecognised tag, empty/non-string input).
export async function decodeCity(str) {
  if (typeof str !== 'string' || str.length < 2) return null;
  const tag = str[0];
  if (tag !== 'g' && tag !== '0') return null;
  let bytes;
  try { bytes = b64urlToBytes(str.slice(1)); } catch { return null; }
  try {
    if (tag === 'g') {
      if (!hasGzip()) return null; // can't inflate here — caller should tell the user
      bytes = await gunzip(bytes);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
