/**
 * Model hierarchy validation.
 *
 * Parent links form a directed graph with at most one outgoing edge per
 * object. A cycle would make the scene impossible to transform, so the graph
 * is walked iteratively and any back edge is detached. The walk is iterative
 * on purpose: deeply nested or hostile project data must not be able to
 * exhaust the JavaScript call stack.
 */

export interface HierarchicalObject {
  id: string;
  parent?: string | null;
  [key: string]: unknown;
}

/**
 * Detach parent links that would create a cycle. The rest of the hierarchy is
 * kept intact, so a broken project still opens with a usable tree.
 */
export function sanitizeObjectHierarchy<T extends HierarchicalObject>(objects: T[]): T[] {
  if (!Array.isArray(objects) || objects.length === 0) return objects || [];

  const byId = new Map(objects.map((object) => [object.id, object]));
  const complete = new Set<string>();

  for (const start of objects) {
    if (!start || complete.has(start.id)) continue;

    const path: T[] = [];
    const active = new Set<string>();
    let current: T | undefined = start;

    while (current && !complete.has(current.id)) {
      if (active.has(current.id)) {
        // The last node points back into this walk. Detach that edge to turn
        // the graph into a tree while retaining the rest of the hierarchy.
        const edge = path[path.length - 1];
        if (edge) edge.parent = null;
        break;
      }

      active.add(current.id);
      path.push(current);

      if (current.parent == null) break;
      const parent = byId.get(current.parent);
      if (!parent || parent === current) {
        current.parent = null;
        break;
      }
      current = parent;
    }

    for (const object of path) complete.add(object.id);
  }

  return objects;
}
