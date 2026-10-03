import { describe, it, expect } from "vitest";
import { validateMaterial } from "./marketingMaterials";
describe("Marketing upload validation", () => {
  it.each([["flyer.PNG","image/png","png"],["guide.pdf","application/pdf","pdf"],["pack.zip","application/zip","zip"]])("accepts %s",(name,type,ext) => expect(validateMaterial({ name, type, size: 100 })).toBe(ext));
  it.each([["unsafe.html","text/html",100],["unsafe.svg","image/svg+xml",100],["fake.pdf","text/html",100],["empty.pdf","application/pdf",0],["huge.pdf","application/pdf",20971521]])("rejects %s",(name,type,size) => expect(() => validateMaterial({name,type,size})).toThrow());
});
