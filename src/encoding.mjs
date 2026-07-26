const CHARSET_RE = /charset\s*=\s*["']?([^;"'\s]+)/iu;
const REPLACEMENT_RE = /\uFFFD/gu;
const MOJIBAKE_RE = /(?:鐢佃|鍔ㄧ|璧勬|鐩磋|閫熸|鏂版|鐖辨|鏆撮|榄魔|绾红|璞豪|浼犵|瀹佃|棰戦|鍏朵|涓浗|鍙版咕|娆х編)/gu;

function normalizeCharset(value) {
  const charset = String(value || '').trim().toLowerCase();
  if (charset === 'gb2312' || charset === 'gbk' || charset === 'x-gbk') return 'gbk';
  if (charset === 'gb18030') return 'gb18030';
  if (charset === 'utf8' || charset === 'utf-8') return 'utf-8';
  if (charset === 'utf-16le' || charset === 'utf-16') return 'utf-16le';
  if (charset === 'utf-16be') return 'utf-16be';
  return '';
}

function decoderFor(label, fatal = false) {
  try {
    return new TextDecoder(label, { fatal });
  } catch {
    return null;
  }
}

function decodeWith(bytes, label, fatal = false) {
  const decoder = decoderFor(label, fatal);
  if (!decoder) return null;
  try {
    const text = decoder.decode(bytes);
    return {
      text,
      encoding: label,
      replacementCount: (text.match(REPLACEMENT_RE) || []).length,
    };
  } catch {
    return null;
  }
}

function declaredCharset(contentType) {
  return normalizeCharset(String(contentType || '').match(CHARSET_RE)?.[1] || '');
}

export function decodeSourceBytes(input, contentType = '') {
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input || []);
  const declared = declaredCharset(contentType);
  const candidates = [...new Set([
    declared,
    'utf-8',
    'gb18030',
    'gbk',
    'utf-16le',
  ].filter(Boolean))];

  for (const encoding of candidates) {
    const strict = decodeWith(bytes, encoding, true);
    if (strict) {
      return {
        ...strict,
        declaredCharset: declared || null,
        confidence: encoding === declared ? 'declared' : encoding === 'utf-8' ? 'utf8-strict' : 'fallback-strict',
      };
    }
  }

  const relaxed = candidates
    .map((encoding) => decodeWith(bytes, encoding, false))
    .filter(Boolean)
    .sort((a, b) => a.replacementCount - b.replacementCount)[0];

  if (relaxed) {
    return {
      ...relaxed,
      declaredCharset: declared || null,
      confidence: relaxed.replacementCount === 0 ? 'fallback' : 'lossy-fallback',
    };
  }

  return {
    text: new TextDecoder().decode(bytes),
    encoding: 'utf-8',
    replacementCount: 0,
    declaredCharset: declared || null,
    confidence: 'platform-default',
  };
}

export function encodingEvidence(value) {
  const text = String(value?.text || '');
  const replacementCount = Number(value?.replacementCount ?? (text.match(REPLACEMENT_RE) || []).length);
  const mojibakeCount = Number(value?.mojibakeCount ?? (text.match(MOJIBAKE_RE) || []).length);
  return {
    encoding: String(value?.encoding || 'unknown'),
    declaredCharset: value?.declaredCharset || null,
    confidence: String(value?.confidence || 'unknown'),
    replacementCount,
    mojibakeCount,
    clean: replacementCount === 0 && mojibakeCount === 0 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text),
  };
}
