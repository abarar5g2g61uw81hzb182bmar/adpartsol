import { handleCron } from "../src/httpApp.js";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  return handleCron(req, res);
}
