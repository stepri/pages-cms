/**
 * Convert image paths into raw.githubusercontent.com URLs (with some light caching).
 */

import { reactive } from 'vue';
import github from '@/services/github';

// TTL for the cache (in milliseconds)
const ttl = 10000;

// We use the state object to coordinate data fetching (mainly to prevent fetching the same content multiple time) and cacching results.
const state = reactive({
  cache: {},
  requests: {}
});

// Get the relative URL of a file
const getRelativeUrl = (owner, repo, branch, path) => {
  let relativePath = path;
  if (path.startsWith('https://raw.githubusercontent.com/')) {
    const pattern = new RegExp(`^https://raw\\.githubusercontent\\.com/${owner}/${repo}/${branch}/`, 'i');
    relativePath = path.replace(pattern, '');
    relativePath = relativePath.split('?')[0];
  }
  
  return relativePath;
}

// Get the raw URL of a file
const getRawUrl = async (owner, repo, branch, path, isPrivate = false) => {
  if (isPrivate) {
    const filename = path.split('/').pop();
    const parentPath = path.split('/').slice(0, -1).join('/');
    const parentFullPath = `${owner}/${repo}/${branch}/${parentPath}`;
    if (!state.cache[parentFullPath]?.files?.[filename] || (Date.now() - (state.cache[parentFullPath]?.time || 0) > ttl)) {
      // If the file isn't in cache or if the cache is stale, we refresh it
      delete state.cache[parentFullPath];
      if (!state.requests[parentFullPath]) {
        // We create a request for the parent folder if it's not already being processed
        state.requests[parentFullPath] = github.getContents(owner, repo, branch, parentPath, false);
      }
      const files = await state.requests[parentFullPath];
      if (!state.cache[parentFullPath] && files) {
        // If the cache isn't updated yet AND we have files back from our request, we update the cache
        state.cache[parentFullPath] = { time: Date.now(), files: {} };
        files.forEach(file => {
          state.cache[parentFullPath].files[file.name] = file.download_url;
        });
      }
      delete state.requests[parentFullPath];
    }
    
    return state.cache[parentFullPath]?.files?.[filename];
  } else {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(path)}`;
  }
};

// Converts relative URLs to raw.githubusercontent.com URLs in an HTML string (for display)
const relativeToRawUrls = async (owner, repo, branch, html, isPrivate = false) => {
  let newHtml = html;
  const matches = getImgSrcs(newHtml);
  for (const match of matches) {
    const src = match[1] || match[2];
    const quote = match[1] ? '"' : "'";
    if (!src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:image/')) {  
      const rawUrl = await getRawUrl(owner, repo, branch, decodeURI(src), isPrivate);
      if (rawUrl) {
        newHtml = newHtml.replace(`src=${quote}${src}${quote}`, `src=${quote}${rawUrl}${quote}`);
      }
    }
  }
  
  return newHtml;
}

// Converts raw.githubusercontent.com URLs to relative URLs in an HTML string (for storage)
const rawToRelativeUrls = (owner, repo, branch, html) => {
  const matches = getImgSrcs(html);
  for (const match of matches) {
    const src = match[1] || match[2];
    const quote = match[1] ? '"' : "'";
    if (src.startsWith('https://raw.githubusercontent.com/')) {
      let relativePath = src.replace(new RegExp(`https://raw\\.githubusercontent\\.com/${owner}/${repo}/${branch}/`, 'gi'), '');
      relativePath = relativePath.split('?')[0];
      // TODO: check if I need to encodeURI or decodeURI one of them
      // TODO: check if I need to ignore case in other places
      html = html.replace(`src=${quote}${src}${quote}`, `src=${quote}${relativePath}${quote}`);
    }
  }

  return html;
}

// Swaps path prefixes (used for input/output path conversion).
const swapPrefix = (path, from, to, relative = false) => {
  if (path == null || from == null || to == null) return path;
  let newPath;
  if (from === to) {
    newPath = path;
  } else if (path.startsWith(from) && !(from == '/' && path.startsWith('//')) && !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('data:image/')) {
    if (from === '' && to !== '/' && !path.startsWith('/')) {
      newPath = `${to}/${path}`;
    } else {
      newPath = path.replace(from, to);
    }
  } else {
    // TODO: we return the original path if we don't know what to do with it (e.g. path is outside of media path). Need to check this doesn't have unintended consequences.
    return path;
  }
  if (newPath && newPath.startsWith('/') && relative) newPath = newPath.substring(1);

  return newPath;
}

// Swaps path prefixes (used for input/output path conversion) in an HTML string.
const htmlSwapPrefix = (html, from, to, relative = false) => {
  if (from === to) return html;
  let newHtml = html;
  if (html != null && from != null && to != null) {
    const matches = getImgSrcs(newHtml);
    matches.forEach(match => {
      const src = match[1] || match[2];
      const quote = match[1] ? '"' : "'";
      let newSrc;
      if (from === to) {
        newSrc = src;
      } else if (src.startsWith(from) && !(from == '/' && src.startsWith('//')) && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:image/')) {
        if (from === '' && to !== '/' && !src.startsWith('/')) {
          newSrc = `${to}/${src}`;
        } else {
          newSrc = src.replace(from, to);
        }
        if (newSrc && newSrc.startsWith('/') && relative) newSrc = newSrc.substring(1);
        newHtml = newHtml.replace(`src=${quote}${src}${quote}`, `src=${quote}${newSrc}${quote}`);
      }
    });
  }

  return newHtml;
}

// Get all img srcs from an HTML string
const getImgSrcs = (html) => {
  const regex = /<img [^>]*src=(?:"([^"]+)"|'([^']+)')[^>]*>/g;
  return [...html.matchAll(regex)];
}

export default { state, getRelativeUrl, getRawUrl, relativeToRawUrls, rawToRelativeUrls, swapPrefix, htmlSwapPrefix };