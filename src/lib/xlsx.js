// A minimal .xlsx writer: styled cells, merges, column widths, doughnut and line charts. Pure JS, no
// imports, so it runs in the shell and in tests. An .xlsx is a zip of XML parts; this stores them
// uncompressed (valid zip, just bigger; a month of entries is a few tens of KB).
//
// workbook(sheets) -> Uint8Array. A sheet is
//   {name, cols: [width...], heights: {row: points}, cells: [[ref, value, style?]...], merges: ['A1:F1'],
//    charts: [{type: 'doughnut'|'line', title, from: 'H2', to: 'O18', cats: {ref, values},
//              series: [{name, ref, values, color, dash?}], colors?: [hex...] (doughnut slices),
//              axisFormat?: number format of the value axis}]}
// value: string or number (null skips the cell). style: {bold, italic, size, color, fill, fmt, align,
// valign, wrap, indent, border: 'top'|'bottom', borderColor}. Colors are 'RRGGBB'.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
    main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    pkg: 'http://schemas.openxmlformats.org/package/2006/relationships',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
};
const CT = 'application/vnd.openxmlformats-officedocument.';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

// 'AB12' -> [27, 12] (0-based column, 1-based row)
export function parseRef(ref) {
    const [, letters, row] = ref.match(/^([A-Z]+)(\d+)$/);
    return [[...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, Number(row)];
}
export function colName(c) {
    let s = '';
    for (c += 1; c > 0; c = Math.floor((c - 1) / 26))
        s = String.fromCharCode(65 + (c - 1) % 26) + s;
    return s;
}

// --- styles: each distinct style object becomes one cellXfs entry ---
class Styles {
    constructor() {
        this.fonts = ['<font><sz val="11"/><color rgb="FF1F2328"/><name val="Calibri"/><family val="2"/></font>'];
        this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
        this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
        this.fmts = [];
        this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
        this.ids = new Map();
    }

    static add(list, xml) {
        const i = list.indexOf(xml);
        return i >= 0 ? i : list.push(xml) - 1;
    }

    id(s) {
        if (!s)
            return 0;
        const key = JSON.stringify(s);
        if (this.ids.has(key))
            return this.ids.get(key);
        const font = Styles.add(this.fonts, `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 11}"/>` +
            `<color rgb="FF${s.color ?? '1F2328'}"/><name val="Calibri"/><family val="2"/></font>`);
        const fill = s.fill ? Styles.add(this.fills,
            `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
        const side = `<${s.border} style="thin"><color rgb="FF${s.borderColor ?? 'D0D7DE'}"/></${s.border}>`;
        const border = s.border ? Styles.add(this.borders,
            `<border><left/><right/>${s.border === 'top' ? side : '<top/>'}${s.border === 'bottom' ? side : '<bottom/>'}<diagonal/></border>`) : 0;
        const fmt = s.fmt ? 164 + Styles.add(this.fmts, s.fmt) : 0;
        const align = s.align || s.valign || s.wrap || s.indent
            ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''} vertical="${s.valign ?? 'center'}"${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>` : '';
        const id = this.xfs.push(`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" ` +
            `applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">${align}</xf>`) - 1;
        this.ids.set(key, id);
        return id;
    }

    xml() {
        const list = (tag, items) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
        return `${XML}<styleSheet xmlns="${NS.main}">` +
            (this.fmts.length ? list('numFmts', this.fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`)) : '') +
            list('fonts', this.fonts) + list('fills', this.fills) + list('borders', this.borders) +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            list('cellXfs', this.xfs) +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    }
}

function sheetXml(sheet, styles, first) {
    const rows = new Map();
    for (const [ref, v, s] of sheet.cells) {
        if (v === null || v === undefined)
            continue;
        const [c, r] = parseRef(ref);
        const st = styles.id(s);
        const cell = typeof v === 'number'
            ? `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`
            : `<c r="${ref}"${st ? ` s="${st}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        if (!rows.has(r))
            rows.set(r, []);
        rows.get(r).push([c, cell]);
    }
    for (const r of Object.keys(sheet.heights ?? {}).map(Number))
        if (!rows.has(r))
            rows.set(r, []);
    const data = [...rows].sort((a, b) => a[0] - b[0]).map(([r, cells]) => {
        const h = sheet.heights?.[r];
        return `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells.sort((a, b) => a[0] - b[0]).map(x => x[1]).join('')}</row>`;
    }).join('');
    const cols = (sheet.cols ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `${XML}<worksheet xmlns="${NS.main}" xmlns:r="${NS.r}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
        `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${first ? ' tabSelected="1"' : ''}/></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="16"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${merges}` +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' + // A4, one page wide
        `${sheet.charts?.length ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

// --- charts ---
const solid = hex => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const text = (size, color, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="${bold ? 1 : 0}">` +
    `${solid(color)}<a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
const strRef = (ref, values) => `<c:strRef><c:f>${esc(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
    `${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (ref, values) => `<c:numRef><c:f>${esc(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode>` +
    `<c:ptCount val="${values.length}"/>${values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}` +
    '</c:numCache></c:numRef>';
const axisLine = '<c:spPr><a:ln w="9525">' + solid('D0D7DE') + '</a:ln></c:spPr>';

function chartXml(ch) {
    const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>` +
        `<a:r><a:rPr lang="en-US" sz="1200" b="1">${solid('1F2328')}<a:latin typeface="Calibri"/></a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx>` +
        '<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>';
    const ser = (s, i, inner) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${inner}</c:ser>`;
    let plot;
    if (ch.type === 'doughnut') {
        const s = ch.series[0];
        const points = ch.cats.values.map((_v, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid(ch.colors[i % ch.colors.length])}` +
            `<a:ln w="19050">${solid('FFFFFF')}</a:ln></c:spPr></c:dPt>`).join('');
        // Slices under 5% get no label: they'd overlap their neighbours (the legend still names them).
        const total = s.values.reduce((n, v) => n + (v ?? 0), 0);
        const hidden = s.values.map((v, i) => ((v ?? 0) < 0.05 * total ? `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>` : '')).join('');
        const labels = `<c:dLbls>${hidden}<c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${text(9, 'FFFFFF', true)}` +
            '<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/>' +
            '<c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>';
        plot = `<c:doughnutChart><c:varyColors val="1"/>${ser(s, 0, `${points}${labels}<c:cat>${strRef(ch.cats.ref, ch.cats.values)}</c:cat>` +
            `<c:val>${numRef(s.ref, s.values)}</c:val>`)}<c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>`;
    } else {
        const series = ch.series.map((s, i) => ser(s, i, `<c:spPr><a:ln w="${s.dash ? 19050 : 28575}" cap="rnd">${solid(s.color)}` +
            `${s.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>` +
            `<c:cat>${strRef(ch.cats.ref, ch.cats.values)}</c:cat><c:val>${numRef(s.ref, s.values)}</c:val><c:smooth val="0"/>`)).join('');
        plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>` +
            '<c:axId val="1001"/><c:axId val="1002"/></c:lineChart>' +
            `<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
            `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
            `${axisLine}${text(9, '57606A')}<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>` +
            '<c:lblOffset val="100"/><c:tickLblSkip val="5"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
            `<c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>` +
            `<c:majorGridlines><c:spPr><a:ln w="9525">${solid('EAEEF2')}</a:ln></c:spPr></c:majorGridlines>` +
            `<c:numFmt formatCode="${esc(ch.axisFormat ?? 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
            `<c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text(9, '57606A')}<c:crossAx val="1001"/>` +
            '<c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>';
    }
    return `${XML}<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/>` +
        `<c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>` +
        `<c:legend><c:legendPos val="${ch.type === 'doughnut' ? 'r' : 'b'}"/><c:overlay val="0"/>${text(9, '1F2328')}</c:legend>` +
        '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
        `<c:spPr>${solid('FFFFFF')}<a:ln w="9525">${solid('D0D7DE')}</a:ln></c:spPr></c:chartSpace>`;
}

function drawingXml(charts) {
    const anchor = (ch, i) => {
        const [[c1, r1], [c2, r2]] = [parseRef(ch.from), parseRef(ch.to)];
        const at = (c, r) => `<xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
        return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${at(c1, r1)}</xdr:from><xdr:to>${at(c2, r2)}</xdr:to>` +
            `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(ch.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
            '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
            `<c:chart r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    };
    return `${XML}<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:c="${NS.c}">${charts.map(anchor).join('')}</xdr:wsDr>`;
}

const rels = list => `${XML}<Relationships xmlns="${NS.pkg}">` +
    `${list.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}${type}" Target="${target}"/>`).join('')}</Relationships>`;

export function workbook(sheets) {
    const styles = new Styles();
    const files = [], types = [];
    let chartNo = 0;
    sheets.forEach((sheet, i) => {
        const n = i + 1;
        files.push([`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, styles, i === 0)]);
        types.push([`/xl/worksheets/sheet${n}.xml`, 'spreadsheetml.worksheet+xml']);
        if (!sheet.charts?.length)
            return;
        files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, rels([['drawing', `../drawings/drawing${n}.xml`]])]);
        files.push([`xl/drawings/drawing${n}.xml`, drawingXml(sheet.charts)]);
        types.push([`/xl/drawings/drawing${n}.xml`, 'drawing+xml']);
        const chartRels = sheet.charts.map(ch => {
            chartNo++;
            files.push([`xl/charts/chart${chartNo}.xml`, chartXml(ch)]);
            types.push([`/xl/charts/chart${chartNo}.xml`, 'drawingml.chart+xml']);
            return ['chart', `../charts/chart${chartNo}.xml`];
        });
        files.push([`xl/drawings/_rels/drawing${n}.xml.rels`, rels(chartRels)]);
    });
    files.push(['xl/workbook.xml', `${XML}<workbook xmlns="${NS.main}" xmlns:r="${NS.r}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        `${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
    files.push(['xl/_rels/workbook.xml.rels', rels([...sheets.map((_s, i) => ['worksheet', `worksheets/sheet${i + 1}.xml`]), ['styles', 'styles.xml']])]);
    files.push(['xl/styles.xml', styles.xml()]); // after the sheets, which register their styles
    types.push(['/xl/workbook.xml', 'spreadsheetml.sheet.main+xml'], ['/xl/styles.xml', 'spreadsheetml.styles+xml']);
    files.push(['_rels/.rels', `${XML}<Relationships xmlns="${NS.pkg}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
    files.unshift(['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        `${types.map(([part, t]) => `<Override PartName="${part}" ContentType="${CT}${t}"/>`).join('')}</Types>`]);
    return zip(files);
}

// --- zip (stored, no compression) ---
const CRC = Array.from({length: 256}, (_v, n) => {
    for (let k = 0; k < 8; k++)
        n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes)
        c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const header = (size, fields) => {
        const b = new DataView(new ArrayBuffer(size));
        fields.forEach(([at, v, bytes]) => (bytes === 4 ? b.setUint32(at, v, true) : b.setUint16(at, v, true)));
        return new Uint8Array(b.buffer);
    };
    for (const [name, content] of files) {
        const nameBytes = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data);
        // version 20, flags 0x0800 (UTF-8 names), method 0 (stored), date 1980-01-01
        const common = [[0, 20, 2], [2, 0x0800, 2], [4, 0, 2], [6, 0, 2], [8, 0x21, 2], [10, crc, 4], [14, data.length, 4], [18, data.length, 4], [22, nameBytes.length, 2]];
        const local = header(30, [[0, 0x04034b50, 4], ...common.map(([at, v, n]) => [at + 4, v, n]), [28, 0, 2]]);
        parts.push(local, nameBytes, data);
        central.push(header(46, [[0, 0x02014b50, 4], [4, 20, 2], ...common.map(([at, v, n]) => [at + 6, v, n]), [30, 0, 2], [32, 0, 2],
            [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]), nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }
    const dirSize = central.reduce((n, p) => n + p.length, 0);
    const end = header(22, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, dirSize, 4], [16, offset, 4], [20, 0, 2]]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
