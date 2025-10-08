/* =========================
   Bingo Virtual - JS (con fecha) + anti-doble click
   ========================= */

let selectedCartons = [];
let occupiedCartons = new Set();
let inscriptions = [];
let total = 0;

// flags anti doble envío
let isSaving = false;
let alreadyOpenedWA = false;

const SUPABASE_URL = 'https://avycdfdbprllrqgzwkwe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2eWNkZmRicHJsbHJxZ3p3a3dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NzAwMjEsImV4cCI6MjA3NTM0NjAyMX0.ydsK-epIo7wQBT3H44u2eJVqJFVhUtNOTRQQ8nQTCg4';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Helpers de fecha ---------- */
function todayISO(){ return new Date().toISOString().slice(0,10); } // YYYY-MM-DD
function prettyFromISO(iso){
  const [y,m,d] = iso.split('-').map(Number);
  const date = new Date(y, m-1, d);
  return `${d} ${date.toLocaleString('default',{month:'long'})}`;
}

/* ---------- Cargar día en el <select> (valor=ISO, texto=bonito) ---------- */
function setCurrentDay(){
  const sel = document.getElementById("day-select");
  if (!sel) return;
  sel.innerHTML = '';
  const iso = todayISO();
  const opt = document.createElement("option");
  opt.value = iso;                    // para BD
  opt.textContent = prettyFromISO(iso); // para el usuario
  sel.appendChild(opt);
}

/* ---------- Traer ocupados para el día seleccionado (RPC) ---------- */
async function fetchOccupiedCartons(){
  const sel = document.getElementById("day-select");
  const isoDay = sel?.value ?? todayISO();
  const { data, error } = await supabase.rpc('get_occupied_cartons_by_day', { p_day: isoDay });
  if (error){
    console.error("Error al obtener cartones ocupados:", error.message);
    occupiedCartons = new Set();
  } else {
    occupiedCartons = new Set(data || []);
  }
  generateCartons();
}

