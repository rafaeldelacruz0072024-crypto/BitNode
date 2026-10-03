export const MATERIAL_CATEGORIES = ["Flyers", "Presentaciones", "Guías", "Videos", "Otros"] as const;
export const MATERIAL_TYPES: Record<string, string[]> = {
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"],
  pdf: ["application/pdf"], zip: ["application/zip", "application/x-zip-compressed"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], mp4: ["video/mp4"],
};
export function validateMaterial(file: { name: string; size: number; type: string }) {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("El archivo debe pesar entre 1 byte y 20 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!MATERIAL_TYPES[extension]?.includes(file.type)) throw new Error("Formato no permitido. Usa JPG, PNG, WEBP, PDF, PPTX, DOCX, ZIP o MP4.");
  return extension;
}
