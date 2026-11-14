const API_BASE = location.hostname.includes("workers.dev") || location.hostname.includes("storzen.io") ? "" : "https://adpartsol.storzen-io.workers.dev";
window.ADP_CONFIG = Object.freeze({
  apiBase: API_BASE,
  endpoints: Object.freeze({
    track: "/api/panel/track",
    health: "/api/health"
  }),
  whatsapp: "7992809027",
  telegram: "@AdPartsol_Bot",
  email: "adcomputers149@gmail.com",
  phone: "7992809027",
  hours: "10 AM to 4 PM",
  address: "Madhapur, Kendrapara, Odisha 754211",
  appleLabel: "Apple Authorized Reseller"
});
