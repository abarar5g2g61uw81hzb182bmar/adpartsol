import { handleTelegram } from "../../src/httpApp.js";

export const config = { api: { bodyParser: false }, maxDuration: 60 };

export default async function handler(req, res) {
  const bot = req.query?.bot || "customer";
  return handleTelegram(req, res, String(bot));
}
