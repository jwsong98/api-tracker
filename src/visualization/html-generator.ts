import type { SessionMeta, GraphData, Edge } from "../types.js";
import { readJson, listDirs } from "../storage/file-store.js";

// ── Visualization Types ──

export interface SessionVisualizationData {
  meta: SessionMeta;
  graph: GraphData;
  edges: Edge[];
}

export interface AllSessionsVisualizationData {
  sessions: SessionVisualizationData[];
  continueFromLinks: Array<{
    parentSession: string;
    parentLastNodeId: number;
    childSession: string;
  }>;
}

// ── Data Collection ──

export async function collectSessionData(sessionName: string): Promise<SessionVisualizationData> {
  const meta = await readJson<SessionMeta>(`sessions/${sessionName}/meta.json`);
  if (!meta) {
    throw new Error(`Session "${sessionName}" not found`);
  }

  const graph = await readJson<GraphData>(`sessions/${sessionName}/graph.json`);
  if (!graph) {
    throw new Error(`Graph data not found for session "${sessionName}"`);
  }

  const edges: Edge[] = [];
  for (const graphEdge of graph.edges) {
    const edge = await readJson<Edge>(`sessions/${sessionName}/edges/${graphEdge.file}`);
    if (edge) {
      edges.push(edge);
    }
  }

  return { meta, graph, edges };
}

export async function collectAllSessionsData(): Promise<AllSessionsVisualizationData> {
  const dirs = await listDirs("sessions");
  const sessions: SessionVisualizationData[] = [];

  for (const dir of dirs) {
    const data = await collectSessionData(dir);
    sessions.push(data);
  }

  const continueFromLinks: AllSessionsVisualizationData["continueFromLinks"] = [];
  for (const session of sessions) {
    if (session.meta.continueFrom) {
      const parent = sessions.find((s) => s.meta.name === session.meta.continueFrom);
      if (parent) {
        continueFromLinks.push({
          parentSession: parent.meta.name,
          parentLastNodeId: parent.meta.lastNodeId,
          childSession: session.meta.name,
        });
      }
    }
  }

  return { sessions, continueFromLinks };
}

// ── HTML Generation ──

const SESSION_COLORS = [
  "#4CAF50",
  "#2196F3",
  "#FF9800",
  "#9C27B0",
  "#F44336",
  "#00BCD4",
  "#795548",
  "#607D8B",
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonEmbed(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/gi, "<\\/script");
}

function getNodeColor(label: string): string {
  if (label === "seed" || label.startsWith("continue:")) return "#9E9E9E";
  if (label.startsWith("POST")) return "#4CAF50";
  if (label.startsWith("GET")) return "#2196F3";
  if (label.startsWith("PUT") || label.startsWith("PATCH")) return "#FF9800";
  if (label.startsWith("DELETE")) return "#F44336";
  return "#607D8B";
}

function getNodeShape(label: string): string {
  if (label === "seed" || label.startsWith("continue:")) return "diamond";
  return "box";
}

function buildEdgeLookupScript(edges: Edge[]): string {
  return `var edgeLookup = ${safeJsonEmbed(
    Object.fromEntries(edges.map((e) => [e.edgeId, e])),
  )};`;
}

