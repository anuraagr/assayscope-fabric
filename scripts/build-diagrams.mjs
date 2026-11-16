import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'docs', 'diagrams');
const tones = {
  blue: { stroke: '#1864ab', fill: '#e7f2fc' },
  teal: { stroke: '#0c8599', fill: '#e6f6f7' },
  amber: { stroke: '#b46b08', fill: '#fff5df' },
  gray: { stroke: '#495057', fill: '#f1f4f6' },
};
const node = (id, x, y, width, height, title, lines, tone = 'blue') => (
  { id, x, y, width, height, title, lines, tone }
);
const diagrams = [
  {
    name: 'knowledge-context', width: 1320, height: 800,
    title: 'Research ontology and lab-context boundaries',
    description: 'Deployed knowledge items use the curated Lakehouse. The external LIMS / ELN connection remains unconfigured.',
    sections: [],
    nodes: [
      node('evidence-tables', 30, 170, 370, 170, 'Existing analytical evidence',
        ['Five source tables; seven curated tables', 'Validated run and condition summaries', 'Source hashes and explicit data origin'], 'teal'),
      node('ontology-proposal', 475, 170, 370, 170, 'Fabric IQ ontology',
        ['Seven entities and six relationships', 'Generation-2 TMDL source bindings', 'No inferred biology or access grants'], 'amber'),
      node('external-system', 920, 170, 370, 170, 'External LIMS / ELN',
        ['Sample, batch and protocol records', 'System-of-record IDs and versions', 'No authorized endpoint supplied'], 'gray'),
      node('human-review', 30, 460, 370, 170, 'Human research review',
        ['Inspect images and cited records', 'Record rationale in the workbench', 'No automatic repeat-task creation'], 'teal'),
      node('agent-proposal', 475, 460, 370, 170, 'Read-only data agent',
        ['Scoped questions with evidence citations', 'No private reviews or arbitrary URLs', 'Source access enforced independently'], 'amber'),
      node('context-bridge', 920, 460, 370, 170, 'Reviewed context boundary',
        ['Schema, exact joins, version and freshness', 'Four example-only records in Lakehouse', 'Unmatched records stay visibly missing']),
    ],
    edges: [
      [[400, 255], [475, 255]], [[1105, 340], [1105, 460]],
      [[920, 545], [885, 545], [885, 255], [845, 255]],
      [[215, 340], [215, 390], [660, 390], [660, 460]], [[475, 545], [400, 545]],
    ],
    notes: [
      'Ontology and data agent share curated tables. The agent queries the Lakehouse, not a separately configured ontology tool.',
      'LIMS/ELN remains the sample-context system of record. Ontology relationships and agent instructions never grant data access.',
    ],
  },
  {
    name: 'architecture', width: 1320, height: 900,
    title: 'AssayScope deployment architecture',
    description: 'Two explicit runtime paths. Shared scientific contracts; different authentication and persistence.',
    sections: [
      { id: 'local', x: 24, y: 120, width: 388, height: 640, title: 'Local | no cloud dependency' },
      { id: 'fabric', x: 440, y: 120, width: 856, height: 640, title: 'Fabric | existing tenant capacity' },
    ],
    nodes: [
      node('local-ui', 52, 185, 332, 120, 'Microscopy workbench',
        ['React, vtk.js, OpenSeadragon', 'Bounded, verified image frames']),
      node('local-api', 52, 365, 332, 120, 'Local adapter',
        ['FastAPI on loopback', 'No enterprise sign-in simulation']),
      node('local-store', 52, 545, 332, 160, 'Files and SQLite',
        ['OME images and derived measurements', 'Instance-local reviews', 'Public references stay independent'], 'gray'),
      node('cloud-ui', 472, 185, 330, 120, 'Protected app UI',
        ['Fabric portal / Entra SSO', 'Run-and-interact app permission']),
      node('functions', 884, 185, 380, 120, 'Rayfin Functions',
        ['Registered frames and fixed SQL queries', 'Caller authorization; app-identity reads']),
      node('reviews', 472, 385, 330, 160, 'Transactional review SQL',
        ['Caller-scoped, append-only revisions', 'Human decisions and rationale', 'Not the image analytics store'], 'gray'),
      node('lakehouse', 884, 385, 380, 160, 'OneLake Lakehouse',
        ['Files: OME-TIFF, NGFF, derivatives', 'Delta: five analytical tables', 'SQL endpoint: read-only analysis'], 'teal'),
      node('exports', 472, 615, 330, 120, 'Research evidence',
        ['HTML, CSV, images and provenance', 'Authorized state-only deep links'], 'teal'),
      node('notebook', 884, 615, 380, 120, 'Read-only research notebook',
        ['Control dispersion and QC sensitivity', 'Separate Lakehouse access required'], 'amber'),
    ],
    edges: [
      [[218, 305], [218, 365]], [[218, 485], [218, 545]],
      [[802, 245], [884, 245]],
      [[1074, 305], [1074, 345], [637, 345], [637, 385]],
      [[1200, 305], [1200, 385]],
      [[1074, 615], [1074, 545]],
      [[802, 275], [838, 275], [838, 590], [637, 590], [637, 615]],
    ],
    notes: [
      'Local FastAPI is not a locally managed Rayfin backend. Missing cloud authorization never falls back to fixtures.',
      'Notebook execution uses existing capacity. No model service, extra capacity, public host or schedule is required.',
    ],
  },
  {
    name: 'research-workflow', width: 1320, height: 780,
    title: 'A research review from comparison to evidence',
    description: 'Use image-derived observations to decide what needs inspection, repetition or confirmatory research.',
    sections: [],
    nodes: [
      node('question', 30, 150, 380, 170, '1. Define the comparison',
        ['Study overview: controls and design', 'Run, dose and technical-well identity', 'Keep public studies separate']),
      node('inspect', 470, 150, 380, 170, '2. Inspect the source images',
        ['Channels, calibration and real timepoints', 'Linked treatment/control display', 'Do not infer biology from color']),
      node('quality', 910, 150, 380, 170, '3. Examine acquisition quality',
        ['Spatial QC and measurement exploration', 'Review the affected original image', 'A flag is not a proven root cause'], 'amber'),
      node('sensitivity', 910, 430, 380, 170, '4. Test QC exclusion sensitivity',
        ['Run comparison and QC scenario previews', 'Show n, sample SD and excluded wells', 'Missing controls remain not estimable'], 'amber'),
      node('decision', 470, 430, 380, 170, '5. Record a human review',
        ['Review queue and explicit human rationale', 'Traceable repeat-acquisition worksheets', 'No automatic external-system action'], 'teal'),
      node('evidence', 30, 430, 380, 170, '6. Share the evidence',
        ['Readable report and measurement CSV', 'Image, source hash, method and QC rules', 'An authorized link does not grant access'], 'teal'),
    ],
    edges: [
      [[410, 235], [470, 235]], [[850, 235], [910, 235]], [[1100, 320], [1100, 430]],
      [[910, 515], [850, 515]], [[470, 515], [410, 515]],
    ],
    notes: [
      'n = technical wells within one run. Cells and timepoints do not increase n; the two simulated runs are not biological replicates.',
      'Research demonstration only. Reporter or morphology changes do not establish efficacy, safety, viability or mechanism.',
    ],
  },
  {
    name: 'data-lineage', width: 1320, height: 960,
    title: 'From analytical records back to image evidence',
    description: 'Stable identifiers connect the five Lakehouse tables. Reviews remain separate transactional records.',
    sections: [],
    nodes: [
      node('experiment', 490, 125, 340, 125, 'Experiment',
        ['assayscope_experiments', 'id, question, assay, synthetic origin']),
      node('acquisition', 50, 330, 340, 150, 'Acquisition',
        ['assayscope_acquisitions', 'id, experiment_id, run metadata', 'Fictional instruments are labeled']),
      node('measurement', 490, 330, 340, 150, 'Measurement',
        ['assayscope_measurements', 'well_id, run_id, source_image_id', 'Original values, units, code_version']),
      node('provenance', 930, 330, 340, 150, 'Provenance',
        ['assayscope_provenance', 'well_id, image_id, path, SHA-256', 'Axes, spacing, time, method, parameters'], 'teal'),
      node('review', 50, 595, 340, 150, 'Private research review',
        ['ReviewDecision in app SQL', 'experiment_id, well_id, user_id', 'Append-only human rationale'], 'gray'),
      node('qc', 490, 595, 340, 150, 'Quality observations',
        ['assayscope_qc', 'well_id, flags_json, thresholds_json', 'Exclusions never erase measurements'], 'amber'),
      node('image', 930, 595, 340, 150, 'Canonical image and derivatives',
        ['Lakehouse Files / images', 'TCZYX and physical calibration', 'Bounded ZYXC uint8 browser transport'], 'teal'),
    ],
    edges: [
      [[560, 250], [560, 285], [220, 285], [220, 330]],
      [[660, 250], [660, 330]],
      [[390, 405], [490, 405]], [[830, 405], [930, 405]],
      [[660, 480], [660, 595]], [[1100, 480], [1100, 595]],
      [[220, 595], [220, 540], [540, 540], [540, 480]],
    ],
    notes: [
      'Generator truth is held outside served/uploaded assets and is used only for synthetic evaluation; it is not an analysis input.',
      'The notebook checks record joins and versions. Actual image-byte hash verification is a separate integrity check.',
    ],
  },
];

