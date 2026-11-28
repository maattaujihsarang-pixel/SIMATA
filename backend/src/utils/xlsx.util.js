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

function readPngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function isTextIdHeader(headerText) {
  return /\b(nis|nisn|nik|nip|nuptk|id|kode|telepon|telp|hp|no\.?\s*hp)\b/i.test(String(headerText || ''));
}

function parseAutoCellValue(rawVal, colSpec, headerText) {
  const typePref = (colSpec && colSpec.type) || 'auto';
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return { kind: 'text', value: '' };
  }
  if (typePref === 'text') {
    return { kind: 'text', value: String(rawVal) };
  }
  if (typePref === 'int' || typePref === 'decimal' || typePref === 'decimal2') {
    if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      return { kind: typePref, value: rawVal };
    }
    const cleaned = String(rawVal).trim().replace(',', '.');
    const n = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(n)) {
      return { kind: typePref, value: n };
    }
    return { kind: 'text', value: String(rawVal) };
  }

  // auto mode: preserve long codes / leading zeros / explicit ID columns as text
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
    return { kind: Number.isInteger(rawVal) ? 'int' : 'decimal', value: rawVal };
  }
  const str = String(rawVal).trim();
  if (isTextIdHeader(headerText)) {
    return { kind: 'text', value: str };
  }
  if (/^0\d+/.test(str) && !/^0\./.test(str)) {
    return { kind: 'text', value: str };
  }
  if (/^\d{10,}$/.test(str)) {
    return { kind: 'text', value: str };
  }
  if (/^-?\d+$/.test(str)) {
    const n = Number(str);
    if (Number.isSafeInteger(n)) return { kind: 'int', value: n };
  }
  if (/^-?\d+[.,]\d{1,4}$/.test(str)) {
    const n = Number(str.replace(',', '.'));
    if (Number.isFinite(n)) return { kind: 'decimal', value: n };
  }
  return { kind: 'text', value: String(rawVal) };
}

/**
 * Generate a styled, print-ready OpenXML .xlsx workbook matching SIMATA's official Kop Surat,
 * structured table formatting, optional summary average row, TTD Kepala Madrasah + QR PNG, and footer.
 */
