// If the user asked for a chart/pie/visualization and the reply contains a
// markdown table with a numeric second column, append an auto-generated
// Mermaid pie chart so the frontend can render it.
export function injectCharts(userMessage, reply) {
  const trigger = /\b(pie|chart|visualize)\b/i;
  if (!userMessage || !trigger.test(userMessage)) return reply;
  if (/```mermaid/i.test(reply)) return reply;

  const lines = reply.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return reply;

  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/^\s*\|.+\|\s*$/.test(lines[i])) break;
    const cells = lines[i].split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 2) continue;
    const label = cells[0];
    const num = parseFloat(cells[1].replace(/[$,%\s]/g, ''));
    if (!label || !isFinite(num)) continue;
    rows.push([label, num]);
  }
  if (rows.length < 2) return reply;

  const headerCells = lines[headerIdx].split('|').slice(1, -1).map(s => s.trim());
  const title = headerCells[0] || 'Data Breakdown';
  const chart = [
    '```mermaid',
    `pie title ${title}`,
    ...rows.map(([label, n]) => `    "${label.replace(/"/g, '')}" : ${n}`),
    '```',
  ].join('\n');

  return reply + '\n\n' + chart;
}
