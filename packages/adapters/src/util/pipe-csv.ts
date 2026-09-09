/**
 * Tolerant delimiter-separated parser for the Wahapedia export:
 * - UTF-8 BOM, CRLF or LF line endings
 * - a trailing delimiter on every record (header included) => the empty last column is dropped
 * - records may span physical lines (a newline inside a description). When the file uses trailing
 *   delimiters a record ends only at a newline that directly follows a delimiter *and* the record
 *   already has all header columns; otherwise lines are joined until the record has as many fields
 *   as the header.
 * - quoted fields ("..." with "" escapes) are honoured only when a field *starts* with a quote;
 *   quotes elsewhere are literal text
 */
export interface PipeCsvOptions {
  delimiter?: string;
}

export interface PipeCsvResult {
  header: string[];
  rows: Record<string, string>[];
  warnings: string[];
}

export function parsePipeCsv(text: string, opts: PipeCsvOptions = {}): PipeCsvResult {
  const delimiter = opts.delimiter ?? "|";
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const warnings: string[] = [];
  const records: string[][] = [];

  let fields: string[] = [];
  let field = "";
  let i = 0;
  let expected = -1; // header length once known
  let trailing = false; // header line ended with a delimiter => every record does
  const n = src.length;

  const endRecord = (): void => {
    fields.push(field);
    field = "";
    // Every line ends with a delimiter => last field is empty; drop exactly one trailing empty field.
    if (trailing && fields.length > 1 && fields[fields.length - 1] === "") fields.pop();
    else if (!trailing && expected < 0 && fields.length > 1 && fields[fields.length - 1] === "") fields.pop();
    if (fields.length === 1 && fields[0] === "") {
      fields = [];
      return;
    }
    records.push(fields);
    if (expected < 0) expected = fields.length;
    fields = [];
  };

  while (i < n) {
    const c = src[i] as string;
    if (field === "" && c === '"' && fieldStartsQuoted(src, i, delimiter)) {
      // quoted field
      i++;
      let out = "";
      while (i < n) {
        const q = src[i] as string;
        if (q === '"') {
          if (src[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out += q;
        i++;
      }
      field = out;
      // consume until delimiter / newline
      while (i < n && src[i] !== delimiter && src[i] !== "\n" && src[i] !== "\r") {
        field += src[i] as string;
        i++;
      }
      continue;
    }
    if (c === delimiter) {
      fields.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      const nl = c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      if (expected < 0) {
        // header line decides whether the file uses trailing delimiters
        trailing = field === "" && fields.length > 0;
        endRecord();
      } else if (fields.length === 0 && field === "") {
        // blank line between records
      } else if (trailing ? field === "" && fields.length > 0 : fields.length + (field === "" ? 0 : 1) >= expected) {
        endRecord();
      } else {
        field += "\n"; // continuation of a multi-line field
      }
      i += nl;
      continue;
    }
    field += c;
    i++;
  }
  if (fields.length > 0 || field !== "") {
    if (expected < 0) trailing = field === "" && fields.length > 0;
    endRecord();
  }

  const header = (records.shift() ?? []).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  records.forEach((rec, idx) => {
    if (rec.length !== header.length) {
      if (rec.length > header.length) {
        // merge the surplus into the last column (a delimiter inside free text)
        const head = rec.slice(0, header.length - 1);
        head.push(rec.slice(header.length - 1).join(delimiter));
        rec = head;
        warnings.push(`row ${idx + 2}: ${rec.length} fields, merged surplus into last column`);
      } else {
        warnings.push(`row ${idx + 2}: expected ${header.length} fields, got ${rec.length}`);
        while (rec.length < header.length) rec.push("");
      }
    }
    const row: Record<string, string> = {};
    header.forEach((h, k) => {
      row[h] = rec[k] ?? "";
    });
    rows.push(row);
  });
  return { header, rows, warnings };
}

function fieldStartsQuoted(src: string, start: number, delimiter: string): boolean {
  // Only treat as a quoted field when a closing quote is followed by delimiter/newline/EOF.
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '"') {
      if (src[i + 1] === '"') {
        i += 2;
        continue;
      }
      const next = src[i + 1];
      return next === undefined || next === delimiter || next === "\n" || next === "\r";
    }
    i++;
  }
  return false;
}
