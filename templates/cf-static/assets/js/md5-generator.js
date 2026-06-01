/**
 * MD5 Generator - MD5 Hash Generator
 * Uses Web Crypto API for SHA-256 (MD5 is not available via Web Crypto)
 */

async function md5(message) {
  // Web Crypto API does not support MD5 directly, using pure JS implementation
  function rotateLeft(x, n) {
    return (x << n) | (x >>> (32 - n));
  }

  function addUnsigned(x, y) {
    const lsw = (x & 0xFFFF) + (y & 0xFFFF);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xFFFF);
  }

  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return (x ^ y ^ z); }
  function I(x, y, z) { return (y ^ (x | (~z))); }

  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(string) {
    const lWordCount = ((string.length + 8 - ((string.length + 8) % 64)) / 4) + 1;
    const lWordArray = new Array(lWordCount - 1);
    let lBytePosition = 0;
    let lByteCount = 0;

    while (lByteCount < string.length) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition);
      lByteCount++;
    }

    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lWordArray.length - 1] = string.length * 8;

    return lWordArray;
  }

  function wordToHex(lValue) {
    let wordToHexValue = '',
      wordToHexValueTemp = '',
      lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      wordToHexValueTemp = '0' + lByte.toString(16);
      wordToHexValue = wordToHexValue + wordToHexValueTemp.substr(wordToHexValueTemp.length - 2, 2);
    }
    return wordToHexValue;
  }

  function utf8Encode(string) {
    string = string.replace(/\r\n/g, '\n');
    let utftext = '';
    for (let n = 0; n < string.length; n++) {
      const c = string.charCodeAt(n);
      if (c < 128) {
        utftext += String.fromCharCode(c);
      } else if ((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      } else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
    }
    return utftext;
  }

  const x = [];
  const k = [];
  const S = [];
  const a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  let sa, sb, sc, sd, ac, ad, ae, af, ag, ah, ai, aj, ak, al, am, an, ao, ap;

  for (let i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0xFFFFFFFF);
  }
  S[0] = 7; S[1] = 12; S[2] = 17; S[3] = 22; S[4] = 5; S[5] = 9;
  S[6] = 14; S[7] = 20; S[8] = 3; S[9] = 7; S[10] = 11; S[11] = 19;
  S[12] = 3; S[13] = 5; S[14] = 9; S[15] = 13; S[16] = 3; S[17] = 9;
  S[18] = 11; S[19] = 15; S[20] = 7; S[21] = 15; S[22] = 3; S[23] = 11;
  S[24] = 5; S[25] = 7; S[26] = 12; S[27] = 14; S[28] = 9; S[29] = 11;
  S[30] = 13; S[31] = 15; S[32] = 7; S[33] = 12; S[34] = 17; S[35] = 22;
  S[36] = 5; S[37] = 8; S[38] = 11; S[39] = 14; S[40] = 6; S[41] = 9;
  S[42] = 12; S[43] = 15; S[44] = 8; S[45] = 10; S[46] = 12; S[47] = 17;
  S[48] = 5; S[49] = 7; S[50] = 11; S[51] = 13; S[52] = 6; S[53] = 9;
  S[54] = 12; S[55] = 15; S[56] = 8; S[57] = 11; S[58] = 14; S[59] = 17;
  S[60] = 5; S[61] = 7; S[62] = 9; S[63] = 11;

  const msg = utf8Encode(message);
  const xArr = convertToWordArray(msg);

  sa = a; sb = b; sc = c; sd = d;

  for (let i = 0; i < xArr.length; i += 16) {
    ac = sa; ad = sb; ae = sc; af = sd;
    sa = FF(sa, sb, sc, sd, xArr[i + 0], S[0], k[0]);
    sd = FF(sd, sa, sb, sc, xArr[i + 1], S[1], k[1]);
    sc = FF(sc, sd, sa, sb, xArr[i + 2], S[2], k[2]);
    sb = FF(sb, sc, sd, sa, xArr[i + 3], S[3], k[3]);
    sa = FF(sa, sb, sc, sd, xArr[i + 4], S[4], k[4]);
    sd = FF(sd, sa, sb, sc, xArr[i + 5], S[5], k[5]);
    sc = FF(sc, sd, sa, sb, xArr[i + 6], S[6], k[6]);
    sb = FF(sb, sc, sd, sa, xArr[i + 7], S[7], k[7]);
    sa = FF(sa, sb, sc, sd, xArr[i + 8], S[8], k[8]);
    sd = FF(sd, sa, sb, sc, xArr[i + 9], S[9], k[9]);
    sc = FF(sc, sd, sa, sb, xArr[i + 10], S[10], k[10]);
    sb = FF(sb, sc, sd, sa, xArr[i + 11], S[11], k[11]);
    sa = FF(sa, sb, sc, sd, xArr[i + 12], S[12], k[12]);
    sd = FF(sd, sa, sb, sc, xArr[i + 13], S[13], k[13]);
    sc = FF(sc, sd, sa, sb, xArr[i + 14], S[14], k[14]);
    sb = FF(sb, sc, sd, sa, xArr[i + 15], S[15], k[15]);

    sa = GG(sa, sb, sc, sd, xArr[i + 1], S[16], k[16]);
    sd = GG(sd, sa, sb, sc, xArr[i + 6], S[17], k[17]);
    sc = GG(sc, sd, sa, sb, xArr[i + 11], S[18], k[18]);
    sb = GG(sb, sc, sd, sa, xArr[i + 0], S[19], k[19]);
    sa = GG(sa, sb, sc, sd, xArr[i + 5], S[20], k[20]);
    sd = GG(sd, sa, sb, sc, xArr[i + 10], S[21], k[21]);
    sc = GG(sc, sd, sa, sb, xArr[i + 15], S[22], k[22]);
    sb = GG(sb, sc, sd, sa, xArr[i + 4], S[23], k[23]);
    sa = GG(sa, sb, sc, sd, xArr[i + 9], S[24], k[24]);
    sd = GG(sd, sa, sb, sc, xArr[i + 14], S[25], k[25]);
    sc = GG(sc, sd, sa, sb, xArr[i + 3], S[26], k[26]);
    sb = GG(sb, sc, sd, sa, xArr[i + 8], S[27], k[27]);
    sa = GG(sa, sb, sc, sd, xArr[i + 13], S[28], k[28]);
    sd = GG(sd, sa, sb, sc, xArr[i + 2], S[29], k[29]);
    sc = GG(sc, sd, sa, sb, xArr[i + 7], S[30], k[30]);
    sb = GG(sb, sc, sd, sa, xArr[i + 12], S[31], k[31]);

    sa = HH(sa, sb, sc, sd, xArr[i + 5], S[32], k[32]);
    sd = HH(sd, sa, sb, sc, xArr[i + 8], S[33], k[33]);
    sc = HH(sc, sd, sa, sb, xArr[i + 11], S[34], k[34]);
    sb = HH(sb, sc, sd, sa, xArr[i + 14], S[35], k[35]);
    sa = HH(sa, sb, sc, sd, xArr[i + 1], S[36], k[36]);
    sd = HH(sd, sa, sb, sc, xArr[i + 4], S[37], k[37]);
    sc = HH(sc, sd, sa, sb, xArr[i + 7], S[38], k[38]);
    sb = HH(sb, sc, sd, sa, xArr[i + 10], S[39], k[39]);
    sa = HH(sa, sb, sc, sd, xArr[i + 13], S[40], k[40]);
    sd = HH(sd, sa, sb, sc, xArr[i + 0], S[41], k[41]);
    sc = HH(sc, sd, sa, sb, xArr[i + 3], S[42], k[42]);
    sb = HH(sb, sc, sd, sa, xArr[i + 6], S[43], k[43]);
    sa = HH(sa, sb, sc, sd, xArr[i + 9], S[44], k[44]);
    sd = HH(sd, sa, sb, sc, xArr[i + 12], S[45], k[45]);
    sc = HH(sc, sd, sa, sb, xArr[i + 15], S[46], k[46]);
    sb = HH(sb, sc, sd, sa, xArr[i + 2], S[47], k[47]);

    sa = II(sa, sb, sc, sd, xArr[i + 0], S[48], k[48]);
    sd = II(sd, sa, sb, sc, xArr[i + 7], S[49], k[49]);
    sc = II(sc, sd, sa, sb, xArr[i + 14], S[50], k[50]);
    sb = II(sb, sc, sd, sa, xArr[i + 5], S[51], k[51]);
    sa = II(sa, sb, sc, sd, xArr[i + 12], S[52], k[52]);
    sd = II(sd, sa, sb, sc, xArr[i + 3], S[53], k[53]);
    sc = II(sc, sd, sa, sb, xArr[i + 10], S[54], k[54]);
    sb = II(sb, sc, sd, sa, xArr[i + 1], S[55], k[55]);
    sa = II(sa, sb, sc, sd, xArr[i + 8], S[56], k[56]);
    sd = II(sd, sa, sb, sc, xArr[i + 15], S[57], k[57]);
    sc = II(sc, sd, sa, sb, xArr[i + 6], S[58], k[58]);
    sb = II(sb, sc, sd, sa, xArr[i + 13], S[59], k[59]);
    sa = II(sa, sb, sc, sd, xArr[i + 4], S[60], k[60]);
    sd = II(sd, sa, sb, sc, xArr[i + 11], S[61], k[61]);
    sc = II(sc, sd, sa, sb, xArr[i + 2], S[62], k[62]);
    sb = II(sb, sc, sd, sa, xArr[i + 9], S[63], k[63]);

    sa = addUnsigned(sa, ac);
    sb = addUnsigned(sb, ad);
    sc = addUnsigned(sc, ae);
    sd = addUnsigned(sd, af);
  }

  return wordToHex(sa) + wordToHex(sb) + wordToHex(sc) + wordToHex(sd);
}

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');

  try {
    if (!input) {
      throw new Error('Please enter text to hash');
    }

    const hash = md5(input);
    output.value = hash;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ Generation failed: ' + e.message;
    output.classList.add('error');
    output.classList.remove('success');
  }
}

function copyOutput() {
  const output = document.getElementById('output');
  if (output && output.value) {
    navigator.clipboard.writeText(output.value).then(() => {
      const btn = document.querySelector('.tool-actions .btn-secondary');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      }
    }).catch(() => {
      // Fallback: select text for manual copy
      output.select();
    });
  }
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
