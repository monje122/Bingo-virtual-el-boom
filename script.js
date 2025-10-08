/* =========================
   Bingo Virtual - JS (con fecha)
   ========================= */

let selectedCartons = [];
let occupiedCartons = new Set();
let inscriptions = [];
let total = 0;

const SUPABASE_URL = 'https://avycdfdbprllrqgzwkwe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2eWNkZmRicHJsbHJxZ3p3a3dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NzAwMjEsImV4cCI6MjA3NTM0NjAyMX0.ydsK-epIo7wQBT3H44u2eJVqJFVhUtNOTRQQ8nQTCg4';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Helpers de fecha ---------- */
function todayISO() { return new Date().toISOString().slice(0, 10); } // YYYY-MM-DD
function prettyFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${d} ${date.toLocaleString('default', { month: 'long' })}`;
}

/* ---------- Cargar día en el <select> (valor=ISO, texto=bonito) ---------- */
function setCurrentDay() {
  const sel = document.getElementById("day-select");
  if (!sel) return;
  sel.innerHTML = '';
  const iso = todayISO();
  const opt = document.createElement("option");
  opt.value = iso;                    // lo que se envía a la BD (date)
  opt.textContent = prettyFromISO(iso); // lo que ve el usuario
  sel.appendChild(opt);
}

/* ---------- Traer ocupados para el día seleccionado (RPC) ---------- */
async function fetchOccupiedCartons() {
  const sel = document.getElementById("day-select");
  const isoDay = sel?.value ?? todayISO();

  // RPC: get_occupied_cartons_by_day(p_day date) -> int[]
  const { data, error } = await supabase.rpc('get_occupied_cartons_by_day', { p_day: isoDay });

  if (error) {
    console.error("Error al obtener cartones ocupados:", error.message);
    occupiedCartons = new Set();
  } else {
    occupiedCartons = new Set(data || []);
  }
  generateCartons();
}

/* ---------- Boot ---------- */
window.onload = function () {
  setCurrentDay();
  fetchOccupiedCartons();

  // Suscripción realtime para refrescar ocupados
  supabase
    .channel('inscripciones-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inscripciones' },
      () => fetchOccupiedCartons()
    )
    .subscribe();
};

/* ---------- Navegación ---------- */
function showInscription() { hideAll(); document.getElementById("inscription-window").classList.remove("hidden"); }
function showAdmin() { hideAll(); document.getElementById("admin-window").classList.remove("hidden"); }
function goToCartons() { hideAll(); document.getElementById("cartons-window").classList.remove("hidden"); generateCartons(); }
function goToPayment() {
  if (selectedCartons.length === 0) { alert("Debes seleccionar al menos un cartón."); return; }
  hideAll();
  document.getElementById("payment-window").classList.remove("hidden");
  document.getElementById("final-amount").textContent = total;
}
function hideAll() { document.querySelectorAll("body > div").forEach(d => d.classList.add("hidden")); }

/* ---------- Cartones ---------- */
function generateCartons() {
  const container = document.getElementById("cartons-container");
  container.innerHTML = "";
  for (let i = 1; i <= 3000; i++) {
    const div = document.createElement("div");
    div.className = "carton";
    div.textContent = i;

    if (occupiedCartons.has(i)) {
      div.classList.add("occupied");
    } else {
      div.onclick = () => toggleCarton(i, div);
    }
    container.appendChild(div);
  }
}

function toggleCarton(num, el) {
  if (selectedCartons.includes(num)) {
    selectedCartons = selectedCartons.filter(n => n !== num);
    el.classList.remove("selected");
    total -= 5;
  } else {
    selectedCartons.push(num);
    el.classList.add("selected");
    total += 5;
  }
  document.getElementById("total").textContent = total;
}

/* ---------- Admin ---------- */
async function showProofs() {
  const proofsContainer = document.getElementById("proofs-container");
  proofsContainer.innerHTML = "<h3>Comprobantes:</h3>";

  const { data, error } = await supabase
    .from('inscripciones')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    console.error("Error al obtener inscripciones:", error.message);
    proofsContainer.innerHTML += "<p>Error cargando comprobantes.</p>";
    return;
  }

  data.forEach((inscription, index) => {
    const cartones = Array.isArray(inscription.cartons) ? inscription.cartons : [];
    const cantidad = cartones.length;
    const listaFormateada = formatCartons(cartones); // <-- "5, 7-9, 12"
    const fecha = inscription.event_day || inscription.day || '';

    const div = document.createElement("div");
    div.className = "proof-card";
    div.innerHTML = `
      <p class="proof-title">
        <strong>${index + 1}. ${inscription.name}</strong> — ${inscription.phone}
        ${fecha ? `<span class="meta">• ${fecha}</span>` : ''}
      </p>

      <p class="meta">
        <strong>Cartones (${cantidad}):</strong> ${listaFormateada || '<em>Sin cartones</em>'}
      </p>

      <p class="meta"><strong>Total:</strong> $${inscription.total ?? 0}</p>

      ${inscription.proof_url ? `
        <img src="${inscription.proof_url}" alt="Comprobante"
             onclick="viewImage('${inscription.proof_url}')" />
      ` : ''}
    `;
    proofsContainer.appendChild(div);
  });
}


async function fetchClientCount() {
  const { count, error } = await supabase
    .from('inscripciones')
    .select('*', { count: 'exact', head: true });

  if (!error) document.getElementById("clients-count").textContent = count;
  else console.error("Error obteniendo el conteo de clientes:", error.message);
}

/* ---------- Guardar inscripción (incluye event_day) ---------- */
async function saveInscription() {
  const name = document.getElementById("name").value;
  const phone = document.getElementById("phone").value;
  const proofFile = document.getElementById("proof").files[0];

  if (!proofFile) { alert("Debes subir un comprobante."); return; }

  // Día seleccionado (ISO) para guardar en event_day
  const isoDay = document.getElementById("day-select").value;

  // 1) Subir imagen al bucket
  const fileName = `${Date.now()}_${proofFile.name}`;
  const { data: uploadData, error: uploadError } = await supabase
    .storage.from('comprobantes')
    .upload(fileName, proofFile);

  if (uploadError) {
    console.error("Error subiendo el comprobante:", uploadError);
    alert("Error subiendo el comprobante.");
    return;
  }

  // 2) URL pública
  const { data: publicUrlData } = supabase
    .storage.from('comprobantes')
    .getPublicUrl(fileName);
  const proofURL = publicUrlData.publicUrl;

  // 3) Insertar en la BD (con event_day)
  const { data: insertData, error: insertError } = await supabase
    .from('inscripciones')
    .insert([{
      name,
      phone,
      cartons: selectedCartons,
      total,
      proof_url: proofURL,
      event_day: isoDay        // <- aquí va la fecha (DATE)
    }]);

  if (insertError) {
    console.error("Error al guardar en la base de datos:", insertError);
    alert("Hubo un problema guardando la inscripción en la base de datos: " + insertError.message);
    return;
  }

  alert("Inscripción guardada exitosamente.");
  occupiedCartons = new Set([...occupiedCartons, ...selectedCartons]);
  inscriptions.push({ name, phone, cartons: [...selectedCartons], total, proofURL, event_day: isoDay });
  sendToWhatsApp();
  goHome();
}

/* ---------- Utilidades ---------- */
function viewImage(url) {
  const win = window.open();
  win.document.write(`<img src="${url}" style="width:100%">`);
}

function goHome() {
  hideAll();
  document.getElementById("main-container").classList.remove("hidden");
  document.getElementById("form").reset();
  selectedCartons = [];
  total = 0;
  document.getElementById("total").textContent = total;
}

/* ---------- Auth Admin ---------- */
async function loginAdmin() {
  const email = document.getElementById("admin-email").value;
  const password = document.getElementById("admin-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { alert("Acceso denegado: " + error.message); return; }

  alert("Bienvenido, Admin");
  document.getElementById("admin-window").classList.remove("hidden");
  document.getElementById("sold-count").textContent = occupiedCartons.size;
  fetchClientCount();
  showProofs();
}

async function logout() {
  await supabase.auth.signOut();
  alert("Sesión cerrada");
  goHome();
}

/* ---------- WhatsApp (día bonito en el texto) ---------- */
function sendToWhatsApp() {
  const name = document.getElementById("name").value;
  const phone = document.getElementById("phone").value;

  const sel = document.getElementById("day-select");
  const iso = sel.value;
  const nice = sel.options[sel.selectedIndex].textContent || prettyFromISO(iso);

  const msg = `*Nueva inscripción de Bingo*\n
*Nombre:* ${name}
*Teléfono:* ${phone}
*Día:* ${nice}
*Cartones:* ${selectedCartons.join(', ')}
*Total:* $${total}`;

  const encoded = encodeURIComponent(msg);
  window.open(`https://wa.me/584162226494?text=${encoded}`, "_blank");
}
function formatCartons(arr){
  const a = (arr || [])
    .filter(n => Number.isInteger(n))
    .sort((x, y) => x - y);

  const res = [];
  for (let i = 0; i < a.length; i++){
    let start = a[i], end = start;
    while (i + 1 < a.length && a[i + 1] === end + 1){
      end = a[++i];
    }
    res.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return res.join(', ');
}
