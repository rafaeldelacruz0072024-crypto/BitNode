import { describe, it, expect } from "vitest";
import { validateMaterial } from "./marketingMaterials";
describe("Marketing upload validation", () => {
  it.each([["flyer.PNG","image/png","png"],["guide.pdf","application/pdf","pdf"],["pack.zip","application/zip","zip"]])("accepts %s",(name,type,ext) => expect(validateMaterial({ name, type, size: 100 })).toBe(ext));
  it.each([["unsafe.html","text/html",100],["unsafe.svg","image/svg+xml",100],["fake.pdf","text/html",100],["empty.pdf","application/pdf",0],["invalid.pdf","application/pdf",NaN],["infinite.pdf","application/pdf",Infinity],["negative.pdf","application/pdf",-1]])("rejects %s",(name,type,size) => expect(() => validateMaterial({name,type,size})).toThrow());
  it.each([20971521, 50 * 1024 * 1024, 150 * 1024 * 1024])("does not impose the old 20 MB cap (%s bytes)", size => {
    expect(validateMaterial({ name: "presentation.pdf", type: "application/pdf", size })).toBe("pdf");
  });
});
