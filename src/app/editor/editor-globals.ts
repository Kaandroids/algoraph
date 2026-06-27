/**
 * Builds the editor's autocomplete model — the names in scope and their members
 * — from the API catalogue (`node-api.ts`) and the structures on the canvas.
 *
 * This is pure data assembly, kept out of the App component: given the placed
 * data nodes and the structures the code creates, it produces the `EditorGlobal`
 * list CodeMirror completes against (`graph.`, `canvas.`, each `pq.` / `dist.`).
 */
import {
  type ApiMember,
  DATA_STRUCTURE_API,
  GLOBAL_REFERENCE,
  memberName,
  signatureApply,
} from '../node-api';
import { DATA_STRUCTURES, type DataNode, type DataStructureKind } from '../models/data-structure.model';
import type { LocalStructure } from '../lang/locals';
import type { EditorGlobal } from './dsl';

/** One autocomplete member entry (a namespace / data-structure method or property). */
type EditorMember = NonNullable<EditorGlobal['members']>[number];

/**
 * Global-reference group titles, named once. Both the autocomplete model and the
 * library reference cards key off these, so the literals don't drift apart.
 */
export const API_GROUP = {
  graph: 'Graph access',
  visualization: 'Visualization',
  canvasEditing: 'Canvas editing',
  scratch: 'Scratch structures',
  panel: 'Panel structures',
} as const;

/** Map API signatures to deduplicated autocomplete entries (label, type, doc, insert text). */
function toMembers(members: readonly ApiMember[]): EditorMember[] {
  const out: EditorMember[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const label = memberName(m.sig);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      detail: m.returns ? `: ${m.returns}` : undefined,
      info: m.cost ? `${m.desc} · ${m.cost}` : m.desc,
      apply: signatureApply(m.sig) ?? undefined,
    });
  }
  return out;
}

/** Autocomplete members for a global namespace (`graph.` / `canvas.`), from its API group. */
export function apiGroupMembers(title: string): EditorMember[] {
  return toMembers(GLOBAL_REFERENCE.groups.find((g) => g.title === title)?.members ?? []);
}

/** Autocomplete members for a data structure's methods (from the API catalog). */
export function dataMembers(kind: DataStructureKind): EditorMember[] {
  return toMembers(DATA_STRUCTURE_API[kind].flatMap((g) => g.members));
}

/** Names in scope for the editor's autocomplete — the graph, the canvas, and data structures. */
export function buildEditorGlobals(
  dataNodes: readonly DataNode[],
  localStructures: readonly LocalStructure[],
): EditorGlobal[] {
  const structures = dataNodes.map((d) => ({
    name: d.label,
    type: DATA_STRUCTURES[d.kind].tag,
    members: dataMembers(d.kind),
  }));
  // Code-created structures, minus any whose name a placed structure already covers.
  const placed = new Set(dataNodes.map((d) => d.label));
  const locals = localStructures
    .filter((ls) => !placed.has(ls.name))
    .map((ls) => ({ name: ls.name, type: DATA_STRUCTURES[ls.kind].tag, members: dataMembers(ls.kind) }));
  return [
    { name: 'graph', type: 'Graph', members: apiGroupMembers(API_GROUP.graph) },
    {
      name: 'canvas',
      type: 'Canvas',
      members: [...apiGroupMembers(API_GROUP.visualization), ...apiGroupMembers(API_GROUP.canvasEditing)],
    },
    { name: 'scratch', type: 'Scratch', members: apiGroupMembers(API_GROUP.scratch) },
    { name: 'panel', type: 'Panel', members: apiGroupMembers(API_GROUP.panel) },
    ...structures,
    ...locals,
  ];
}
