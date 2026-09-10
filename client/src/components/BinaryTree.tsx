import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./binary-tree.css";

type NetworkNode = {
  user_id: string;
  username?: string;
  parent_id: string | null;
  leg: "left" | "right" | null;
};

export function BinaryTree({ nodes, currentUserId, ownerName }: {
  nodes: NetworkNode[];
  currentUserId?: string;
  ownerName: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const root = nodes.find(node => node.user_id === currentUserId) || nodes.find(node => !node.parent_id);
  const childrenByParent = new Map<string, Partial<Record<"left" | "right", NetworkNode>>>();

  for (const node of nodes) {
    if (!node.parent_id || !node.leg) continue;
    const children = childrenByParent.get(node.parent_id) || {};
    if (!children[node.leg]) children[node.leg] = node;
    childrenByParent.set(node.parent_id, children);
  }

  const centerRoot = () => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
  };
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(centerRoot);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    centerRoot();
    return () => observer.disconnect();
  }, [root?.user_id, nodes.length]);

  const initials = (name?: string) => (name || "?").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();

  const renderCard = (node: NetworkNode | undefined, leg: "left" | "right", depth: number) => (
    <div className={`binary-member binary-member-${leg} ${node ? "is-filled" : "is-empty"}`}>
      <i className="binary-member-status" />
      <span>PIERNA {leg === "left" ? "IZQUIERDA" : "DERECHA"}</span>
      <div className="binary-member-avatar" aria-hidden="true">{node ? initials(node.username) : "+"}</div>
      <b title={node?.username}>{node?.username || "Disponible"}</b>
      <small>{node ? `NIVEL ${depth}` : "ESPERANDO REFERIDO"}</small>
    </div>
  );

  const renderPair = (parentId: string, depth = 1, path = new Set<string>()): ReactNode => {
    if (path.has(parentId)) return null;
    const nextPath = new Set(path).add(parentId);
    const children = childrenByParent.get(parentId) || {};
    if (depth > 1 && !children.left && !children.right) return null;

    return (
      <div className="binary-pair" data-depth={depth}>
        {(["left", "right"] as const).map(leg => {
          const node = children[leg];
          return (
            <div className="binary-branch" key={`${parentId}-${leg}`}>
              {renderCard(node, leg, depth)}
              {node ? renderPair(node.user_id, depth + 1, nextPath) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="binary-tree-card dash-card">
      <div className="dash-card-head">
        <div><span className="dash-eyebrow">ÁRBOL BINARIO</span><h3>Estructura de red</h3></div>
        <button type="button" className="binary-center-button" onClick={centerRoot}>Centrar raíz</button>
      </div>
      <div ref={viewportRef} className="binary-viewport" role="region" aria-label="Árbol binario: desplázate horizontalmente para ver ambas piernas" tabIndex={0}>
        <div className="binary-canvas">
          <div className="binary-root">
            <i className="binary-member-status" />
            <span>DUEÑO DE LA CUENTA</span>
            <div className="binary-member-avatar" aria-hidden="true">{initials(root?.username || ownerName)}</div>
            <b>{root?.username || ownerName}</b>
            <small>NODO PRINCIPAL</small>
          </div>
          {root ? renderPair(root.user_id) : null}
        </div>
      </div>
      <p className="binary-tree-note">Cada usuario ocupa una sola posición: izquierda o derecha dentro de su padre.</p>
    </section>
  );
}