function buildFormattedReportXlsxBuffer(opts = {}) {
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const colSpecs = Array.isArray(opts.columns) ? opts.columns : [];
  const printCfg = (opts.printSettings && typeof opts.printSettings === 'object') ? opts.printSettings : {};

  const colCount = Math.max(headers.length, 6);
  const lastColLetter = colIndexToLetter(colCount - 1);
  const safeSheetName = String(opts.sheetName || 'Laporan SIMATA')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Laporan SIMATA';

  const orientation = opts.orientation === 'portrait' ? 'portrait' : 'landscape';
  const paperCode = String(opts.paperSize || printCfg.default_paper_size || 'A4').toUpperCase() === 'F4' ? '14' : '9';

  const kopFound = String(printCfg.foundation_name || 'YAYASAN MUWAJJIHUL ULUM ASY-SYARIYYAH').trim();
  const kopSchool = String(printCfg.school_name || 'MADRASAH ALIYAH AT-TAUJIH SARANG').trim();
  const kopAddr = String(printCfg.school_address || 'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)').trim();
  const kopContact = String(printCfg.school_contact || 'NSM: 131233170020 \u2022 NPSN: 70033117 \u2022 Email: maattaujihsarang@gmail.com').trim();

  const logoDims = readPngDimensions(opts.logoPngBuffer);
  const qrDims = readPngDimensions(opts.qrPngBuffer);
  const hasLogo = Boolean(logoDims && printCfg.show_logo !== false);
  const hasQr = Boolean(qrDims);
  const hasImages = hasLogo || hasQr;

  // Compute column widths from header & cell content length
  const colWidths = [];
  for (let c = 0; c < colCount; c++) {
    const spec = colSpecs[c] || {};
    if (Number.isFinite(Number(spec.width)) && Number(spec.width) > 0) {
      colWidths.push(Math.min(44, Math.max(5, Number(spec.width))));
      continue;
    }
    const hText = headers[c] !== undefined ? String(headers[c]) : '';
    let maxLen = hText.length;
    if (opts.summaryRow && Array.isArray(opts.summaryRow.values)) {
      const sumColSpan = Number(opts.summaryRow.colspan) || 1;
      if (c >= sumColSpan) {
        const sv = opts.summaryRow.values[c - sumColSpan];
        if (sv !== undefined && sv !== null) maxLen = Math.max(maxLen, String(sv).length);
      }
    }
    for (let r = 0; r < rows.length; r++) {
      const val = rows[r] && rows[r][c] !== undefined && rows[r][c] !== null ? String(rows[r][c]) : '';
      if (val.length > maxLen) maxLen = val.length;
    }
    colWidths.push(Math.min(38, Math.max(headers[c] !== undefined ? 7 : 10, maxLen + 4)));
  }

  // Ensure right signature columns collectively span enough width (~30 chars) for principal name
  const sigSpanCols = Math.min(3, Math.max(2, Math.floor(colCount / 3)));
  const sigStartIdx = colCount - sigSpanCols;
  const sigCombinedW = colWidths.slice(sigStartIdx).reduce((a, b) => a + b, 0);
  if (sigCombinedW < 30) {
    colWidths[colCount - 1] += Math.ceil(30 - sigCombinedW);
  }

  const colsXml = colWidths.map((w, idx) =>
    `<col min="${idx + 1}" max="${idx + 1}" width="${w.toFixed(1)}" customWidth="1"/>`
  ).join('');

  // Build style table dynamically: static base styles (0..9) + data matrix (10..33) + summary (34..37) + sig/footer (38..41)
  const dataTypes = ['text', 'int', 'decimal', 'decimal2'];
  const dataAligns = ['left', 'center', 'right'];
  const numFmtByType = { text: 49, int: 3, decimal: 164, decimal2: 2 };
  const dataStyleLookup = {};
  const dataXfs = [];
  let nextStyleId = 10;

  for (const zebra of [0, 1]) {
    const fillId = zebra ? 3 : 0;
    for (const tp of dataTypes) {
      const nf = numFmtByType[tp];
      for (const al of dataAligns) {
        dataStyleLookup[`${zebra}|${tp}|${al}`] = nextStyleId++;
        dataXfs.push(
          `<xf numFmtId="${nf}" fontId="0" fillId="${fillId}" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${al}" vertical="center" wrapText="1"/></xf>`
        );
      }
    }
  }

  const S = {
    DEFAULT: 0,
    KOP_FOUND: 1,
    KOP_SCHOOL: 2,
    KOP_ADDR: 3,
    KOP_CONTACT: 4,
    TITLE: 5,
    SUBTITLE: 6,
    META_LEFT: 7,
    META_RIGHT: 8,
    TH: 9,
    SUM_LABEL: nextStyleId++,
    SUM_DEC: nextStyleId++,
    SUM_INT: nextStyleId++,
    SUM_TEXT: nextStyleId++,
    SIG_TEXT: nextStyleId++,
    SIG_NAME: nextStyleId++,
    FOOTER_LEFT: nextStyleId++,
    FOOTER_RIGHT: nextStyleId++
  };

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="49" formatCode="@"/>
    <numFmt numFmtId="164" formatCode="#,##0.##"/>
  </numFmts>
  <fonts count="11">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9.5"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><sz val="8.5"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="8.5"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="11.5"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9.5"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="9.5"/><color rgb="FF065F46"/><name val="Calibri"/></font>
    <font><b/><u/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><i/><sz val="8"/><color rgb="FF64748B"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="double"><color rgb="FF0F172A"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF0F172A"/></left><right style="thin"><color rgb="FF0F172A"/></right><top style="thin"><color rgb="FF0F172A"/></top><bottom style="thin"><color rgb="FF0F172A"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="thin"><color rgb="FF94A3B8"/></top><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="medium"><color rgb="FF166534"/></top><bottom style="medium"><color rgb="FF166534"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="${nextStyleId}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="49" fontId="7" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    ${dataXfs.join('\n    ')}
    <xf numFmtId="49" fontId="8" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="2" fontId="8" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="3" fontId="8" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="8" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

  // Worksheet row & merge builders
  const rowXmlList = [];
  const merges = [];
  let rNum = 1;

  const textCell = (cIdx, rIdx, val, styleId) => {
    const ref = `${colIndexToLetter(cIdx)}${rIdx}`;
    return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>`;
  };
  const numCell = (cIdx, rIdx, num, styleId) => {
    const ref = `${colIndexToLetter(cIdx)}${rIdx}`;
    return `<c r="${ref}" s="${styleId}"><v>${num}</v></c>`;
  };
  const emptyCell = (cIdx, rIdx, styleId) => {
    const ref = `${colIndexToLetter(cIdx)}${rIdx}`;
    return `<c r="${ref}" s="${styleId}"/>`;
  };
  const pushMergedRow = (text, styleId, heightPt, fillFullRowStyle) => {
    const cells = [textCell(0, rNum, text, styleId)];
    if (fillFullRowStyle) {
      for (let c = 1; c < colCount; c++) {
        cells.push(emptyCell(c, rNum, styleId));
      }
    }
    rowXmlList.push(`<row r="${rNum}" ht="${heightPt}" customHeight="1">${cells.join('')}</row>`);
    merges.push(`A${rNum}:${lastColLetter}${rNum}`);
    rNum++;
  };

  // Official 4-line MA At-Taujih Kop Surat (total ~69pt height to accommodate 68px logo cleanly)
  pushMergedRow(kopFound, S.KOP_FOUND, 16, false);
  pushMergedRow(kopSchool, S.KOP_SCHOOL, 22, false);
  pushMergedRow(kopAddr, S.KOP_ADDR, 15, false);
  pushMergedRow(kopContact, S.KOP_CONTACT, 16, true);

  // Spacer
  rowXmlList.push(`<row r="${rNum}" ht="6" customHeight="1"/>`);
  rNum++;

  // Title & Subtitle
  if (opts.title) {
    pushMergedRow(String(opts.title).toUpperCase(), S.TITLE, 20, false);
  }
  if (opts.subtitle) {
    pushMergedRow(String(opts.subtitle), S.SUBTITLE, 16, false);
  }

  // Optional Meta rows (e.g. Kelas | Wali Kelas)
  if (Array.isArray(opts.metaRows) && opts.metaRows.length > 0) {
    const splitIdx = Math.max(1, Math.floor(colCount / 2));
    const rightStart = splitIdx;
    for (const pair of opts.metaRows) {
      const leftTxt = Array.isArray(pair) ? String(pair[0] || '') : String(pair || '');
      const rightTxt = Array.isArray(pair) ? String(pair[1] || '') : '';
      const cells = [];
      if (leftTxt) {
        cells.push(textCell(0, rNum, leftTxt, S.META_LEFT));
        if (splitIdx > 1) merges.push(`A${rNum}:${colIndexToLetter(splitIdx - 1)}${rNum}`);
      }
      if (rightTxt) {
        cells.push(textCell(rightStart, rNum, rightTxt, S.META_RIGHT));
        if (rightStart < colCount - 1) merges.push(`${colIndexToLetter(rightStart)}${rNum}:${lastColLetter}${rNum}`);
      }
      if (cells.length > 0) {
        rowXmlList.push(`<row r="${rNum}" ht="17" customHeight="1">${cells.join('')}</row>`);
        rNum++;
      }
    }
  }

  // Small gap before table
  rowXmlList.push(`<row r="${rNum}" ht="6" customHeight="1"/>`);
  rNum++;

  // Table header
  const thCells = [];
  for (let c = 0; c < headers.length; c++) {
    thCells.push(textCell(c, rNum, headers[c], S.TH));
  }
  rowXmlList.push(`<row r="${rNum}" ht="26" customHeight="1">${thCells.join('')}</row>`);
  rNum++;

  // Table data rows
  for (let r = 0; r < rows.length; r++) {
    const rowArr = Array.isArray(rows[r]) ? rows[r] : [];
    const zebra = r % 2 === 1 ? 1 : 0;
    const cells = [];
    for (let c = 0; c < headers.length; c++) {
      const spec = colSpecs[c] || {};
      const parsed = parseAutoCellValue(rowArr[c], spec, headers[c]);
      const defaultAlign = parsed.kind === 'text' ? 'left' : 'center';
      const align = (spec.align === 'left' || spec.align === 'center' || spec.align === 'right') ? spec.align : defaultAlign;
      const sId = dataStyleLookup[`${zebra}|${parsed.kind}|${align}`] || dataStyleLookup[`${zebra}|text|left`];
      if (parsed.kind === 'text') {
        cells.push(textCell(c, rNum, parsed.value, sId));
      } else {
        cells.push(numCell(c, rNum, parsed.value, sId));
      }
    }
    rowXmlList.push(`<row r="${rNum}" ht="20" customHeight="1">${cells.join('')}</row>`);
    rNum++;
  }

  // Optional Summary Row (e.g. Leger NILAI RATA-RATA SATU KELAS / MAPEL)
  if (opts.summaryRow && typeof opts.summaryRow === 'object') {
    const span = Math.min(headers.length, Math.max(1, Number(opts.summaryRow.colspan) || 1));
    const vals = Array.isArray(opts.summaryRow.values) ? opts.summaryRow.values : [];
    const cells = [textCell(0, rNum, String(opts.summaryRow.label || ''), S.SUM_LABEL)];
    for (let c = 1; c < span; c++) {
      cells.push(emptyCell(c, rNum, S.SUM_LABEL));
    }
    if (span > 1) {
      merges.push(`A${rNum}:${colIndexToLetter(span - 1)}${rNum}`);
    }
    for (let c = span; c < headers.length; c++) {
      const v = vals[c - span];
      const spec = colSpecs[c] || {};
      const parsed = parseAutoCellValue(v, spec.type ? spec : { type: 'decimal2' }, headers[c]);
      if (parsed.kind === 'text') {
        cells.push(textCell(c, rNum, parsed.value, S.SUM_TEXT));
      } else if (parsed.kind === 'int') {
        cells.push(numCell(c, rNum, parsed.value, S.SUM_INT));
      } else {
        cells.push(numCell(c, rNum, parsed.value, S.SUM_DEC));
      }
    }
    rowXmlList.push(`<row r="${rNum}" ht="21" customHeight="1">${cells.join('')}</row>`);
    rNum++;
  }

  // Signatures block (optional Left Signer + Right Kepala Madrasah + embedded QR TTE PNG)
  let qrAnchorRowZeroBased = -1;
  if (opts.includePrincipalSig !== false || opts.leftSigner) {
    rNum += 1; // 1 blank row below table
    const leftSpan = Math.min(3, Math.max(2, sigStartIdx));
    const leftEndLetter = colIndexToLetter(leftSpan - 1);
    const sigStartLetter = colIndexToLetter(sigStartIdx);

    const city = String(printCfg.sign_city || 'Sarang').trim();
    let dateIndo = '';
    try {
      dateIndo = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      dateIndo = new Date().toISOString().slice(0, 10);
    }

    const rTop = rNum;
    const topCells = [];
    if (opts.leftSigner && opts.leftSigner.top) {
      topCells.push(textCell(0, rTop, opts.leftSigner.top, S.SIG_TEXT));
      if (leftSpan > 1) merges.push(`A${rTop}:${leftEndLetter}${rTop}`);
    }
    if (opts.includePrincipalSig !== false) {
      topCells.push(textCell(sigStartIdx, rTop, `${city}, ${dateIndo}`, S.SIG_TEXT));
      if (sigSpanCols > 1) merges.push(`${sigStartLetter}${rTop}:${lastColLetter}${rTop}`);
    }
    if (topCells.length > 0) {
      rowXmlList.push(`<row r="${rTop}" ht="16" customHeight="1">${topCells.join('')}</row>`);
    }

    const rRole = rTop + 1;
    const roleCells = [];
    if (opts.leftSigner && opts.leftSigner.role) {
      roleCells.push(textCell(0, rRole, opts.leftSigner.role, S.SIG_TEXT));
      if (leftSpan > 1) merges.push(`A${rRole}:${leftEndLetter}${rRole}`);
    }
    if (opts.includePrincipalSig !== false) {
      roleCells.push(textCell(sigStartIdx, rRole, String(printCfg.principal_title || 'Kepala Madrasah'), S.SIG_TEXT));
      if (sigSpanCols > 1) merges.push(`${sigStartLetter}${rRole}:${lastColLetter}${rRole}`);
    }
    if (roleCells.length > 0) {
      rowXmlList.push(`<row r="${rRole}" ht="16" customHeight="1">${roleCells.join('')}</row>`);
    }

    // 4 blank signature rows (~76pt) holding QR TTE graphic or manual space
    qrAnchorRowZeroBased = rRole; // 0-based index of the first blank row after rRole (since rRole is 1-based)
    for (let k = 1; k <= 4; k++) {
      rowXmlList.push(`<row r="${rRole + k}" ht="19" customHeight="1"/>`);
    }

    const rName = rRole + 5;
    const nameCells = [];
    if (opts.leftSigner && opts.leftSigner.name) {
      nameCells.push(textCell(0, rName, opts.leftSigner.name, S.SIG_NAME));
      if (leftSpan > 1) merges.push(`A${rName}:${leftEndLetter}${rName}`);
    }
    if (opts.includePrincipalSig !== false) {
      nameCells.push(textCell(sigStartIdx, rName, String(printCfg.principal_name || 'Moch. Iqnaul Badril Falah, S.Ag'), S.SIG_NAME));
      if (sigSpanCols > 1) merges.push(`${sigStartLetter}${rName}:${lastColLetter}${rName}`);
    }
    if (nameCells.length > 0) {
      rowXmlList.push(`<row r="${rName}" ht="17" customHeight="1">${nameCells.join('')}</row>`);
    }

    rNum = rName + 1;
    if (opts.includePrincipalSig !== false && printCfg.principal_nip) {
      rowXmlList.push(
        `<row r="${rNum}" ht="15" customHeight="1">${textCell(sigStartIdx, rNum, String(printCfg.principal_nip), S.SIG_TEXT)}</row>`
      );
      if (sigSpanCols > 1) merges.push(`${sigStartLetter}${rNum}:${lastColLetter}${rNum}`);
      rNum++;
    }
  }

  // Official Footer Row
  const footerLeft = String(opts.footerNote !== undefined ? opts.footerNote : (printCfg.footer_note || '')).trim();
  let footerRight = '';
  if (printCfg.show_print_timestamp !== false) {
    try { footerRight = 'Dicetak: ' + new Date().toLocaleString('id-ID'); } catch (_) {}
  }
  if (footerLeft || footerRight) {
    rNum++;
    const splitIdx = Math.max(1, Math.floor(colCount / 2));
    const footCells = [];
    if (footerLeft) {
      footCells.push(textCell(0, rNum, footerLeft, S.FOOTER_LEFT));
      if (splitIdx > 1) merges.push(`A${rNum}:${colIndexToLetter(splitIdx - 1)}${rNum}`);
    }
    if (footerRight) {
      footCells.push(textCell(splitIdx, rNum, footerRight, S.FOOTER_RIGHT));
      if (splitIdx < colCount - 1) merges.push(`${colIndexToLetter(splitIdx)}${rNum}:${lastColLetter}${rNum}`);
    }
    rowXmlList.push(`<row r="${rNum}" ht="15" customHeight="1">${footCells.join('')}</row>`);
    rNum++;
  }

  const lastRowNum = Math.max(1, rNum - 1);
  const mergeXml = merges.length > 0
    ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const drawingRefXml = hasImages ? '<drawing r:id="rId1"/>' : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastColLetter}${lastRowNum}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowXmlList.join('')}</sheetData>
  ${mergeXml}
  <pageMargins left="0.35" right="0.35" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
  <pageSetup paperSize="${paperCode}" orientation="${orientation}" fitToWidth="1" fitToHeight="0"/>
  ${drawingRefXml}
</worksheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${hasImages ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${hasImages ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}
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

  const zipEntries = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml }
  ];

  if (hasImages) {
    const anchors = [];
    const drawingRels = [];
    let picId = 1;

    if (hasLogo) {
      const rId = `rId${picId}`;
      const cx = 647700; // 68px
      const cy = Math.round(cx * (logoDims.height / logoDims.width));
      zipEntries.push({ name: `xl/media/image${picId}.png`, data: opts.logoPngBuffer });
      drawingRels.push(
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${picId}.png"/>`
      );
      anchors.push(
        `<xdr:oneCellAnchor>` +
          `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>114300</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${cx}" cy="${cy}"/>` +
          `<xdr:pic>` +
            `<xdr:nvPicPr><xdr:cNvPr id="${picId}" name="Logo Madrasah"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
            `<xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
            `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          `</xdr:pic>` +
          `<xdr:clientData/>` +
        `</xdr:oneCellAnchor>`
      );
      picId++;
    }

    if (hasQr && qrAnchorRowZeroBased >= 0) {
      const rId = `rId${picId}`;
      const qrH = 857250; // 90px tall fits cleanly inside 4 * 19pt (~101px) signature space
      const qrW = Math.round(qrH * (qrDims.width / qrDims.height));
      const anchorCol = Math.min(colCount - 1, sigStartIdx + Math.floor(sigSpanCols / 2));
      zipEntries.push({ name: `xl/media/image${picId}.png`, data: opts.qrPngBuffer });
      drawingRels.push(
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${picId}.png"/>`
      );
      anchors.push(
        `<xdr:oneCellAnchor>` +
          `<xdr:from><xdr:col>${anchorCol}</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${qrAnchorRowZeroBased}</xdr:row><xdr:rowOff>76200</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${qrW}" cy="${qrH}"/>` +
          `<xdr:pic>` +
            `<xdr:nvPicPr><xdr:cNvPr id="${picId}" name="TTD QR Kepala Madrasah"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
            `<xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
            `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${qrW}" cy="${qrH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          `</xdr:pic>` +
          `<xdr:clientData/>` +
        `</xdr:oneCellAnchor>`
      );
    }

    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/spreadsheetml/2006/drawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${anchors.join('\n  ')}
</xdr:wsDr>`;

    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${drawingRels.join('\n  ')}
</Relationships>`;

    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

    zipEntries.push(
      { name: 'xl/drawings/drawing1.xml', data: drawingXml },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: drawingRelsXml },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: sheetRelsXml }
    );
  }

  return createZipBuffer(zipEntries);
}

module.exports = {
  buildXlsxBuffer,
  buildFormattedReportXlsxBuffer,
  extractZipEntries,
  parseXlsxOrCsvBuffer,
  normalizeHeaderKey
};
