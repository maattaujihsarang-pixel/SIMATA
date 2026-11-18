const zlib = require('zlib');

// Precompute IEEE 802.3 CRC32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function colIndexToLetter(idx) {
  let n = idx + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function colLetterToIndex(letters) {
  let idx = 0;
  const upper = String(letters || '').toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    idx = idx * 26 + (upper.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

/**
 * Pack named buffers into a valid ZIP archive using Deflate (method 8).
 */
function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(rawBuf);
    const compressedBuf = zlib.deflateRawSync(rawBuf);

    // Local File Header (30 bytes)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4);         // version needed (2.0)
    lfh.writeUInt16LE(0x0800, 6);     // UTF-8 filename flag
    lfh.writeUInt16LE(8, 8);          // method: deflate
    lfh.writeUInt16LE(0, 10);         // mod time
    lfh.writeUInt16LE(0x5421, 12);    // mod date
    lfh.writeUInt32LE(checksum, 14);
    lfh.writeUInt32LE(compressedBuf.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);         // extra len

    localParts.push(lfh, nameBuf, compressedBuf);

    // Central Directory Header (46 bytes)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature
    cdh.writeUInt16LE(20, 4);         // version made by
    cdh.writeUInt16LE(20, 6);         // version needed
    cdh.writeUInt16LE(0x0800, 8);     // UTF-8 filename flag
    cdh.writeUInt16LE(8, 10);         // method: deflate
    cdh.writeUInt16LE(0, 12);         // mod time
    cdh.writeUInt16LE(0x5421, 14);    // mod date
    cdh.writeUInt32LE(checksum, 16);
    cdh.writeUInt32LE(compressedBuf.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);         // extra len
    cdh.writeUInt16LE(0, 32);         // comment len
    cdh.writeUInt16LE(0, 34);         // disk start
    cdh.writeUInt16LE(0, 36);         // internal attrs
    cdh.writeUInt32LE(0, 38);         // external attrs
    cdh.writeUInt32LE(offset, 42);    // relative offset of local header

    centralParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + compressedBuf.length;
  }

  const centralDirSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/**
 * Extract named files from a ZIP buffer using Central Directory offsets (supports bit-3 data descriptors).
 */
function extractZipEntries(zipBuf) {
  if (!Buffer.isBuffer(zipBuf) || zipBuf.length < 22) {
    throw new Error('File ZIP/XLSX tidak valid atau terlalu pendek.');
  }

  // Find End of Central Directory (0x06054b50) searching backwards
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Struktur End-of-Central-Directory XLSX tidak ditemukan.');
  }

  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  if (cdOffset >= zipBuf.length) {
    throw new Error('Offset Central Directory XLSX tidak valid.');
  }

  const files = {};
  let cursor = cdOffset;
  for (let i = 0; i < entryCount && cursor + 46 <= zipBuf.length; i++) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) break;

    const method = zipBuf.readUInt16LE(cursor + 10);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localOffset = zipBuf.readUInt32LE(cursor + 42);

    const fileName = zipBuf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (fileName.endsWith('/') || localOffset + 30 > zipBuf.length) continue;
    if (zipBuf.readUInt32LE(localOffset) !== 0x04034b50) continue;

    const lNameLen = zipBuf.readUInt16LE(localOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuf.length) continue;

    const payload = zipBuf.slice(dataStart, dataEnd);
    if (method === 0) {
      files[fileName] = payload;
    } else if (method === 8) {
      files[fileName] = zlib.inflateRawSync(payload);
    }
  }

  return files;
}

/**
 * Generate an OpenXML .xlsx Buffer with inline string cells (preserves NIS/NISN leading zeros).
 */
