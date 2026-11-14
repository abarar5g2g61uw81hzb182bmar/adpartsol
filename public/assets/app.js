(function() {
  "use strict";
  const CONFIG = Object.assign({ appleLabel: "Apple Authorized Reseller", apiBase: "", whatsapp: "", telegram: "", email: "", phone: "", hours: "", address: "" }, window.ADP_CONFIG || {});
  const TG = String(CONFIG.telegram).replace(/^@/, "");
  const BRANDS = [
    ["Apple", ["iPhone 18 Pro Max", "iPhone 18 Pro", "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone Air", "iPhone 17", "iPhone 16e", "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16", "iPhone 15", "iPhone 14", "iPhone 13"]],
    ["Samsung", ["Galaxy S26 Ultra", "Galaxy S26+", "Galaxy S26", "Galaxy S26 FE", "Galaxy S25 Ultra", "Galaxy Z Fold7", "Galaxy Z Flip7", "Galaxy A56", "Galaxy A36", "Galaxy A26", "Galaxy A17", "Galaxy M36", "Galaxy F36"]],
    ["Vivo", ["V60", "V50", "V50e", "X200 Pro", "X200 FE", "X Fold5", "T4 5G", "T4x", "Y400", "Y39", "Y29", "Y19s"]],
    ["OPPO", ["Reno15 Pro", "Reno15 Pro Mini", "Reno15", "Reno14 Pro", "Reno14", "F31 Pro", "F31", "F29", "K13", "A5 Pro", "A5x", "A3x"]],
    ["Realme", ["GT 7 Pro", "GT 7", "15 Pro", "15", "14 Pro+", "14x", "P4 Pro", "P4", "P3x", "Narzo 80 Pro", "Narzo 80x", "C75"]],
    ["Redmi", ["Note 14 Pro+", "Note 14 Pro", "Note 14", "15 5G", "15C", "14C", "A5", "A4", "13 5G", "Note 13 Pro", "13C", "Note 12"]],
    ["Xiaomi", ["15 Ultra", "15", "14 Ultra", "14 Civi", "14", "13 Pro", "12 Pro", "11T Pro", "11i HyperCharge", "11 Lite NE"]],
    ["POCO", ["F7", "X7 Pro", "X7", "M7 Pro", "M7", "C75", "C71", "F6", "X6 Pro", "M6 Plus", "M6", "C65"]],
    ["OnePlus", ["15", "13", "13R", "13s", "Nord 5", "Nord CE5", "Nord 4", "Nord CE4", "Nord CE4 Lite", "12", "12R", "Nord CE 3 Lite"]],
    ["iQOO", ["13", "Neo 10", "Neo 10R", "Z10", "Z10x", "Z10R", "Z10 Lite", "Z9s", "Z9", "12", "Neo 9 Pro", "Z7"]],
    ["Motorola", ["Edge 60 Pro", "Edge 60 Fusion", "Edge 60", "Edge 50 Pro", "Edge 50 Fusion", "Razr 60", "G96", "G85", "G64", "G45", "G35", "G05"]],
    ["Google Pixel", ["Pixel 10 Pro XL", "Pixel 10 Pro", "Pixel 10", "Pixel 10a", "Pixel 9 Pro XL", "Pixel 9 Pro", "Pixel 9", "Pixel 9a", "Pixel 8 Pro", "Pixel 8", "Pixel 8a", "Pixel 7a"]],
    ["Nothing", ["Phone (3)", "Phone (3a) Pro", "Phone (3a)", "Phone (2a) Plus", "Phone (2a)", "Phone (2)", "Phone (1)"]],
    ["CMF", ["Phone 2 Pro", "Phone 1"]],
    ["Infinix", ["GT 30 Pro", "Note 50s", "Hot 60", "Smart 10", "GT 20 Pro", "Note 40 Pro", "Hot 50", "Smart 9", "Zero 40", "Note 40", "Hot 40i", "Smart 8"]],
    ["Tecno", ["Pova 7 Pro", "Pova 7", "Pova Slim", "Spark Go 2", "Pova 6 Pro", "Camon 30", "Spark 30C", "Pop 9", "Spark 20 Pro", "Pova 6 Neo"]],
    ["itel", ["A95", "A90", "A80", "Zeno 10", "Color Pro 5G", "P55", "S24", "A70", "P40", "A60s", "A50"]],
    ["Lava", ["Agni 3", "Blaze Duo", "Bold", "Storm", "Yuva Star", "Yuva 4", "Blaze 3", "Shark", "Agni 2", "Blaze X", "Storm Play", "O3 Pro"]],
    ["Honor", ["X9c", "200 Pro", "200", "X9b", "90"]],
    ["Nokia", ["G42", "C32", "G21", "C12", "G11 Plus", "C31", "G60", "X30"]],
    ["Asus", ["ROG Phone 8 Pro", "ROG Phone 8", "Zenfone 10", "Zenfone 9", "ROG Phone 7", "ROG Phone 6"]],
    ["Micromax", ["IN 2b", "IN Note 2", "IN Note 1", "IN 1b"]],
    ["Jio", ["JioPhone Next", "JioBharat V3", "JioBharat B1", "JioPhone Prima 2"]],
    ["Lenovo", []],
    ["Huawei", []],
    ["Karbonn", []]
  ];
  const CATS = [["all", "All parts"], ["glass", "Display and Glass"], ["camera", "Camera"], ["power", "Board and Power"], ["flex", "Flex and Connectors"], ["audio", "Audio and Sensors"], ["frame", "Frame and Housing"], ["hw", "Shielding and Hardware"]];
  const PARTS = [
    ["display", "Front Display Glass", "OLED panel with touch and cover glass, pixel tested.", "glass"],
    ["rear-glass", "Rear Glass Panel", "Back glass with logo, colour matched and adhesive ready.", "glass"],
    ["camera-module", "Triple Rear Camera Module", "Main, ultra wide and telephoto, focus checked on live preview.", "camera"],
    ["lenses", "Camera Lenses", "Sapphire lens covers, clear and scratch checked.", "camera"],
    ["lens-rings", "Camera Lens Rings", "Precision metal rings that seat and protect each lens.", "camera"],
    ["sensor-asm", "Camera Sensor Assembly", "Image sensor boards, output verified before dispatch.", "camera"],
    ["flash", "Camera Flash Module", "True Tone flash with its flex, brightness tested.", "camera"],
    ["cam-housing", "Camera Housing", "Steel camera bracket that holds every module square.", "camera"],
    ["frontcam", "Front Camera", "Selfie camera module, image output verified.", "camera"],
    ["board", "Logic Board (Motherboard)", "Main board, power and network tested before sealing.", "power"],
    ["battery", "Battery", "Li-ion cell with protection board, cycle checked.", "power"],
    ["bat-conn", "Battery Connector", "Battery flex and board-to-board connector.", "power"],
    ["coil", "Wireless Charging Coil (MagSafe)", "Coil with magnet array, charge and alignment tested.", "power"],
    ["disp-conn", "Display Connector", "Display flex and connector, fit checked by model.", "flex"],
    ["cam-flex", "Camera Flex Cable", "Sensor flex cables, continuity tested.", "flex"],
    ["power-flex", "Power Button Flex Cable", "Side key flex, click and response checked.", "flex"],
    ["vol-flex", "Volume Button Flex Cable", "Volume and action key flex, tested on every key.", "flex"],
    ["charge-flex", "Charging Port Flex Cable", "USB-C port with mic and flex, charge and data tested.", "flex"],
    ["clips", "Connector Clips", "Steel clips that lock board connectors in place.", "flex"],
    ["speaker", "Speaker Assembly", "Loudspeaker and earpiece units, sound checked.", "audio"],
    ["mic", "Microphone Module", "Top and bottom mics, call clarity tested.", "audio"],
    ["sensors", "Sensor Modules", "Face ID, proximity and LiDAR modules by model.", "audio"],
    ["antenna", "Antenna Modules", "Cellular, Wi-Fi and GPS antenna flexes.", "audio"],
    ["taptic", "Taptic Engine", "Vibration motor, tested for a clean response.", "audio"],
    ["frame", "Main Frame / Mid Frame", "Aluminium frame with keys and mounting points.", "frame"],
    ["sim", "SIM Tray", "Colour matched tray with seal, fit checked.", "frame"],
    ["brackets", "Metal Brackets", "Connector brackets that hold every flex secure.", "frame"],
    ["plates", "Internal Mounting Plates", "Steel plates that mount the speaker and top modules.", "frame"],
    ["rf-shield", "RF Shielding Plates", "Board shields that keep signals clean.", "hw"],
    ["emi", "EMI Shielding", "Conductive shielding films for the logic board.", "hw"],
    ["thermal", "Thermal Shield", "Graphite heat spreader sheets.", "hw"],
    ["screws", "Internal Screws", "Pentalobe, tri-point and Phillips screw sets.", "hw"],
    ["fasteners", "Metal Fasteners", "Standoffs and threaded nuts for the board and brackets.", "hw"],
    ["display-asm", "Display Assembly (Complete)", "Panel bonded to the frame with touch, ready to fit.", "glass"],
    ["touch-glass", "Touch Glass with OCA", "Front glass only, OCA pre-applied for refurbishing.", "glass"],
    ["lcd", "LCD Display with Touch", "IPS panel with digitizer and flex for budget models.", "glass"],
    ["back-housing", "Back Housing / Back Panel", "Complete rear housing with frame, colour matched.", "frame"],
    ["keys", "Side Keys (Power, Volume, Action)", "Metal key caps, click feel matched to original.", "frame"],
    ["cam-control", "Camera Control Button", "Sapphire capacitive button with its flex.", "frame"],
    ["usb-port", "Charging Port (USB-C)", "USB-C connector, charge and data tested.", "flex"],
    ["main-flex", "Main Flex Cable (Board to Board)", "Main to sub board flex, continuity tested.", "flex"],
    ["sim-reader", "SIM Card Reader", "SIM and memory card reader with contacts.", "flex"],
    ["sub-board", "Sub Board / Charging Board", "Charging port board with mic, tested for charge and data.", "power"],
    ["earpiece", "Earpiece Speaker", "Top call speaker with mesh, clarity tested.", "audio"],
    ["faceid", "Face ID / TrueDepth Module", "Dot projector, flood and IR camera assembly.", "audio"],
    ["fingerprint", "Fingerprint Sensor", "Side key and in-display sensors by model.", "audio"],
    ["proximity", "Proximity and Light Sensor", "Sensor flex for auto brightness and call screen-off.", "audio"],
    ["jack", "Headphone Jack Module", "3.5 mm jack with flex for budget models.", "audio"],
    ["nfc", "NFC Antenna", "NFC coil for tap-to-pay, signal tested.", "audio"],
    ["vapour", "Vapour Chamber", "Copper heat spreader for sustained performance.", "hw"],
    ["adhesive", "Adhesive and Waterproof Seals", "Die-cut display, back and battery adhesive sets.", "hw"]
  ];
  const GRADE_NOTES = { Genuine: "Original brand parts sourced through authorised channels, with full traceability.", Premium: "High quality compatible part, matched to the original for fit, finish and performance.", Standard: "Reliable everyday part at a balanced cost, checked for fit and function." };
  const STEPS = [
    ["Tell us the part", "Tap a part here, or send a text, a photo of the slip or a voice note."],
    ["Get one price", "One total with delivery included. No freight maths, no surprises."],
    ["Pay 20% advance", "Our team verifies it by hand and issues your 9-digit Order ID."],
    ["Video, then dispatch", "You see a packing video, pay the balance, and it travels to your shop by bus, courier or local parcel."]
  ];
  const PILLARS = [
    ["Payments checked by people", "Every advance and balance is verified by a member of our team.", '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>'],
    ["Packing video first", "We record your packed order and send it before you pay the balance.", '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10 5-3v10l-5-3"/>'],
    ["Tracked to your shop", "Follow every hand-off, from quote to your shop counter, with one ID.", '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>']
  ];
  const FAQS = [
    ["How do I order?", "Pick your phone above and tap the part. The enquiry opens in our Telegram, already typed, so you only press send. If Telegram is not on your phone, it opens in WhatsApp instead. You can also send a photo of your part slip or a voice note."],
    ["Is delivery included in the price?", "Yes. You get one total with delivery included, so you know the full cost before you confirm."],
    ["How do payment and verification work?", "Pay a 20% advance once you accept the quote. Our team verifies it and issues your 9-digit Order ID. The 80% balance is paid after you receive the packing video, before dispatch."],
    ["What do Genuine, Premium and Standard mean?", "Genuine is the original brand part, sourced through authorised channels. Premium is a high quality compatible part matched to the original. Standard is a reliable everyday part at a balanced cost. Every grade is checked for fit and function before dispatch."],
    ["Do you supply genuine Apple parts?", "Yes. As " + CONFIG.appleLabel + ", we supply genuine Apple parts through authorised channels. Choose the Genuine grade and tap the part, and the desk will confirm stock and price for your model."],
    ["How does the 25% Telegram offer work?", "Orders placed through our Telegram desk get 25% off the quoted total while the offer runs. It is applied to your quote automatically."],
    ["Which brands do you supply?", "All the brands India repairs most, including Samsung, Vivo, OPPO, Realme, Redmi, Xiaomi, POCO, Apple, OnePlus, iQOO, Motorola, Infinix, Tecno, itel, Lava, Nothing and more."],
    ["Where do you deliver?", "Across India, right to your shop. Each parcel goes by bus, courier or local parcel, whichever is fastest for your area. Ask the desk for a timeline."]
  ];
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const I = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const waUrl = (t) => "https://wa.me/91" + CONFIG.whatsapp + (t ? "?text=" + encodeURIComponent(t) : "");
  const tgWeb = (t) => "https://t.me/" + TG + (t ? "?text=" + encodeURIComponent(t) : "");
  const tgApp = (t) => "tg://resolve?domain=" + TG + (t ? "&text=" + encodeURIComponent(t) : "");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = () => innerWidth < 760;
  function toast(m) {
    const t = $("#toast");
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }
  let scrollAnim = null;
  function cancelScroll() {
    if (scrollAnim) {
      cancelAnimationFrame(scrollAnim);
      scrollAnim = null;
    }
  }
  ["wheel", "touchstart", "keydown"].forEach((ev) => addEventListener(ev, cancelScroll, { passive: true }));
  function smoothTo(y) {
    y = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
    if (reduce) {
      scrollTo(0, y);
      return;
    }
    cancelScroll();
    const y0 = scrollY, d = y - y0;
    if (Math.abs(d) < 2) return;
    const dur = Math.min(950, Math.max(420, Math.abs(d) * 0.45)), t0 = performance.now();
    const e = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      scrollTo(0, y0 + d * e(k));
      scrollAnim = k < 1 ? requestAnimationFrame(step) : null;
    };
    scrollAnim = requestAnimationFrame(step);
  }
  function safeBox() {
    const top = ($("#nav").getBoundingClientRect().bottom || 72) + 14;
    const bar2 = $("#dockBar"), bh = bar2.classList.contains("show") ? bar2.offsetHeight + 22 : 0;
    return { top, bottom: innerHeight - 14 - bh };
  }
  function bring(el, { pulse = true, force = false, align = "center" } = {}) {
    if (!el) return;
    const r = el.getBoundingClientRect(), { top, bottom } = safeBox(), room = bottom - top;
    const fits = r.top >= top && r.bottom <= bottom;
    if (!fits || force) {
      let y;
      if (r.height > room || align === "top") y = scrollY + r.top - top;
      else y = scrollY + r.top - top - (room - r.height) / 2;
      smoothTo(y);
    }
    if (pulse) {
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    }
  }
  function goTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const off = id === "top" ? 0 : $("#nav").offsetHeight + 28;
    smoothTo(el.getBoundingClientRect().top + scrollY - (id === "top" ? 0 : off * 0.6));
  }
  document.querySelectorAll(".foot-label").forEach((e) => e.textContent = CONFIG.appleLabel);
  $$(".wa-link").forEach((a) => a.href = waUrl("Hello AD PARTSOL, I want to place a wholesale order."));
  $$(".tg-link").forEach((a) => a.href = tgWeb("Hello AD PARTSOL, I want to place a wholesale order."));
  const bnames = BRANDS.map((b) => b[0]);
  $("#brandsTrack").innerHTML = [0, 1].map((k) => `<div class="bt-set"${k ? ' aria-hidden="true"' : ""}>${bnames.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`).join("");
  $$(".split").forEach((h) => {
    const words = h.textContent.trim().split(/\s+/);
    h.setAttribute("aria-label", h.textContent.trim());
    h.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true"><span style="--i:${i}">${esc(w)}</span></span>`).join(" ");
  });
  $("#steps").innerHTML = STEPS.map((s, i) => `<li class="stp rv tilt" style="--d:${i}"><div class="stp-in"><span class="num">0${i + 1}</span><h3>${esc(s[0])}</h3><p>${esc(s[1])}</p></div></li>`).join("");
  $("#pillars").innerHTML = PILLARS.map((p, i) => `<div class="pillar-cell rv" style="--d:${i}"><div class="pillar g3d"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p[2]}</svg></div><h3>${esc(p[0])}</h3><p>${esc(p[1])}</p></div></div>`).join("");
  $("#faqList").innerHTML = FAQS.map((f, i) => `<div class="fq rv" style="--d:${Math.min(i, 4)}"><button class="fq-q" aria-expanded="false" aria-controls="fa${i}" id="fq${i}"><span>${esc(f[0])}</span><i class="pm" aria-hidden="true"></i></button><div class="fq-a" id="fa${i}" role="region" aria-labelledby="fq${i}"><div><p>${esc(f[1])}</p></div></div></div>`).join("");
  $$(".fq-q").forEach((b) => b.addEventListener("click", () => {
    const it = b.parentElement, open = !it.classList.contains("open");
    $$(".fq.open").forEach((x) => {
      x.classList.remove("open");
      x.querySelector(".fq-q").setAttribute("aria-expanded", "false");
    });
    if (open) {
      it.classList.add("open");
      b.setAttribute("aria-expanded", "true");
      setTimeout(() => bring(it, { pulse: false }), 420);
    }
  }));
  const contacts = [["Telegram", "@" + TG, tgWeb()], ["WhatsApp", "+91 " + CONFIG.whatsapp, waUrl()], ["Email", CONFIG.email, "mailto:" + CONFIG.email], ["Hours", CONFIG.hours, null]];
  $("#footContact").innerHTML = contacts.map((c) => c[2] ? `<a href="${c[2]}"${c[2].startsWith("http") ? ' target="_blank" rel="noopener"' : ""}><span>${c[0]}</span><b>${esc(c[1])}</b></a>` : `<div><span>${c[0]}</span><b>${esc(c[1])}</b></div>`).join("");
  const state = { brand: "", model: "", grade: "Genuine", qty: 5 };
  const ORDER = ["brand", "model", "grade", "qty"];
  let active = "brand";
  const picker = $("#picker");
  $$(".step-body", picker).forEach((b) => {
    const w = document.createElement("div");
    w.className = "sb-in";
    while (b.firstChild) w.appendChild(b.firstChild);
    b.appendChild(w);
  });
  const DDS = [];
  function Dropdown(el, o) {
    el.classList.add("dd");
    el.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="dd-val"></span>${I("down")}</button>
  <div class="dd-pop"><div class="dd-pi">${o.search ? `<label class="dd-search">${I("search")}<input type="text" ${o.numeric ? 'inputmode="numeric"' : ""} placeholder="${esc(o.searchPh || "Search")}" aria-label="${esc(o.searchPh || "Search")}" autocomplete="off"></label>` : ""}<ul class="dd-list" role="listbox" tabindex="-1"></ul></div></div>`;
    const btn = $(".dd-btn", el), val = $(".dd-val", el), list = $(".dd-list", el), inp = $(".dd-search input", el);
    let hi = -1, shown = [];
    const api = {
      el,
      open: false,
      render() {
        const q = (inp?.value || "").trim().toLowerCase(), cur = o.value();
        shown = o.items().filter((it) => !q || it[2] || String(it[1]).toLowerCase().includes(q));
        list.innerHTML = shown.length ? shown.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${it[0] === cur}" class="${it[2] ? "dd-other" : ""}">${it[2] ? I("edit") : ""}<span>${esc(it[1])}</span>${it[0] === cur ? I("check") : ""}</li>`).join("") : `<li class="dd-empty">No match</li>`;
        hi = -1;
      },
      label() {
        const v = o.value(), it = v ? o.items().find((x) => x[0] === v) : null;
        val.textContent = it ? it[1] : v || o.placeholder;
        el.classList.toggle("has", !!v);
      },
      show() {
        DDS.forEach((d) => d !== api && d.hide());
        api.open = true;
        el.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
        if (inp) inp.value = "";
        api.render();
        const sel = list.querySelector('[aria-selected="true"]');
        if (sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
        else list.scrollTop = 0;
        setTimeout(() => {
          bring(el, { pulse: false, align: "top" });
          if (inp && !isMobile()) inp.focus({ preventScroll: true });
        }, 260);
      },
      hide() {
        if (!api.open) return;
        api.open = false;
        el.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      },
      pick(i) {
        const it = shown[i];
        if (!it) return;
        api.hide();
        o.onPick(it[0], it);
        api.label();
      }
    };
    btn.addEventListener("click", () => api.open ? api.hide() : api.show());
    list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]");
      if (li) api.pick(+li.dataset.i);
    });
    inp?.addEventListener("input", api.render);
    el.addEventListener("keydown", (e) => {
      if (!api.open) return;
      const n = shown.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        $$("[data-i]", list).forEach((li, i) => li.classList.toggle("hi", i === hi));
        list.querySelector(".hi")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        api.pick(hi < 0 ? 0 : hi);
      } else if (e.key === "Escape") {
        api.hide();
        btn.focus();
      }
    });
    DDS.push(api);
    api.label();
    return api;
  }
  document.addEventListener("pointerdown", (e) => {
    DDS.forEach((d) => {
      if (d.open && !d.el.contains(e.target)) d.hide();
    });
  });
  const OTHER = "__other";
  const ddBrand = Dropdown($("#ddBrand"), {
    placeholder: "Select your brand",
    search: true,
    searchPh: "Search brand",
    items: () => [...BRANDS.map((b) => [b[0], b[0]]), [OTHER, "Other brand, type it", 1]],
    value: () => BRANDS.some((b) => b[0] === state.brand) ? state.brand : state.brand ? OTHER : "",
    onPick(v) {
      if (v === OTHER) {
        $("#brandForm").hidden = false;
        setTimeout(() => {
          $("#brandInput").focus();
          bring($("#brandForm"), { pulse: false });
        }, 120);
        return;
      }
      $("#brandForm").hidden = true;
      if (state.brand !== v) {
        state.brand = v;
        state.model = "";
        $("#modelInput").value = "";
      }
      afterBrand();
    }
  });
  function afterBrand() {
    renderModels();
    syncSummary();
    wave();
    setActive("model");
    const b = BRANDS.find((x) => x[0] === state.brand);
    if (!b || !b[1].length) {
      $("#modelForm").hidden = false;
    } else $("#modelForm").hidden = true;
  }
  $("#brandForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#brandInput").value.trim().slice(0, 30);
    if (!v) {
      $("#brandInput").focus();
      return;
    }
    $("#brandInput").blur();
    if (state.brand !== v) {
      state.brand = v;
      state.model = "";
      $("#modelInput").value = "";
    }
    ddBrand.label();
    afterBrand();
  });
  const ddModel = Dropdown($("#ddModel"), {
    placeholder: "Select your model",
    search: true,
    searchPh: "Search model",
    items: () => {
      const b = BRANDS.find((x) => x[0] === state.brand), ms = b ? b[1] : [];
      return [...ms.map((m) => [m, (state.brand === "Apple" || state.brand === "Google Pixel" ? "" : state.brand + " ") + m]), [OTHER, "Other model, type it", 1], ["", "Not sure, any model"]];
    },
    value: () => {
      const b = BRANDS.find((x) => x[0] === state.brand);
      return b && b[1].includes(state.model) ? state.model : state.model ? OTHER : "";
    },
    onPick(v) {
      if (v === OTHER) {
        $("#modelForm").hidden = false;
        setTimeout(() => {
          $("#modelInput").focus();
          bring($("#modelForm"), { pulse: false });
        }, 120);
        return;
      }
      $("#modelForm").hidden = true;
      state.model = v;
      $("#modelInput").value = v;
      syncSummary();
      wave();
      setActive("grade");
    }
  });
  const ddQty = Dropdown($("#ddQty"), {
    placeholder: "Select pieces",
    search: true,
    numeric: true,
    searchPh: "Type a number, 1 to 100",
    items: () => {
      const q = ($("#ddQty .dd-search input")?.value || "").trim();
      return Array.from({ length: 100 }, (_, i) => i + 1).filter((n) => !q || String(n).startsWith(q)).map((n) => [n, n + (n === 1 ? " piece" : " pieces")]);
    },
    value: () => state.qty,
    onPick(v) {
      state.qty = v;
      syncSummary();
      setTimeout(finish, 240);
    }
  });
  function stepEl(s) {
    return picker.querySelector(`[data-step="${s}"]`);
  }
  function setActive(s, { scroll = true } = {}) {
    active = s;
    ORDER.forEach((k) => {
      const el = stepEl(k);
      el.classList.toggle("on", k === s);
      el.classList.toggle("done", k !== s);
    });
    picker.classList.toggle("complete", !s);
    if (s === "model") setTimeout(() => {
      if (!isMobile()) $("#modelInput").focus({ preventScroll: true });
    }, 380);
    if (scroll && s) setTimeout(() => bring(stepEl(s), { pulse: true }), 400);
  }
  function summary() {
    const dev = [state.brand, state.model].filter(Boolean).join(" ");
    return { dev: dev || "Any phone", line: `${dev || "Any phone"}, ${state.grade}, ${state.qty} pcs` };
  }
  function syncSummary() {
    $("#sumBrand").textContent = state.brand || "Choose";
    $("#sumModel").textContent = state.model || "Any";
    $("#sumGrade").textContent = state.grade;
    $("#sumQty").textContent = state.qty + " pcs";
    const s = summary();
    $$(".p-for").forEach((el) => {
      el.textContent = s.line;
    });
    $("#dbText").textContent = state.brand ? s.line : "Choose your phone";
    ddBrand?.label();
    ddModel?.label();
    ddQty?.label();
    $$("#gradeSeg button").forEach((b) => b.setAttribute("aria-checked", b.dataset.g === state.grade));
    $("#gradeNote").textContent = GRADE_NOTES[state.grade];
    document.getElementById("partsGrid")?.classList.toggle("genuine", state.grade === "Genuine");
  }
  function wave() {
    const g = $("#partsGrid");
    g.classList.remove("wave");
    void g.offsetWidth;
    g.classList.add("wave");
  }
  function renderModels() {
    const b = BRANDS.find((x) => x[0] === state.brand), ms = b ? b[1] : [];
    $("#modelInput").placeholder = ms.length ? `e.g. ${ms[0]}` : "Type the model";
    ddModel.label();
  }
  $("#modelForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.model = $("#modelInput").value.trim().slice(0, 40);
    $("#modelInput").blur();
    ddModel.label();
    syncSummary();
    wave();
    setActive("grade");
  });
  $("#gradeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    state.grade = b.dataset.g;
    syncSummary();
    wave();
    setTimeout(() => setActive("qty"), 260);
  });
  $("#qtyDone").addEventListener("click", finish);
  function finish() {
    setActive(null, { scroll: false });
    wave();
    setTimeout(() => {
      bring($("#partsGrid"), { pulse: false, force: true, align: "top" });
      toast("Now tap the part you need");
    }, 380);
  }
  picker.addEventListener("click", (e) => {
    const s = e.target.closest(".step-sum");
    if (s) setActive(s.dataset.edit);
  });
  $("#dbSum").addEventListener("click", () => {
    const s = state.brand ? "brand" : "brand";
    setActive(s, { scroll: false });
    setTimeout(() => bring(picker, { align: "top", force: true }), 400);
  });
  $("#partsGrid").innerHTML = PARTS.map((p, i) => `<button type="button" class="part tilt rv" style="--d:${i % 4}" data-id="${p[0]}" data-cat="${p[3]}" aria-label="Send enquiry for ${esc(p[1])}">
  <span class="p-in"><span class="p-badge">Genuine</span><span class="p-art" data-art="${p[0]}"><i class="p-sk" aria-hidden="true"></i><span class="p-360" aria-hidden="true">${I("rotate")}</span></span>
  <span class="p-name">${esc(p[1])}</span><span class="p-desc">${esc(p[2])}</span>
  <span class="p-foot"><span class="p-for"></span><span class="p-go">${I("tg")}</span></span></span><i class="sheen" aria-hidden="true"></i></button>`).join("") + `<button type="button" class="part part-custom tilt rv" data-id="custom" data-cat="any" aria-label="Part not listed, tell us what you need">
  <span class="p-in"><span class="p-art pc-art"><svg viewBox="0 0 120 120" aria-hidden="true"><rect x="30" y="14" width="60" height="92" rx="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M50 22h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M60 46v28M46 60h28" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></span>
  <span class="p-name">Not listed?</span><span class="p-desc">Tell us the part and the model. We will source it for you.</span>
  <span class="p-foot"><span class="p-for">Custom request</span><span class="p-go">${I("edit")}</span></span></span><i class="sheen" aria-hidden="true"></i></button>`;
  $("#partCats").innerHTML = CATS.map((c, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-c="${c[0]}">${esc(c[1])}</button>`).join("");
  $("#partCats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    const c = b.dataset.c;
    $$("#partCats button").forEach((x) => x.setAttribute("aria-selected", x === b));
    b.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
    const g = $("#partsGrid");
    g.classList.add("filtering");
    setTimeout(() => {
      let n = 0;
      $$(".part", g).forEach((el) => {
        const on = c === "all" || el.dataset.cat === c || el.dataset.cat === "any";
        el.hidden = !on;
        if (on) {
          el.style.setProperty("--d", n % 4);
          n++;
          el.classList.add("in");
        }
      });
      g.scrollLeft = 0;
      g.classList.remove("filtering");
      railSync();
      setTimeout(() => bring($(".cats-wrap"), { pulse: false, force: true, align: "top" }), 60);
    }, reduce ? 0 : 220);
  });
  const rail = $("#partsGrid");
  let railRaf = 0;
  function railSync() {
    cancelAnimationFrame(railRaf);
    railRaf = requestAnimationFrame(() => {
      const max = rail.scrollWidth - rail.clientWidth, p = max > 0 ? rail.scrollLeft / max : 0;
      $("#railFill").style.transform = `scaleX(${Math.max(0.04, p).toFixed(4)})`;
      const vis = $$(".part", rail).filter((el) => !el.hidden), rr = rail.getBoundingClientRect(), mid = rr.left + rr.width / 2;
      let first = 0;
      vis.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.right > rr.left + 8 && !first) first = i + 1;
        if (r.right < rr.left - 40 || r.left > rr.right + 40) return;
        const k = Math.max(-1, Math.min(1, (r.left + r.width / 2 - mid) / (rr.width * 0.62)));
        el.style.setProperty("--cy", (k * -14).toFixed(2) + "deg");
        el.style.setProperty("--cz", (Math.abs(k) * -40).toFixed(1) + "px");
      });
      if (p > 0.995) first = vis.length;
      $("#railCount").textContent = String(first || 1).padStart(2, "0") + " / " + String(vis.length).padStart(2, "0");
      $("#railPrev").disabled = rail.scrollLeft < 4;
      $("#railNext").disabled = rail.scrollLeft > max - 4;
    });
  }
  rail.addEventListener("scroll", railSync, { passive: true });
  addEventListener("resize", railSync);
  const railStep = (dir) => {
    const c = $(".part:not([hidden])", rail);
    const w = c ? c.getBoundingClientRect().width + 14 : 300;
    rail.scrollBy({ left: dir * w * (innerWidth < 760 ? 1 : 2), behavior: reduce ? "auto" : "smooth" });
  };
  $("#railPrev").onclick = () => railStep(-1);
  $("#railNext").onclick = () => railStep(1);
  {
    let d = null;
    rail.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button) return;
      d = { x: e.clientX, s: rail.scrollLeft, m: false };
    });
    addEventListener("pointermove", (e) => {
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.m && Math.abs(dx) > 6) {
        d.m = true;
        rail.classList.add("dragging");
      }
      if (d.m) rail.scrollLeft = d.s - dx;
    });
    addEventListener("pointerup", () => {
      if (!d) return;
      if (d.m) {
        rail.dataset.drag = "1";
        setTimeout(() => {
          rail.dataset.drag = "";
        }, 60);
        const s = rail.scrollLeft;
        rail.classList.remove("dragging");
        rail.scrollLeft = s;
      }
      d = null;
    });
  }
  railSync();
  $("#partsGrid").addEventListener("click", (e) => {
    const c = e.target.closest(".part");
    if (!c) return;
    if ($("#partsGrid").dataset.drag === "1") return;
    openSheet(c.dataset.id, c);
  });
  let lastFocus = null, typeTimer = null, fallTimer = null;
  function compose(p) {
    const L = ["Hello AD PARTSOL, I need a wholesale quote.", "", `Part: ${p[1]}`, `Brand: ${state.brand || "Will share"}`, `Model: ${state.model || "Will share"}`, `Grade: ${state.grade}`, `Quantity: ${state.qty} pcs`, "", "Please share the total price with delivery."];
    return L.join("\n");
  }
  function openSheet(id, card) {
    const custom = id === "custom";
    const p = custom ? ["custom", "Part not listed", "", "any"] : PARTS.find((x) => x[0] === id);
    if (!p) return;
    lastFocus = document.activeElement;
    const sheet = $("#sheet");
    sheet.classList.toggle("custom", custom);
    $("#shTitle").textContent = custom ? "Tell us the part" : p[1];
    $("#shMeta").textContent = summary().line;
    $("#shWa").classList.remove("btn-dark");
    $("#shWa").classList.add("btn-light");
    sheet.classList.add("open");
    $("#scrim").classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("locked");
    clearInterval(typeTimer);
    clearTimeout(fallTimer);
    $("#shText").textContent = "";
    if (custom) {
      $("#shCustom").hidden = false;
      $("#shPart").value = "";
      status("");
      $("#shTg").href = tgWeb(compose(["custom", "Custom part"]));
      $("#shWa").href = waUrl(compose(["custom", "Custom part"]));
      window.ADP3D?.stopSheet();
      setTimeout(() => $("#shPart").focus({ preventScroll: true }), 320);
      return;
    }
    $("#shCustom").hidden = true;
    window.ADP3D?.sheet(id, $("#shCv"));
    setTimeout(() => $("#shClose").focus({ preventScroll: true }), 60);
    type(compose(p));
  }
  function type(text) {
    $("#shTg").href = tgWeb(text);
    $("#shWa").href = waUrl(text);
    navigator.clipboard?.writeText(text).catch(() => {
    });
    const out = $("#shText");
    out.textContent = "";
    clearInterval(typeTimer);
    clearTimeout(fallTimer);
    status("Typing your enquiry");
    if (reduce) {
      out.textContent = text;
      launch(text);
      return;
    }
    let n = 0;
    const per = Math.max(4, Math.ceil(text.length / 22));
    typeTimer = setInterval(() => {
      n += per;
      out.textContent = text.slice(0, n);
      if (n >= text.length) {
        clearInterval(typeTimer);
        launch(text);
      }
    }, 24);
  }
  $("#shCustom").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#shPart").value.trim().slice(0, 60);
    if (!v) {
      $("#shPart").focus();
      return;
    }
    $("#shPart").blur();
    $("#shCustom").hidden = true;
    $("#shTitle").textContent = v;
    type(compose(["custom", v + " (not listed)"]));
  });
  function status(m, cls = "") {
    const s = $("#shStatus");
    s.textContent = m;
    s.className = "sh-status " + cls;
  }
  function launch(text) {
    let left = false;
    const mark = () => {
      left = true;
    };
    addEventListener("blur", mark, { once: true });
    document.addEventListener("visibilitychange", mark, { once: true });
    status("Opening Telegram", "busy");
    try {
      const a = document.createElement("a");
      a.href = tgApp(text);
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {
    }
    fallTimer = setTimeout(() => {
      removeEventListener("blur", mark);
      document.removeEventListener("visibilitychange", mark);
      if (left) {
        status("Opened in Telegram. Press send to deliver it.", "ok");
        return;
      }
      let w = null;
      try {
        w = window.open(waUrl(text), "_blank");
      } catch (_) {
      }
      if (w) {
        try {
          w.opener = null;
        } catch (_) {
        }
        ;
        status("Telegram not found, so it opened in WhatsApp.", "ok");
      } else status("Telegram did not open. Use WhatsApp below.", "warn");
      $("#shWa").classList.remove("btn-light");
      $("#shWa").classList.add("btn-dark");
    }, 1700);
  }
  function closeSheet() {
    clearInterval(typeTimer);
    clearTimeout(fallTimer);
    window.ADP3D?.stopSheet();
    const sheet = $("#sheet");
    sheet.classList.remove("open");
    $("#scrim").classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("locked");
    lastFocus?.focus?.({ preventScroll: true });
  }
  $("#shClose").onclick = closeSheet;
  $("#scrim").onclick = closeSheet;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#sheet").classList.contains("open")) closeSheet();
  });
  $("#shTg").addEventListener("click", () => {
    clearTimeout(fallTimer);
    status("Opened in Telegram. Press send to deliver it.", "ok");
  });
  $("#shWa").addEventListener("click", () => {
    clearTimeout(fallTimer);
    status("Opened in WhatsApp. Press send to deliver it.", "ok");
  });
  window.ADP = { PARTS, openPart(id) {
    if (!id) return;
    const card = document.querySelector(`.part[data-id="${id}"]`);
    openSheet(id, card);
  } };
  document.dispatchEvent(new CustomEvent("adp-ready"));
  const TRACK_STAGES = [
    { keys: ["ORDER_RECEIVED", "COLLECTING_PRICES", "QUOTED", "BIDDING", "SUBMITTED", "PENDING", "CONFIRMATION_PENDING", "NEEDS_SOURCING_REVIEW", "OUTSOURCE_REVIEW", "PIGGYBACK_QUEUED", "WE_ARE_COLLECTING", "COLLECTING"], label: "Order received", note: "Quote shared and advance verified" },
    { keys: ["COLLECTION_DONE", "CHECKING_HUB", "PACKING", "ON_HOLD"], label: "Parts collected", note: "Parts collected from stock" },
    { keys: ["QC_PASSED", "PACKAGED_AND_LABELLED", "AWAITING_80_PAYMENT"], label: "Quality check passed", note: "Checked, packed and packing video sent" },
    { keys: ["DISPATCH_HANDOVER", "READY_TO_SHIP", "OUT_FOR_BUS_STAND"], label: "Handed to dispatch", note: "Balance cleared and parcel handed to dispatch" },
    { keys: ["BUS_STAND_DROPPED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"], label: "Shipped", note: "Parcel is on its way to your shop" }
  ];
  const TRACK_CLOSED = ["DECLINED", "NO_BIDS", "CANCELLED", "REJECTED"];
  const Tracker = (() => {
    const LAST = TRACK_STAGES.length - 1, MIN_WAIT = 450, TIMEOUT = 12e3;
    const base = String(CONFIG.apiBase || "").replace(/\/+$/, ""), path = CONFIG.endpoints && CONFIG.endpoints.track || "/api/panel/track";
    const form = $("#trackForm"), input = $("#oidInput"), btn = form.querySelector('button[type="submit"]'), err = $("#trkErr"), card = $("#tracker"), help = $("#trkHelp");
    let ctl = null, lastId = "";
    const grp = (id) => String(id).replace(/(\d{3})(?=\d)/g, "$1 ");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fmt = (t) => {
      const n = Number(t);
      if (!n) return "";
      const d = new Date(n < 1e12 ? n * 1e3 : n);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    };
    const inr = (v) => v === null || v === void 0 || v === "" || !Number.isFinite(Number(v)) ? "" : "\u20B9" + Number(v).toLocaleString("en-IN");
    const stageOf = (v) => TRACK_STAGES.findIndex((s) => s.keys.includes(String(v || "").trim().toUpperCase()));
    const reached = (o) => Math.max(0, stageOf(o.dispatch_stage), stageOf(o.status));
    const deskLinks = (id) => {
      const m = "Hello, I need help tracking order " + id;
      return `<span class="trk-err-acts"><a href="${esc(tgWeb(m))}" target="_blank" rel="noopener">Ask on Telegram</a><a href="${esc(waUrl(m))}" target="_blank" rel="noopener">WhatsApp</a></span>`;
    };
    const replay = (el, cls) => {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    };
    function setBusy(on) {
      btn.disabled = on;
      btn.classList.toggle("is-loading", on);
      btn.setAttribute("aria-busy", String(on));
      card.setAttribute("aria-busy", String(on));
    }
    function showError(html) {
      card.hidden = true;
      card.classList.remove("shown");
      card.innerHTML = "";
      err.innerHTML = `<svg class="i trk-err-ic" aria-hidden="true"><use href="#i-alert"/></svg><div class="trk-err-body">${html}</div>`;
      err.hidden = false;
      replay(err, "pop");
      bring(err);
    }
    function hideError() {
      if (!err.hidden) {
        err.hidden = true;
        err.innerHTML = "";
      }
    }
    function showLoading(id) {
      hideError();
      card.classList.remove("shown");
      card.hidden = false;
      card.innerHTML = `<div class="trk-load" role="status"><svg class="i spin" aria-hidden="true"><use href="#i-spin"/></svg><span>Looking up order <b>${esc(grp(id))}</b></span></div>`;
      replay(card, "pop");
      bring(card, { pulse: false });
    }
    function stageRow(st, i, s) {
      const done = i <= s, now = !done && i === s + 1;
      return `<li class="stage${done ? " done" : now ? " now" : ""}" style="--i:${i}"${now ? ' aria-current="step"' : ""}><span class="node">${done ? I("check") : "0" + (i + 1)}</span><b>${esc(st.label)}</b><small>${done ? "Complete" : now ? "In progress" : "Pending"}</small></li>`;
    }
    function summary2(o) {
      const rows = [["Order total", inr(o.final_total)], ["Advance 20%", inr(o.advance_20)], ["Balance 80%", inr(o.balance_80)], ["Tracking ID", o.tracking_id ? String(o.tracking_id) : ""]].filter((r) => r[1]);
      return rows.length ? `<dl class="trk-meta">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : "";
    }
    function itemList(items) {
      if (!items.length) return "";
      return `<div class="trk-items"><h4>Parts in this order</h4><ul>${items.map((it) => {
        const phone = [it.brand, it.model].filter(Boolean).join(" "), grade = it.variant ? String(it.variant) : "";
        const req = Number(it.req_qty) || 0, got = Number(it.fulfilled_qty) || 0;
        return `<li><div><b>${esc(it.part_name || "Spare part")}</b><span>${esc(phone)}${phone && grade ? " / " : ""}${esc(grade)}</span></div><em class="${req && got >= req ? "full" : ""}">${got} of ${req}</em></li>`;
      }).join("")}</ul></div>`;
    }
    function render(data) {
      const o = data.order, items = Array.isArray(data.items) ? data.items : [], s = reached(o);
      const id = String(o.id ?? lastId).padStart(9, "0"), placed = fmt(o.created_at);
      const closed = TRACK_CLOSED.includes(String(o.status || "").toUpperCase());
      card.innerHTML = `<div class="trk-head"><b>${esc(grp(id))}</b>${placed ? `<span>Placed ${esc(placed)}</span>` : ""}<em class="pill-status">${closed ? "Closed" : esc(TRACK_STAGES[s].label)}</em></div>
<ol class="stages" style="--prog:${s / LAST}">${TRACK_STAGES.map((st, i) => stageRow(st, i, s)).join("")}</ol>
<p class="hint">${closed ? "This order is closed. Message the desk to reopen or place a fresh request" : esc(TRACK_STAGES[s].note) + ". Updated by our team at each hand-off"}.</p>${(o.hold_reason || [o.status, o.dispatch_stage].includes("ON_HOLD")) && !closed ? `<p class="hint trk-hold">On hold${o.hold_reason ? ": " + esc(o.hold_reason) : ", our team will update you shortly"}</p>` : ""}${summary2(o)}${itemList(items)}`;
      card.classList.remove("pop", "shown");
      card.hidden = false;
      void card.offsetWidth;
      requestAnimationFrame(() => {
        card.classList.add("shown");
        bring(card);
      });
    }
    async function request(id, signal) {
      const r = await fetch(`${base}${path}?order_id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, cache: "no-store", signal });
      const j = await r.json().catch(() => null);
      if (r.status === 404 || r.status < 500 && j && j.ok === false) return null;
      if (!r.ok || !j) throw new Error("HTTP " + r.status);
      return j.ok !== false && j.order ? j : null;
    }
    async function track(raw) {
      const id = String(raw || "").replace(/\D/g, "");
      if (ctl) ctl.abort();
      if (!/^\d{9}$/.test(id)) {
        setBusy(false);
        showError("Enter the full 9-digit Order ID the desk sent you.");
        return;
      }
      lastId = id;
      const mine = new AbortController();
      ctl = mine;
      const timer = setTimeout(() => mine.abort(), TIMEOUT);
      setBusy(true);
      showLoading(id);
      try {
        const [data] = await Promise.all([request(id, mine.signal), wait(MIN_WAIT)]);
        if (ctl !== mine) return;
        if (data) render(data);
        else showError(`No order found for <b>${esc(grp(id))}</b>. Order IDs are issued after the desk verifies your advance.${deskLinks(id)}`);
      } catch (e) {
        if (ctl !== mine) return;
        showError(`Tracking is unreachable right now. <button type="button" class="trk-retry" data-retry>Try again</button>${deskLinks(id)}`);
      } finally {
        clearTimeout(timer);
        if (ctl === mine) {
          ctl = null;
          setBusy(false);
        }
      }
    }
    function init() {
      if (help) help.href = tgWeb("Hello, I need my Order ID");
      input.addEventListener("input", () => {
        const v = input.value.replace(/\D/g, "").slice(0, 9);
        if (v !== input.value) input.value = v;
        hideError();
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        input.blur();
        track(input.value);
      });
      err.addEventListener("click", (e) => {
        if (e.target.closest("[data-retry]")) track(lastId);
      });
      const q = new URLSearchParams(location.search).get("order_id");
      if (q && /^\d{9}$/.test(q)) {
        input.value = q;
        track(q);
      }
    }
    return { init, track };
  })();
  Tracker.init();
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const el = e.target;
    if (e.isIntersecting) {
      el.dataset.from = e.boundingClientRect.top < innerHeight / 2 ? "top" : "bottom";
      requestAnimationFrame(() => el.classList.add("in"));
    } else {
      el.classList.remove("in");
      el.dataset.from = e.boundingClientRect.top < 0 ? "top" : "bottom";
    }
  }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  $$(".rv,.split").forEach((el) => {
    if (!el.closest(".hero")) io.observe(el);
  });
  requestAnimationFrame(() => $$(".hero .split").forEach((h) => h.classList.add("in")));
  const fine = matchMedia("(hover:hover) and (pointer:fine)").matches;
  if (!reduce) {
    document.addEventListener("pointermove", (e) => {
      if (!fine) return;
      const t = e.target.closest(".tilt");
      $$(".tilt.tilting").forEach((x) => {
        if (x !== t) {
          x.classList.remove("tilting");
          x.style.removeProperty("--rx");
          x.style.removeProperty("--ry");
        }
      });
      if (!t) return;
      const r = t.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      t.classList.add("tilting");
      t.style.setProperty("--rx", ((0.5 - py) * 9).toFixed(2) + "deg");
      t.style.setProperty("--ry", ((px - 0.5) * 11).toFixed(2) + "deg");
      t.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      t.style.setProperty("--my", (py * 100).toFixed(1) + "%");
    }, { passive: true });
    document.addEventListener("pointerleave", () => $$(".tilt.tilting").forEach((x) => x.classList.remove("tilting")));
  }
  (function() {
    const G = window.__tilt = { x: 0, y: 0, tx: 0, ty: 0, gyro: false };
    if (reduce) return;
    const root = document.documentElement, cl = (v, a) => Math.max(-a, Math.min(a, v));
    let base = null, lastEv = 0;
    function onOri(e) {
      if (e.beta == null || e.gamma == null) return;
      let b = e.beta, g = e.gamma;
      const ang = screen.orientation && screen.orientation.angle || window.orientation || 0;
      if (ang === 90) {
        const t = b;
        b = -g;
        g = t;
      } else if (ang === -90 || ang === 270) {
        const t = b;
        b = g;
        g = -t;
      }
      if (!base) base = { b, g };
      base.b += (b - base.b) * 6e-3;
      base.g += (g - base.g) * 6e-3;
      G.tx = cl((g - base.g) / 22, 1);
      G.ty = cl((b - base.b) / 22, 1);
      lastEv = performance.now();
      if (!G.gyro) {
        G.gyro = true;
        root.classList.add("gyro");
      }
    }
    const start = () => addEventListener("deviceorientation", onOri, { passive: true });
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const ask = () => {
        DOE.requestPermission().then((s) => {
          if (s === "granted") start();
        }).catch(() => {
        });
        off();
      };
      const off = () => {
        removeEventListener("touchend", ask, true);
        removeEventListener("click", ask, true);
      };
      addEventListener("touchend", ask, true);
      addEventListener("click", ask, true);
    } else if (DOE) {
      start();
    }
    if (fine) {
      addEventListener("pointermove", (e) => {
        if (G.gyro) return;
        G.tx = (e.clientX / innerWidth - 0.5) * 1.2;
        G.ty = (e.clientY / innerHeight - 0.5) * 1.2;
      }, { passive: true });
      document.addEventListener("pointerleave", () => {
        if (!G.gyro) {
          G.tx = 0;
          G.ty = 0;
        }
      });
    }
    let px = 9, py = 9, lt = performance.now();
    (function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lt) / 1e3);
      lt = now;
      if (G.gyro && now - lastEv > 1500) {
        G.tx *= 0.96;
        G.ty *= 0.96;
      }
      const k = 1 - Math.exp(-dt * (G.gyro ? 9 : 5));
      G.x += (G.tx - G.x) * k;
      G.y += (G.ty - G.y) * k;
      const amp = fine && !G.gyro ? 0.55 : 1;
      const x = +(G.x * amp).toFixed(3), y = +(G.y * amp).toFixed(3);
      if (x !== px || y !== py) {
        root.style.setProperty("--gx", x);
        root.style.setProperty("--gy", y);
        px = x;
        py = y;
      }
    })(lt);
    $$(".head>*,.cta h2,.big-word,.fq-q,.foot-contact,.foot-links").forEach((e) => e.classList.add("g3d"));
  })();
  const ctaEl = $("#cta");
  ctaEl.addEventListener("pointermove", (e) => {
    const r = ctaEl.getBoundingClientRect();
    ctaEl.style.setProperty("--cx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    ctaEl.style.setProperty("--cy", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  }, { passive: true });
  if (fine && !reduce) {
    const c = $(".cursor"), d = $(".cursor-dot");
    let x = -100, y = -100, cx = x, cy = y;
    document.body.classList.add("has-cursor");
    addEventListener("pointermove", (e) => {
      x = e.clientX;
      y = e.clientY;
      d.style.transform = `translate3d(${x}px,${y}px,0)`;
    }, { passive: true });
    (function loop() {
      cx += (x - cx) * 0.18;
      cy += (y - cy) * 0.18;
      c.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      requestAnimationFrame(loop);
    })();
    document.addEventListener("pointerover", (e) => {
      c.classList.toggle("is-hover", !!e.target.closest("a,button,input,select,textarea,canvas"));
    });
    document.addEventListener("pointermove", (e) => {
      const m = e.target.closest(".magnetic");
      $$(".magnetic.mag-on").forEach((el) => {
        if (el !== m) {
          el.classList.remove("mag-on");
          el.style.transform = "";
        }
      });
      if (!m) return;
      const r = m.getBoundingClientRect();
      m.classList.add("mag-on");
      m.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.2}px,${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
    }, { passive: true });
  }
  const mb = $("#menuBtn"), mm = $("#mobileMenu");
  function menu(open) {
    mm.classList.toggle("open", open);
    mb.setAttribute("aria-expanded", open);
    mm.setAttribute("aria-hidden", !open);
    document.body.classList.toggle("locked", open);
    document.body.classList.toggle("menu-open", open);
  }
  mb.onclick = () => menu(!mm.classList.contains("open"));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-go]");
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute("href").slice(1);
    if (mm.classList.contains("open")) {
      menu(false);
      setTimeout(() => goTo(id), 280);
    } else goTo(id);
  });
  const secs = ["parts", "process", "track", "faq"].map((id) => document.getElementById(id));
  const navIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) $$(".nav-links a").forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  secs.forEach((s) => navIO.observe(s));
  const bar = $("#progressBar"), nav = $("#nav"), dock = $("#dockBar"), partsSec = $("#parts");
  let ticking = false;
  function onScroll() {
    ticking = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    nav.classList.toggle("scrolled", scrollY > 24);
    const pr = partsSec.getBoundingClientRect(), pk = picker.getBoundingClientRect();
    const show = isMobile() && pr.top < innerHeight * 0.5 && pr.bottom > innerHeight * 0.6 && pk.bottom < 90;
    dock.classList.toggle("show", show);
    dock.setAttribute("aria-hidden", !show);
  }
  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  addEventListener("resize", onScroll);
  renderModels();
  syncSummary();
  onScroll();
})();