function cssBlock(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #FFFFFF; color: #333333; display: flex; flex-direction: column; height: 100vh; }
    #header { padding: 12px 16px; border-bottom: 1px solid #E0E0E0; background: #F5F5F5; }
    #header h1 { font-size: 16px; font-weight: 600; }
    #header .status { font-size: 13px; color: #666; margin-top: 2px; }
    #legend { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 12px; }
    .legend-color { width: 12px; height: 12px; border-radius: 2px; }
    #main { display: flex; flex: 1; overflow: hidden; }
    #graph { width: 70%; height: 100%; border-right: 1px solid #E0E0E0; }
    #detail { width: 30%; height: 100%; overflow-y: auto; padding: 16px; background: #F5F5F5; }
    #detail h2 { font-size: 14px; margin-bottom: 8px; }
    #detail .section { margin-bottom: 12px; }
    #detail .section-title { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; margin-bottom: 4px; }
    #detail .field { margin-bottom: 4px; font-size: 13px; }
    #detail .field-label { font-weight: 600; }
    #detail pre { background: #F0F0F0; padding: 8px; border-radius: 4px; font-size: 12px; font-family: "SF Mono", Menlo, Monaco, monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    #detail .placeholder { color: #999; font-size: 13px; padding-top: 40px; text-align: center; }
    #detail .warning { color: #E65100; font-size: 12px; }
    #detail .ref-item { font-size: 12px; color: #555; margin-bottom: 2px; }
  `;
}

function detailPanelScript(): string {
  return `
    function showEdgeDetail(edgeId) {
      var edge = edgeLookup[edgeId];
      if (!edge) { resetDetail(); return; }
      var h = '<h2>Edge ' + edge.edgeId + '</h2>';
      h += '<div class="field"><span class="field-label">From:</span> Node ' + edge.fromNode + ' → Node ' + edge.toNode + '</div>';
      h += '<div class="field"><span class="field-label">Timestamp:</span> ' + escapeH(edge.timestamp) + '</div>';
      if (edge.authProfile) { h += '<div class="field"><span class="field-label">Auth:</span> ' + escapeH(edge.authProfile) + '</div>'; }

      h += '<div class="section"><div class="section-title">Request</div>';
      h += '<div class="field"><span class="field-label">Method:</span> ' + escapeH(edge.request.method) + '</div>';
      h += '<div class="field"><span class="field-label">Path:</span> ' + escapeH(edge.request.path) + '</div>';
      if (edge.request.template && edge.request.template.path !== edge.request.path) {
        h += '<div class="field"><span class="field-label">Template:</span> ' + escapeH(edge.request.template.path) + '</div>';
      }
      if (edge.request.headers && Object.keys(edge.request.headers).length > 0) {
        h += '<div class="field"><span class="field-label">Headers:</span></div><pre>' + escapeH(JSON.stringify(edge.request.headers, null, 2)) + '</pre>';
      }
      if (edge.request.body !== undefined && edge.request.body !== null) {
        h += '<div class="field"><span class="field-label">Body:</span></div><pre>' + escapeH(JSON.stringify(edge.request.body, null, 2)) + '</pre>';
      }
      h += '</div>';

      h += '<div class="section"><div class="section-title">Response</div>';
      h += '<div class="field"><span class="field-label">Status:</span> ' + edge.response.status + '</div>';
      if (edge.response.headers && Object.keys(edge.response.headers).length > 0) {
        h += '<div class="field"><span class="field-label">Headers:</span></div><pre>' + escapeH(JSON.stringify(edge.response.headers, null, 2)) + '</pre>';
      }
      if (edge.response.body !== undefined && edge.response.body !== null) {
        h += '<div class="field"><span class="field-label">Body:</span></div><pre>' + escapeH(JSON.stringify(edge.response.body, null, 2)) + '</pre>';
      }
      h += '</div>';

      if (edge.refs && edge.refs.length > 0) {
        h += '<div class="section"><div class="section-title">Refs</div>';
        edge.refs.forEach(function(r) {
          h += '<div class="ref-item">' + escapeH(r.source) + (r.boundAs ? ' → ' + escapeH(r.boundAs) : '') + ': ' + escapeH(JSON.stringify(r.value)) + '</div>';
        });
        h += '</div>';
      }

      if (edge.warnings && edge.warnings.length > 0) {
        h += '<div class="section"><div class="section-title">Warnings</div>';
        edge.warnings.forEach(function(w) {
          h += '<div class="warning">' + escapeH(w) + '</div>';
        });
        h += '</div>';
      }

      document.getElementById('detail').innerHTML = h;
    }

    function resetDetail() {
      document.getElementById('detail').innerHTML = '<div class="placeholder">엣지를 클릭하면 상세정보가 표시됩니다</div>';
    }

    function escapeH(s) {
      if (typeof s !== 'string') s = String(s);
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  `;
}

export function generateSessionHtml(data: SessionVisualizationData): string {
  const { meta, graph, edges } = data;

  const visNodes = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    color: { background: getNodeColor(n.label), border: getNodeColor(n.label) },
    shape: getNodeShape(n.label),
    font: { color: "#FFFFFF", size: 12 },
  }));

  const visEdges = graph.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    arrows: { to: { enabled: true } },
    color: { color: "#333333" },
  }));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.name)} - API Tracker</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>${cssBlock()}</style>
</head>
<body>
<div id="header">
  <h1>${escapeHtml(meta.name)}</h1>
  <div class="status">Status: ${escapeHtml(meta.status)} | Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length} | Created: ${escapeHtml(meta.createdAt)}</div>
</div>
<div id="main">
  <div id="graph"></div>
  <div id="detail"><div class="placeholder">엣지를 클릭하면 상세정보가 표시됩니다</div></div>
</div>
<script>
${buildEdgeLookupScript(edges)}
${detailPanelScript()}

var nodes = new vis.DataSet(${safeJsonEmbed(visNodes)});
var edges = new vis.DataSet(${safeJsonEmbed(visEdges)});
var container = document.getElementById('graph');
var network = new vis.Network(container, { nodes: nodes, edges: edges }, {
  layout: { hierarchical: { direction: "UD", sortMethod: "directed", levelSeparation: 100 } },
  physics: false,
  interaction: { hover: true }
});

network.on("selectEdge", function(params) {
  if (params.edges.length === 1) { showEdgeDetail(params.edges[0]); }
});
network.on("selectNode", function() { resetDetail(); });
network.on("deselectEdge", function() { resetDetail(); });
</script>
</body>
</html>`;
}

export function generateAllSessionsHtml(data: AllSessionsVisualizationData): string {
  const { sessions, continueFromLinks } = data;

  const allVisNodes: Array<Record<string, unknown>> = [];
  const allVisEdges: Array<Record<string, unknown>> = [];
  const allEdges: Edge[] = [];
  const legendItems: Array<{ name: string; color: string }> = [];

  // Build edge lookup with session-prefixed IDs
  const edgeLookupEntries: Array<[string, Edge]> = [];

  sessions.forEach((session, idx) => {
    const color = SESSION_COLORS[idx % SESSION_COLORS.length];
    legendItems.push({ name: session.meta.name, color });

    for (const node of session.graph.nodes) {
      const internalId = `${session.meta.name}::${node.id}`;
      const nodeColor = getNodeColor(node.label);
      allVisNodes.push({
        id: internalId,
        label: node.label,
        color: { background: nodeColor, border: color, borderWidth: 3 },
        shape: getNodeShape(node.label),
        font: { color: "#FFFFFF", size: 12 },
      });
    }

    for (const edge of session.graph.edges) {
      const edgeInternalId = `${session.meta.name}::${edge.id}`;
      allVisEdges.push({
        id: edgeInternalId,
        from: `${session.meta.name}::${edge.from}`,
        to: `${session.meta.name}::${edge.to}`,
        arrows: { to: { enabled: true } },
        color: { color: "#333333" },
      });
    }

    for (const edge of session.edges) {
      const edgeInternalId = `${session.meta.name}::${edge.edgeId}`;
      edgeLookupEntries.push([edgeInternalId, edge]);
      allEdges.push(edge);
    }
  });

  // Add continueFrom cross-session edges
  for (const link of continueFromLinks) {
    allVisEdges.push({
      id: `link::${link.parentSession}::${link.childSession}`,
      from: `${link.parentSession}::${link.parentLastNodeId}`,
      to: `${link.childSession}::0`,
      arrows: { to: { enabled: true } },
      color: { color: "#999999" },
      dashes: true,
    });
  }

  const legendHtml = legendItems
    .map(
      (item) =>
        `<span class="legend-item"><span class="legend-color" style="background:${item.color}"></span>${escapeHtml(item.name)}</span>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All Sessions - API Tracker</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>${cssBlock()}</style>
</head>
<body>
<div id="header">
  <h1>All Sessions</h1>
  <div class="status">Sessions: ${sessions.length}</div>
  <div id="legend">${legendHtml}</div>
</div>
<div id="main">
  <div id="graph"></div>
  <div id="detail"><div class="placeholder">엣지를 클릭하면 상세정보가 표시됩니다</div></div>
</div>
<script>
var edgeLookup = ${safeJsonEmbed(Object.fromEntries(edgeLookupEntries))};
${detailPanelScript()}

var nodes = new vis.DataSet(${safeJsonEmbed(allVisNodes)});
var edges = new vis.DataSet(${safeJsonEmbed(allVisEdges)});
var container = document.getElementById('graph');
var network = new vis.Network(container, { nodes: nodes, edges: edges }, {
  layout: { hierarchical: { direction: "UD", sortMethod: "directed", levelSeparation: 100 } },
  physics: false,
  interaction: { hover: true }
});

network.on("selectEdge", function(params) {
  if (params.edges.length === 1) { showEdgeDetail(params.edges[0]); }
});
network.on("selectNode", function() { resetDetail(); });
network.on("deselectEdge", function() { resetDetail(); });
</script>
</body>
</html>`;
}
