import { handleHealth } from "../src/httpApp.js";
export const config = { maxDuration: 30 };
export default async function handler(req, res) {
  return handleHealth(req, res);
}
