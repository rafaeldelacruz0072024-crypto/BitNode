import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./binary-tree.css";

export function BinaryTree({
  nodes,
  currentUserId,
  ownerName,
}: {
  nodes: Array<{
    user_id: string;
    username?: string;
    parent_id: string | null;
    leg: "left" | "right" | null;
  }>;
  currentUserId?: string;
  ownerName: string;
}) {
  const root =
    nodes.find(node => node.user_id === currentUserId) ||
    nodes.find(node => !node.parent_id);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centerRoot = () => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
  };
  useLayoutEffect(centerRoot, [root?.user_id]);
  const childrenByParent = new Map<string, typeof nodes>();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    const children = childrenByParent.get(node.parent_id) || [];
    children.push(node);
    childrenByParent.set(node.parent_id, children);
  }

  const initials = (name?: string) =>
    (name || "?")
      .split(/\s+/)
      .map(part => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const renderChildren = (parentId: string, depth = 1): ReactNode => {
    const children = childrenByParent.get(parentId) || [];
    const child = (leg: "left" | "right") =>
      children.find(node => node.leg === leg);
    const left = child("left");
    const right = child("right");
    if (depth > 1 && !left && !right) return null;

    return (
      <div className="tree-level" data-depth={depth}>
        {(["left", "right"] as const).map(leg => {
          const node = leg === "left" ? left : right;
          return (
            <div className="tree-branch" key={`${parentId}-${leg}`}>
              <div className={`tree-leg ${leg} ${node ? "filled" : "empty"}`}>
                <i className="tree-status-dot" />
                <span>PIERNA {leg === "left" ? "IZQUIERDA" : "DERECHA"}</span>
                <div className="tree-avatar" aria-hidden="true">
                  {node ? initials(node.username) : "+"}
                </div>
                <b title={node?.username}>{node?.username || "Disponible"}</b>
                <small>{node ? `NIVEL ${depth}` : "ESPERANDO REFERIDO"}</small>
              </div>
              {node ? renderChildren(node.user_id, depth + 1) : null}
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <section className="binary-tree-card dash-card">
      <div className="dash-card-head">
        <div>
          <span className="dash-eyebrow">ÁRBOL BINARIO</span>
          <h3>Estructura de red</h3>
        </div>
        <button type="button" className="tree-center-button" onClick={centerRoot}>Centrar raíz</button>
      </div>
      <div ref={viewportRef} className="binary-tree-visual" role="region" aria-label="Árbol binario: desplázate horizontalmente para ver ambas piernas" tabIndex={0}>
        <div className="binary-tree-content">
        <div className="tree-node root filled">
          <i className="tree-status-dot" />
          <span>DUEÑO DE LA CUENTA</span>
          <div className="tree-avatar" aria-hidden="true">
            {initials(root?.username || ownerName)}
          </div>
          <b>{root?.username || ownerName}</b>
          <small>NODO PRINCIPAL</small>
        </div>
        {root ? renderChildren(root.user_id) : null}
        </div>
      </div>
      <p className="binary-tree-note">
        Cada persona tiene una posición izquierda y una derecha. Desliza el árbol
        horizontalmente para recorrer las ramas.
      </p>
    </section>
  );
}
