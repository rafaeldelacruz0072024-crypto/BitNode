import React, { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const [trail, setTrail] = useState<string[]>([]);
  const [zoom, setZoom] = useState(0.75);
  const accountRoot = nodes.find(node => !node.parent_id) || nodes.find(node => node.user_id === currentUserId);
  const root = nodes.find(node => node.user_id === trail.at(-1)) || accountRoot;
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
      {node && <button className="binary-explore" onClick={() => setTrail(previous => [...previous, node.user_id])} aria-label={`Explorar red de ${node.username || "usuario"}`}>Explorar rama ↓</button>}
    </div>
  );

  const renderPair = (parentId: string, depth = 1, path = new Set<string>()): ReactNode => {
    if (path.has(parentId) || depth > 3) return null;
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
      <div className="binary-toolbar" aria-label="Navegación del árbol">
        <button disabled={!trail.length} onClick={() => setTrail([])}>Mi raíz</button>
        <button disabled={!trail.length} onClick={() => setTrail(previous => previous.slice(0, -1))}>← Volver</button>
        <button aria-label="Alejar árbol" disabled={zoom <= 0.3} onClick={() => setZoom(value => Math.max(0.3, value - 0.15))}>−</button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button aria-label="Acercar árbol" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, value + 0.15))}>+</button>
      </div>
      <div ref={viewportRef} className="binary-viewport" role="region" aria-label="Árbol binario: desplázate horizontalmente para ver ambas piernas" tabIndex={0}>
        <div className="binary-canvas" style={{ zoom }}>
          <div className="binary-root">
            <i className="binary-member-status" />
            <span>{trail.length ? "RAMA SELECCIONADA" : "DUEÑO DE LA CUENTA"}</span>
            <div className="binary-member-avatar" aria-hidden="true">{initials(root?.username || ownerName)}</div>
            <b>{root?.username || ownerName}</b>
            <small>NODO PRINCIPAL</small>
          </div>
          {root ? renderPair(root.user_id) : null}
        </div>
      </div>
      <p className="binary-tree-note">Desliza para recorrer el árbol. Pulsa «Explorar rama» para profundizar: se muestran tres niveles por vista de la red cargada. «Volver» regresa a la vista anterior.</p>
    </section>
  );
}