const escape = text => String(text).replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]
));
const text = (x, y, value, size = 16, weight = 400) => (
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}">${escape(value)}</text>`
);

function svg(spec) {
  const sections = spec.sections.map(s => (
    `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="14" fill="none" stroke="#b8c5ce"/>`
    + text(s.x + 24, s.y + 32, s.title, 19, 600)
  )).join('\n');
  const edges = spec.edges.map(points => (
    `<path d="${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')}" fill="none" stroke="#526778" stroke-width="2" marker-end="url(#arrow)"/>`
  )).join('\n');
  const nodes = spec.nodes.map(n => {
    const tone = tones[n.tone];
    return `<g data-node-id="${n.id}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="1.5"/>`
      + text(n.x + 18, n.y + 34, n.title, 18, 600)
      + n.lines.map((line, i) => text(n.x + 18, n.y + 65 + i * 24, line, 15)).join('')
      + '</g>';
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-labelledby="title description">
<title id="title">${escape(spec.title)}</title><desc id="description">${escape(spec.description)} ${escape(spec.notes.join(' '))}</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#526778"/></marker></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
<g font-family="Segoe UI, Arial, sans-serif" fill="#152938">
${text(30, 48, spec.title, 30, 650)}${text(30, 82, spec.description, 16)}
${sections}${edges}${nodes}
${spec.notes.map((note, i) => text(30, spec.height - 65 + i * 26, note, 14)).join('\n')}
</g></svg>\n`;
}

function excalidraw(spec) {
  const elements = [];
  const base = (id, type, x, y, width, height) => ({
    id, type, x, y, width, height, angle: 0, strokeWidth: 1.5, strokeStyle: 'solid',
    fillStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: elements.length + 1, version: 1, versionNonce: 0,
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
    strokeColor: '#495057', backgroundColor: 'transparent',
  });
  const addText = (id, x, y, width, value, size = 16, containerId = null) => {
    elements.push({
      ...base(id, 'text', x, y, width, size * 2.5 * value.split('\n').length),
      text: value, originalText: value, fontSize: size, fontFamily: 2,
      strokeColor: '#000000', textAlign: 'left', verticalAlign: 'middle',
      containerId, autoResize: false, lineHeight: 1.4,
    });
  };
  addText('title', 30, 18, spec.width - 60, spec.title, 28);
  addText('subtitle', 30, 62, spec.width - 60, spec.description, 16);
  for (const section of spec.sections) {
    elements.push({ ...base(section.id, 'rectangle', section.x, section.y, section.width, section.height),
      roundness: { type: 3 }, strokeColor: '#b8c5ce' });
    addText(`${section.id}-label`, section.x + 24, section.y + 16, section.width - 48, section.title, 18);
  }
  spec.edges.forEach((points, i) => {
    const [x, y] = points[0];
    const end = points.at(-1);
    elements.push({ ...base(`edge-${i}`, 'arrow', x, y, Math.abs(end[0] - x), Math.abs(end[1] - y)),
      points: points.map(point => [point[0] - x, point[1] - y]),
      lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: null, endArrowhead: 'arrow', elbowed: false });
  });
  for (const n of spec.nodes) {
    elements.push({
      ...base(n.id, 'rectangle', n.x, n.y, n.width, n.height),
      strokeColor: tones[n.tone].stroke, backgroundColor: tones[n.tone].fill,
      roundness: { type: 3 }, boundElements: [{ id: `${n.id}-text`, type: 'text' }],
    });
    addText(`${n.id}-text`, n.x + 16, n.y + 12, n.width - 32,
      [n.title, ...n.lines].join('\n'), 14, n.id);
  }
  spec.notes.forEach((note, i) => addText(`note-${i}`, 30, spec.height - 80 + i * 28, spec.width - 60, note, 14));
  return `${JSON.stringify({
    type: 'excalidraw', version: 2, source: 'AssayScope',
    elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
  }, null, 2)}\n`;
}

const check = process.argv.includes('--check');
if (!check) mkdirSync(directory, { recursive: true });
for (const spec of diagrams) {
  for (const [extension, content] of [['svg', svg(spec)], ['excalidraw', excalidraw(spec)]]) {
    const destination = path.join(directory, `${spec.name}.${extension}`);
    if (check) {
      if (readFileSync(destination, 'utf8') !== content) throw new Error(`Stale diagram: ${destination}`);
    } else writeFileSync(destination, content);
  }
}
process.stdout.write(`${check ? 'Verified' : 'Generated'} ${diagrams.length} SVG diagrams and their editable Excalidraw sources.\n`);