/* ---------- Boot ---------- */
window.onload = function (){
  setCurrentDay();
  fetchOccupiedCartons();
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
function showInscription(){ hideAll(); document.getElementById("inscription-window").classList.remove("hidden"); }
function goToCartons(){ hideAll(); document.getElementById("cartons-window").classList.remove("hidden"); generateCartons(); }
function goToPayment(){
  if (selectedCartons.length === 0){ alert("Debes seleccionar al menos un cartón."); return; }
  hideAll();
  document.getElementById("payment-window").classList.remove("hidden");
  document.getElementById("final-amount").textContent = total;
}
function hideAll(){ document.querySelectorAll("body > div").forEach(d => d.classList.add("hidden")); }

/* ---------- Cartones ---------- */
function generateCartons(){
  const container = document.getElementById("cartons-container");
  container.innerHTML = "";
  for (let i=1; i<=3000; i++){
    const div = document.createElement("div");
    div.className = "carton";
    div.textContent = i;
    if (occupiedCartons.has(i)){
      div.classList.add("occupied");
    } else {
      div.onclick = () => toggleCarton(i, div);
    }
    container.appendChild(div);
  }
}

function toggleCarton(num, el){
  if (selectedCartons.includes(num)){
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

/* ---------- Admin: mostrar comprobantes ---------- */
async function showProofs(){
  const proofsContainer = document.getElementById("proofs-container");
  proofsContainer.innerHTML = "<h3>Comprobantes:</h3>";
  const { data, error } = await supabase
    .from('inscripciones')
    .select('*')
    .order('id', { ascending: false });
  if (error){
    console.error("Error al obtener inscripciones:", error.message);
    proofsContainer.innerHTML += "<p>Error cargando comprobantes.</p>";
    return;
  }
  data.forEach((inscription, index) => {
    const cartones = Array.isArray(inscription.cartons) ? inscription.cartons : [];
    const cantidad = cartones.length;
    const listaFormateada = formatCartons(cartones);
    const fecha = inscription.event_day || inscription.day || '';
    const div = document.createElement("div");
    div.className = "proof-card";
    div.innerHTML = `
      <p class="proof-title">
        <strong>${index + 1}. ${inscription.name}</strong> — ${inscription.phone}
        ${fecha ? `<span class="meta">• ${fecha}</span>` : ''}
      </p>
      <p class="meta"><strong>Cartones (${cantidad}):</strong> ${listaFormateada || '<em>Sin cartones</em>'}</p>
      <p class="meta"><strong>Total:</strong> $${inscription.total ?? 0}</p>
      ${inscription.proof_url ? `<img src="${inscription.proof_url}" alt="Comprobante" onclick="viewImage('${inscription.proof_url}')" />` : ''}
    `;
    proofsContainer.appendChild(div);
  });
}

async function fetchClientCount(){
  const { count, error } = await supabase
    .from('inscripciones')
    .select('*', { count: 'exact', head: true });
  if (!error) document.getElementById("clients-count").textContent = count;
  else console.error("Error obteniendo el conteo de clientes:", error.message);
}

/* ---------- Guardar inscripción (RPC anti-duplicados) ---------- */
async function saveInscription(){
  if (isSaving) return; // bloquea doble click
  isSaving = true;

  const btn = document.getElementById('whatsapp-btn');
  if (btn){ btn.disabled = true; btn.dataset.text = btn.innerText; btn.innerText = 'Enviando...'; }

  try{
    const name = document.getElementById("name").value;
    const phone = document.getElementById("phone").value;
    const ref   = document.getElementById("referrer") ? document.getElementById("referrer").value : '';
    const proofFile = document.getElementById("proof").files[0];
    if (!proofFile){ throw new Error("Debes subir un comprobante."); }

    const isoDay = document.getElementById("day-select").value;

    // 1) Subir imagen
    const fileName = `${Date.now()}_${proofFile.name}`;
    const { error: uploadError } = await supabase.storage.from('comprobantes').upload(fileName, proofFile);
    if (uploadError) throw uploadError;

    // 2) URL pública
    const { data: publicUrlData } = supabase.storage.from('comprobantes').getPublicUrl(fileName);
    const proofURL = publicUrlData.publicUrl;

    // 3) Reservar + crear inscripción (atómico)
    const { error: reserveErr } = await supabase.rpc('reserve_and_create_inscription', {
      p_name: name,
      p_phone: phone,
      p_referrer: ref,      // <- pasa el referido
      p_total: total,
      p_proof_url: proofURL,
      p_cartons: selectedCartons,
      p_event_day: isoDay
    });
    if (reserveErr){
      if (reserveErr.code === '23505' || /ocupados/i.test(reserveErr.message)){
        alert("Ups, alguien tomó uno de esos cartones al mismo tiempo 😬. Elige otros.");
        await fetchOccupiedCartons();
      } else {
        throw reserveErr;
      }
      return;
    }

    // todo ok
    alert("Inscripción guardada exitosamente.");
    occupiedCartons = new Set([...occupiedCartons, ...selectedCartons]);
    inscriptions.push({ name, phone, ref, cartons: [...selectedCartons], total, proofURL, event_day: isoDay });

    sendToWhatsApp();  // abre una única vez
    goHome();          // limpia e inicia nuevo flujo

  } catch(err){
    console.error("Error en el guardado:", err);
    alert(err.message || "Ocurrió un error. Vuelve a intentar.");
    if (btn){ btn.disabled = false; btn.innerText = btn.dataset.text || 'Enviar por WhatsApp'; }
    isSaving = false;
    alreadyOpenedWA = false;
    return;
  }
}

/* ---------- Utilidades ---------- */
function viewImage(url){
  const win = window.open();
  win.document.write(`<img src="${url}" style="width:100%">`);
}

function goHome(){
  hideAll();
  document.getElementById("main-container").classList.remove("hidden");
  document.getElementById("form").reset();
  selectedCartons = [];
  total = 0;
  document.getElementById("total").textContent = total;

  const btn = document.getElementById('whatsapp-btn');
  if (btn){ btn.disabled = false; btn.innerText = btn.dataset.text || 'Enviar por WhatsApp'; }
  isSaving = false;
  alreadyOpenedWA = false;
}

/* ---------- Auth Admin (login -> panel) ---------- */
async function showAdmin(){
  hideAll();
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session){
    showAdminPanel();
  } else {
    document.getElementById("admin-window").classList.remove("hidden"); // login
  }
}

function showAdminPanel(){
  hideAll();
  document.getElementById("admin-panel-window").classList.remove("hidden");
  document.getElementById("sold-count").textContent = occupiedCartons.size;
  fetchClientCount();
  showProofs();
}

async function loginAdmin(){
  const email = document.getElementById("admin-email").value;
  const password = document.getElementById("admin-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){ alert("Acceso denegado: " + error.message); return; }
  alert("Bienvenido, Admin");
  showAdminPanel();
}

async function logout(){
  await supabase.auth.signOut();
  alert("Sesión cerrada");
  hideAll();
  document.getElementById("admin-window").classList.remove("hidden");
}

/* ---------- WhatsApp (solo una vez) ---------- */
function sendToWhatsApp(){
  if (alreadyOpenedWA) return;
  alreadyOpenedWA = true;

  const name = document.getElementById("name").value;
  const phone = document.getElementById("phone").value;
  const ref = document.getElementById("referrer") ? document.getElementById("referrer").value : '';

  const sel = document.getElementById("day-select");
  const iso = sel.value;
  const nice = sel.options[sel.selectedIndex].textContent || prettyFromISO(iso);

  const msg = `*Nueva inscripción de Bingo*\n
*Nombre:* ${name}
*Teléfono:* ${phone}
*Referido por:* ${ref}
*Día:* ${nice}
*Cartones:* ${selectedCartons.join(', ')}
*Total:* $${total}`;

  const encoded = encodeURIComponent(msg);
  window.open(`https://wa.me/584162226494?text=${encoded}`, "_blank", "noopener");
}

/* ---------- Formatear cartones: 5, 7-9, 12 ---------- */
function formatCartons(arr){
  const a = (arr || []).filter(n => Number.isInteger(n)).sort((x,y)=>x-y);
  const res = [];
  for (let i=0; i<a.length; i++){
    let start=a[i], end=start;
    while (i+1<a.length && a[i+1]===end+1){ end=a[++i]; }
    res.push(start===end ? `${start}` : `${start}-${end}`);
  }
  return res.join(', ');
}
// ---- Helpers Storage ----
function storagePathFromPublicUrl(url){
  const m = /\/object\/public\/([^/]+)\/(.+)$/.exec(url || '');
  return m ? m[2] : null;      // ruta dentro del bucket
}

// Borra los comprobantes según las URLs guardadas en la BD
async function deleteProofsFromDBRows(){
  const { data, error } = await supabase.from('inscripciones').select('proof_url');
  if (error) throw error;

  const paths = (data || [])
    .map(r => storagePathFromPublicUrl(r.proof_url))
    .filter(Boolean);

  if (!paths.length) return 0;

  const { error: delErr } = await supabase.storage.from('comprobantes').remove(paths);
  if (delErr) throw delErr;

  return paths.length;
}

// Borra TODO lo que haya en la raíz del bucket (con paginación)
// deletePlaceholder=true para borrar también ".emptyFolderPlaceholder"
async function deleteAllFromBucketRoot(bucket = 'comprobantes', deletePlaceholder = false){
  let page = 0, size = 100;
  while (true) {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list('', { limit: size, offset: page*size, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw error;
    if (!files?.length) break;

    const names = files
      .map(f => f.name)
      .filter(n => deletePlaceholder ? true : n !== '.emptyFolderPlaceholder');

    if (names.length){
      const { error: delErr } = await supabase.storage.from(bucket).remove(names);
      if (delErr) throw delErr;
    }

    if (files.length < size) break;
    page++;
  }
}

// ---- Botón Reset (FULL) ----
async function resetData() {
  if (!confirm("⚠️ Esto borrará TODO: inscripciones + boletas + comprobantes. ¿Continuar?")) return;
  if (!confirm("Última confirmación: acción irreversible. ¿Borrar definitivamente?")) return;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    alert("Debes iniciar sesión como administrador.");
    return;
  }

  const btns = Array.from(document.querySelectorAll('button'));
  btns.forEach(b => b.disabled = true);

  try {
    // 1) Borrar comprobantes (por rutas en la BD) + escoba en bucket
    await deleteProofsFromDBRows();                  // borra los que están referenciados
    await deleteAllFromBucketRoot('comprobantes', true); // y limpia todo lo demás (incluye placeholder)

    // 2) Borrar tablas
    try { await supabase.from('boletas').delete().neq('id', 0); } catch(e){ /* opcional */ }
    const { error: delInsErr } = await supabase.from('inscripciones').delete().neq('id', 0);
    if (delInsErr) throw delInsErr;

    // 3) Reset UI/estado
    occupiedCartons = new Set();
    selectedCartons = [];
    inscriptions = [];
    total = 0;

    const sold = document.getElementById("sold-count");
    const clients = document.getElementById("clients-count");
    const proofs = document.getElementById("proofs-container");
    if (sold) sold.textContent = 0;
    if (clients) clients.textContent = 0;
    if (proofs) proofs.innerHTML = "<h3>Comprobantes:</h3><p>(Vacío)</p>";

    await fetchOccupiedCartons();
    alert("✅ Todo fue reiniciado correctamente.");
  } catch (err) {
    console.error(err);
    alert("❌ Error al reiniciar: " + (err?.message || err));
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}
