export type SupportNode = { user_id: string; parent_id: string | null; leg: "left" | "right" | null; username?: string };

/** Return only the requested subtree, without depth caps, guarding cycles. */
export function supportSubtree(nodes: SupportNode[], userId: string) {
  const root = nodes.find(n => n.user_id === userId);
  if (!root) return [];
  const children = new Map<string, SupportNode[]>();
  for (const node of nodes) {
    if (node.parent_id) children.set(node.parent_id, [...(children.get(node.parent_id) || []), node]);
  }
  const result: SupportNode[] = [{ ...root, parent_id: null, leg: null }];
  const seen = new Set([userId]);
  for (let index = 0; index < result.length; index++) {
    for (const node of children.get(result[index].user_id) || []) {
      if (seen.has(node.user_id)) continue;
      seen.add(node.user_id); result.push(node);
    }
  }
  return result;
}
