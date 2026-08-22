import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../server/app";

const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}
