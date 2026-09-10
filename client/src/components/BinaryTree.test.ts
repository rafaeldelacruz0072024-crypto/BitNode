import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BinaryTree } from "./BinaryTree";

describe("BinaryTree", () => {
  it("renders both binary legs and descendants from the returned topology", () => {
    const html = renderToStaticMarkup(createElement(BinaryTree, {
      currentUserId: "root",
      ownerName: "Principal",
      nodes: [
        { user_id: "root", username: "Principal", parent_id: null, leg: null },
        { user_id: "left", username: "Izquierda", parent_id: "root", leg: "left" },
        { user_id: "right", username: "Derecha", parent_id: "root", leg: "right" },
        { user_id: "left-left", username: "Nieto", parent_id: "left", leg: "left" },
      ],
    }));

    expect(html).toContain("Principal");
    expect(html).toContain("Izquierda");
    expect(html).toContain("Derecha");
    expect(html).toContain("Nieto");
    expect(html).toContain("PIERNA IZQUIERDA");
    expect(html).toContain("PIERNA DERECHA");
  });

  it("never renders ancestors or sibling branches above the signed-in member", () => {
    const html = renderToStaticMarkup(createElement(BinaryTree, {
      currentUserId: "leaf",
      ownerName: "Cuenta hoja",
      nodes: [
        { user_id: "principal", username: "Principal global", parent_id: null, leg: null },
        { user_id: "sibling", username: "Rama ajena", parent_id: "principal", leg: "left" },
        { user_id: "leaf", username: "Cuenta hoja", parent_id: "principal", leg: "right" },
      ],
    }));

    expect(html).toContain("Cuenta hoja");
    expect(html).not.toContain("Principal global");
    expect(html).not.toContain("Rama ajena");
    expect(html).toContain("Disponible");
  });
});