function buildXlsxBuffer(headers, rows, sheetName = 'Data KTS') {
  const safeSheetName = String(sheetName || 'Data KTS').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Data KTS';
  const defaultWidths = [18, 22, 16, 30, 14, 24, 22, 38, 26];

  const colsXml = headers.map((_, idx) => {
    const width = defaultWidths[idx] || 20;
    return `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  const allRows = [headers, ...(Array.isArray(rows) ? rows : [])];
  const rowsXml = allRows.map((rowArr, rIdx) => {
    const excelRow = rIdx + 1;
    const styleIdx = rIdx === 0 ? 1 : 2;
    const cellsXml = headers.map((_, cIdx) => {
      const ref = `${colIndexToLetter(cIdx)}${excelRow}`;
      const rawVal = rowArr[cIdx];
      const strVal = rawVal === null || rawVal === undefined ? '' : String(rawVal);
      return `<c r="${ref}" t="inlineStr" s="${styleIdx}"><is><t xml:space="preserve">${escapeXml(strVal)}</t></is></c>`;
    }).join('');
    return `<row r="${excelRow}">${cellsXml}</row>`;
  }).join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="49" formatCode="@"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;

  return createZipBuffer([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml }
  ]);
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const items = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xmlText)) !== null) {
    // Strip phonetic runs so only visible cell text remains
    const inner = match[1].replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, '');
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    let combined = '';
    while ((tMatch = tRegex.exec(inner)) !== null) {
      combined += decodeXmlEntities(tMatch[1]);
    }
    items.push(combined);
  }
  return items;
}

function parseSheetXmlMatrix(sheetXml, sharedStrings) {
  const matrix = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowBody = rowMatch[1];
    const rowArr = [];
    let autoColIdx = 0;

    // Match either self-closing <c .../> or full <c ...>...</c>
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
      const attrs = cellMatch[1] || '';
      const cellBody = cellMatch[2] || '';

      const refMatch = attrs.match(/\br=["']([A-Za-z]+)\d+["']/);
      const colIdx = refMatch ? colLetterToIndex(refMatch[1]) : autoColIdx;
      autoColIdx = colIdx + 1;

      const typeMatch = attrs.match(/\bt=["']([^"']+)["']/);
      const cellType = typeMatch ? typeMatch[1] : 'n';

      let val = '';
      if (cellType === 'inlineStr') {
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tMatch;
        while ((tMatch = tRegex.exec(cellBody)) !== null) {
          val += decodeXmlEntities(tMatch[1]);
        }
      } else {
        const vMatch = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        if (cellType === 's') {
          const sIdx = parseInt(raw, 10);
          val = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : '';
        } else {
          val = raw;
        }
      }

      rowArr[colIdx] = val;
    }

    if (rowArr.some(v => v !== undefined && String(v).trim() !== '')) {
      matrix.push(rowArr.map(v => (v === undefined ? '' : String(v))));
    }
  }

  return matrix;
}

function parseCsvMatrix(text) {
  let clean = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/).find(l => l.trim().length > 0) || '';
  let delimiter = ',';
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (tabCount > commaCount && tabCount >= semiCount) delimiter = '\t';
  else if (semiCount > commaCount) delimiter = ';';

  const matrix = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(v => String(v).trim() !== '')) {
        matrix.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(v => String(v).trim() !== '')) {
    matrix.push(row);
  }
  return matrix;
}

function normalizeHeaderKey(rawHeader) {
  return String(rawHeader || '')
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse .xlsx or .csv/.tsv buffer into { headers, rawHeaders, rows }.
 */
function parseXlsxOrCsvBuffer(buffer, filename = '') {
  if (!buffer || buffer.length === 0) {
    throw new Error('Berkas kosong atau tidak ditemukan.');
  }

  let matrix = [];
  const isZip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;

  if (isZip) {
    const entries = extractZipEntries(buffer);
    const entryNames = Object.keys(entries);
    const sharedKey = entryNames.find(n => n.toLowerCase() === 'xl/sharedstrings.xml');
    const sheetKey =
      entryNames.find(n => n.toLowerCase() === 'xl/worksheets/sheet1.xml') ||
      entryNames.find(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));

    if (!sheetKey) {
      throw new Error('Worksheet sheet1.xml tidak ditemukan di dalam file XLSX.');
    }

    const sharedStrings = sharedKey ? parseSharedStrings(entries[sharedKey].toString('utf8')) : [];
    const sheetXml = entries[sheetKey].toString('utf8');
    matrix = parseSheetXmlMatrix(sheetXml, sharedStrings);
  } else {
    matrix = parseCsvMatrix(buffer.toString('utf8'));
  }

  if (!matrix.length) {
    return { headers: [], rawHeaders: [], rows: [] };
  }

  const rawHeaders = matrix[0].map(h => String(h || '').trim());
  const headers = rawHeaders.map(normalizeHeaderKey);
  const rows = [];

  for (let r = 1; r < matrix.length; r++) {
    const rawRow = matrix[r];
    if (!rawRow.some(v => v !== undefined && String(v).trim() !== '')) continue;

    const obj = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      const val = rawRow[c] !== undefined ? String(rawRow[c]).trim() : '';
      const normKey = headers[c];
      if (normKey) obj[normKey] = val;
      if (rawHeaders[c]) obj[rawHeaders[c]] = val;
    }
    rows.push(obj);
  }

  return { headers, rawHeaders, rows };
}

module.exports = {
  buildXlsxBuffer,
  parseXlsxOrCsvBuffer,
  normalizeHeaderKey
};
