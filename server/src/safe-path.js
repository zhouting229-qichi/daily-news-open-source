import { join, normalize, sep } from 'node:path';

// Resolve a request URL to an absolute path inside `webDir`, or return null if
// the path escapes the web root (path-traversal guard). Pure + side-effect free
// so it can be unit-tested without spinning up the HTTP server.
//
// Steps: strip query/fragment, URL-decode (keep raw on malformed input),
// map "/" to the index, then reject anything that normalizes outside webDir.
export function resolveWebPath(webDir, rawUrl) {
  webDir = normalize(webDir);
  let pathname = rawUrl.split('?')[0].split('#')[0];
  try { pathname = decodeURIComponent(pathname); } catch { /* keep raw on malformed input */ }
  if (pathname === '/') pathname = '/index.html';

  const fullPath = normalize(join(webDir, pathname));
  if (fullPath !== webDir && !fullPath.startsWith(webDir + sep)) {
    return null; // forbidden: escapes the web root
  }
  return fullPath;
}
