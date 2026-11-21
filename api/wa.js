import { handleWhatsApp } from "../src/httpApp.js";

export const config = { api: { bodyParser: false }, maxDuration: 60 };

export default async function handler(req, res) {
  return handleWhatsApp(req, res);
}
