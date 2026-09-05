// =====================================================================
// app.js — Frontend Penjadwalan Kuliah
// =====================================================================
'use strict';

let DB = { hari: [], jenisRuang: [], pengaturan: { tahunAkademik: '', semesterAktif: 'Ganjil' }, templateSK: {}, fakultas: [], prodi: [], dosen: [], ruangan: [], matakuliah: [], kelas: [], semester: [], slot: [], tahunAkademik: [], jadwal: [] };
let activeTab = 'jadwal';
let TOKEN = localStorage.getItem('ejadwal_token') || '';
let currentUser = null;
const isProdi = () => currentUser && currentUser.role === 'prodi';
const isFakultas = () => currentUser && currentUser.role === 'fakultas';
const isAdmin = () => currentUser && currentUser.role === 'admin';

// ---------- Utilitas ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !/\/api\/login$/.test(url)) {
    TOKEN = ''; localStorage.removeItem('ejadwal_token'); showLogin();
  }
  return { ok: res.ok, status: res.status, data };
}

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- Lookup nama ----------
function nameOf(col, id) {
  const r = (DB[col] || []).find(x => x.id === id);
  if (!r) return '-';
  if (col === 'ruangan' || col === 'dosen' || col === 'fakultas' || col === 'prodi')
    return r.kode ? `${r.kode} — ${r.nama}` : r.nama;
  return r.nama;
}
function prodiLabel(id) { const p = DB.prodi.find(x => x.id === id); return p ? (p.kode ? `${p.kode} ${p.nama}` : p.nama) : '-'; }
// Normalisasi nama untuk pencocokan: buang spasi & tanda baca (mis. "S.Pd., M.Pd." = "S. Pd., M. Pd.").
function normNama(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isDaringRoomId(id) { const r = (DB.ruangan || []).find(x => x.id === id); return !!(r && r.daring); }
// Kategori ruang untuk sebuah fakultas (override), atau daftar global bila belum ada.
function jenisRuangFor(fakultasId) {
  const m = DB.jenisRuangFak || {};
  if (fakultasId && Array.isArray(m[fakultasId]) && m[fakultasId].length) return m[fakultasId];
  return DB.jenisRuang || [];
}
// Kumpulan id dosen sebuah penawaran/jadwal (mendukung banyak dosen).
function dosenIdsOf(x) {
  if (x && Array.isArray(x.dosenIds) && x.dosenIds.length) return x.dosenIds;
  return (x && x.dosenId) ? [x.dosenId] : [];
}
function dosenNamaOf(x) {
  const ids = dosenIdsOf(x);
  if (!ids.length) return '-';
  return ids.map(id => {
    const d = (DB.dosen || []).find(y => y.id === id) || (DB.dosenSemua || []).find(y => y.id === id);
    return d ? d.nama : '-';
  }).join(', ');
}

// Mata kuliah (penawaran) pada periode aktif.
function mkAktif() {
  const p = DB.pengaturan || {};
  return DB.matakuliah.filter(m =>
    (m.tahunAkademik || '') === (p.tahunAkademik || '') &&
    (m.semesterAktif || '') === (p.semesterAktif || ''));
}
// Semua MK (lintas prodi/fakultas) pada periode aktif — untuk hitung beban dosen.
function mkAktifSemua() {
  const p = DB.pengaturan || {};
  const src = (DB.matakuliahSemua && DB.matakuliahSemua.length) ? DB.matakuliahSemua : DB.matakuliah;
  return src.filter(m =>
    (m.tahunAkademik || '') === (p.tahunAkademik || '') &&
    (m.semesterAktif || '') === (p.semesterAktif || ''));
}
// Dosen berlaku lintas periode (tidak terikat Tahun Akademik/Semester).
function dosenAktif() {
  return DB.dosen || [];
}
// Semua dosen (lintas prodi) untuk memilih pengampu — juga lintas periode.
function dosenPilihan() {
  const src = (DB.dosenSemua && DB.dosenSemua.length) ? DB.dosenSemua : DB.dosen;
  return src || [];
}
// Identitas dosen (untuk homebase & penjadwalan): NIDN diutamakan, lalu NUPTK.
function dosenIdent(d) { return String((d && d.nidn) || '').trim() || String((d && d.nuptk) || '').trim(); }
// Kelas pada periode aktif. Kelas terikat periode.
function kelasAktif() {
  const p = DB.pengaturan || {};
  return DB.kelas.filter(k =>
    (k.tahunAkademik || '') === (p.tahunAkademik || '') &&
    (k.semesterAktif || '') === (p.semesterAktif || ''));
}
// Semester sesuai jenis periode aktif (Ganjil=ganjil, Genap=genap, lainnya=semua).
function semesterSesuaiPeriode() {
  const sem = (DB.pengaturan || {}).semesterAktif;
  let list = DB.semester.slice().sort((a, b) => a.nomor - b.nomor);
  if (sem === 'Ganjil') list = list.filter(s => Number(s.nomor) % 2 === 1);
  else if (sem === 'Genap') list = list.filter(s => Number(s.nomor) % 2 === 0);
  return list;
}

// Hari berlaku untuk sebuah slot (array/string/kosong).
function slotHariArr(s) { return Array.isArray(s.hari) ? s.hari : (s.hari ? [s.hari] : []); }
// Slot yang berlaku untuk sebuah hari (slot khusus hari jika ada, jika tidak slot umum).
function slotsForHari(hari) {
  const spesifik = DB.slot.filter(s => slotHariArr(s).includes(hari));
  const base = spesifik.length ? spesifik : DB.slot.filter(s => slotHariArr(s).length === 0);
  return base.slice().sort((a, b) => a.jamMulai.localeCompare(b.jamMulai));
}

// =====================================================================
// SKEMA MASTER DATA
// =====================================================================
const SCHEMAS = {
  fakultas: {
    label: 'Fakultas',
    columns: [{ k: 'kode', t: 'Kode' }, { k: 'nama', t: 'Nama Fakultas' }],
    fields: [
      { key: 'kode', label: 'Kode', type: 'text' },
      { key: 'nama', label: 'Nama Fakultas', type: 'text', required: true }
    ]
  },
  prodi: {
    label: 'Program Studi',
    columns: [
      { k: 'kode', t: 'Kode' }, { k: 'nama', t: 'Nama' },
      { k: 'jenjang', t: 'Jenjang' }, { k: 'fakultasId', t: 'Fakultas', ref: 'fakultas' }
    ],
    fields: [
      { key: 'kode', label: 'Kode', type: 'text' },
      { key: 'nama', label: 'Nama Program Studi', type: 'text', required: true },
      { key: 'jenjang', label: 'Jenjang', type: 'select', options: ['D3', 'D4', 'S1', 'S2', 'S3', 'Sp-1', 'Sp-2', 'Profesi'].map(v => ({ v, t: v })) },
      { key: 'fakultasId', label: 'Fakultas', type: 'select', ref: 'fakultas', required: true }
    ]
  },
  dosen: {
    label: 'Dosen',
    columns: [
      { k: 'nidn', t: 'NIDN' }, { k: 'nuptk', t: 'NUPTK' }, { k: 'nama', t: 'Nama' }, { k: 'prodiId', t: 'Program Studi', ref: 'prodi' }
    ],
    fields: [
      { key: 'nidn', label: 'NIDN', type: 'text' },
      { key: 'nuptk', label: 'NUPTK', type: 'text' },
      { key: 'nama', label: 'Nama Dosen', type: 'text', required: true },
      { key: 'prodiId', label: 'Program Studi (homebase)', type: 'select', ref: 'prodi' }
    ]
  },
  ruangan: {
    label: 'Ruangan',
    columns: [
      { k: 'kode', t: 'Kode' }, { k: 'nama', t: 'Nama' },
      { k: 'jenisRuang', t: 'Jenis', fmt: r => r.jenisRuang || 'Kelas' },
      { k: 'kapasitas', t: 'Kapasitas' }, { k: 'gedung', t: 'Gedung' },
      { k: 'fakultasId', t: 'Fakultas', ref: 'fakultas' }
    ],
    fields: [
      { key: 'kode', label: 'Kode', type: 'text' },
      { key: 'nama', label: 'Nama Ruangan', type: 'text', required: true },
      { key: 'jenisRuang', label: 'Jenis Ruang', type: 'select', jenisRuangOpts: true },
      { key: 'kapasitas', label: 'Kapasitas', type: 'number' },
      { key: 'gedung', label: 'Gedung', type: 'text' },
      { key: 'fakultasId', label: 'Fakultas (pemilik)', type: 'select', ref: 'fakultas', required: true }
    ]
  },
  matakuliah: {
    label: 'Mata Kuliah',
    columns: [
      { k: 'kode', t: 'Kode MK' }, { k: 'nama', t: 'Nama MK' },
      { k: 'kelasId', t: 'Kelas', ref: 'kelas' },
      { k: 'dosenId', t: 'Dosen', fmt: r => dosenNamaOf(r) },
      { k: 'sks', t: 'SKS', fmt: r => ((Number(r.sksTeori) || 0) + (Number(r.sksPraktik) || 0)) || (r.sks || 0) },
      { k: 'semester', t: 'Smt' }, { k: 'prodiId', t: 'Program Studi', ref: 'prodi' }
    ],
    fields: []
  },
  kelas: {
    label: 'Kelas',
    columns: [
      { k: 'nama', t: 'Nama Kelas' }, { k: 'prodiId', t: 'Program Studi', ref: 'prodi' },
      { k: 'semester', t: 'Semester' }, { k: 'jumlahMhs', t: 'Jml Mhs' }
    ],
    fields: [
      { key: 'prodiId', label: 'Program Studi', type: 'select', ref: 'prodi', required: true },
      { key: 'nama', label: 'Nama Kelas (mis. TI-3A)', type: 'text', required: true },
      { key: 'semester', label: 'Semester', type: 'select', semesterOpts: true, required: true },
      { key: 'jumlahMhs', label: 'Jumlah Mahasiswa', type: 'number' }
    ]
  },
  semester: {
    label: 'Semester',
    columns: [
      { k: 'nomor', t: 'Nomor' }, { k: 'nama', t: 'Nama' },
      { k: 'nomor', t: 'Jenis', fmt: r => (Number(r.nomor) % 2 === 1 ? 'Ganjil' : 'Genap') }
    ],
    fields: [
      { key: 'nomor', label: 'Nomor Semester', type: 'number', required: true },
      { key: 'nama', label: 'Nama (opsional, mis. Semester 1)', type: 'text' }
    ]
  },
  tahunAkademik: {
    label: 'Tahun Akademik',
    columns: [{ k: 'nama', t: 'Nama' }],
    fields: [
      { key: 'nama', label: 'Nama Tahun Akademik (mis. 2026/2027)', type: 'text', required: true }
    ]
  },
  slot: {
    label: 'Hari & Jam',
    columns: [
      { k: 'kelompok', t: 'Kelompok', fmt: r => r.kelompok || '-' },
      { k: 'hari', t: 'Hari', fmt: r => { const a = slotHariArr(r); return a.length ? a.join(', ') : 'Semua hari'; } },
      { k: 'jamMulai', t: 'Mulai' }, { k: 'jamSelesai', t: 'Selesai' }
    ],
    fields: [
      { key: 'kelompok', label: 'Kelompok', type: 'select', options: [{ v: 'Pagi', t: 'Pagi' }, { v: 'Siang', t: 'Siang' }], emptyLabel: '— pilih —' },
      { key: 'hari', label: 'Hari (boleh lebih dari satu)', type: 'daycheck' },
      { key: 'jamMulai', label: 'Jam Mulai Rentang', type: 'time', required: true },
      { key: 'jamSelesai', label: 'Jam Selesai Rentang', type: 'time', required: true }
    ]
  }
};

// =====================================================================
// LOAD & INIT
// =====================================================================
async function loadDB() {
  const { ok, data } = await api('GET', '/api/db');
  if (ok) { DB = data; currentUser = data._me || currentUser; }
}

// ---------- Autentikasi / login ----------
function showLogin() {
  const ov = $('#loginOverlay');
  if (ov) ov.hidden = false;
  const app = $('#appRoot'); if (app) app.style.display = 'none';
}
function hideLogin() {
  const ov = $('#loginOverlay');
  if (ov) ov.hidden = true;
  const app = $('#appRoot'); if (app) app.style.display = '';
}
function setupLogin() {
  const f = $('#loginForm');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = f.elements['username'].value.trim();
    const password = f.elements['password'].value;
    const { ok, data } = await api('POST', '/api/login', { username, password });
    if (!ok) { $('#loginMsg').textContent = data.error || 'Gagal masuk'; return; }
    TOKEN = data.token; localStorage.setItem('ejadwal_token', TOKEN);
    currentUser = data.user;
    $('#loginMsg').textContent = '';
    f.reset();
    hideLogin();
    await bootApp();
  });
}
async function logout() {
  try { await api('POST', '/api/logout'); } catch { }
  TOKEN = ''; localStorage.removeItem('ejadwal_token'); currentUser = null;
  location.reload();
}
function renderUserBox() {
  const box = $('#userBox');
  if (!box) return;
  const u = currentUser || {};
  box.innerHTML = `
    <div class="userinfo"><b>${esc(u.nama || u.username || '')}</b>
      <span class="rolebadge ${u.role}">${u.role === 'admin' ? 'Admin' : (u.role === 'fakultas' ? 'Fakultas' : 'Prodi')}</span></div>
    <button class="btn" id="btnGantiPass" title="Ganti password">🔑</button>
    <button class="btn" id="btnLogout">Keluar</button>`;
  $('#btnLogout').addEventListener('click', logout);
  $('#btnGantiPass').addEventListener('click', openGantiPass);
}
function openGantiPass() {
  const form = $('#modalForm');
  form.innerHTML = `
    <label class="field"><span>Password Lama *</span><input type="password" name="lama" required /></label>
    <label class="field"><span>Password Baru *</span><input type="password" name="baru" minlength="4" required /></label>`;
  $('#modalTitle').textContent = 'Ganti Password';
  showModal(async (e) => {
    e.preventDefault();
    const { ok, data } = await api('PUT', '/api/akun/password', { lama: form.elements['lama'].value, baru: form.elements['baru'].value });
    if (!ok) return setModalMsg(data.error || 'Gagal', 'err');
    hideModal(); toast('Password diganti');
  });
}
// Sembunyikan tab & tombol sesuai peran.
function applyRole() {
  const prodi = isProdi();
  const allow = ['jadwal', 'dosen', 'matakuliah', 'kelas', 'beban']; // prodi: jadwal hanya-baca
  $$('#tabs .tab').forEach(b => { b.hidden = (prodi && !allow.includes(b.dataset.tab)) || (b.dataset.admin === '1' && !isAdmin()); });
  // Prodi: jadwal read-only → sembunyikan tombol tulis (biarkan Cetak SK & Export Excel).
  ['btnAuto', 'btnTambahJadwal', 'btnResetJadwal'].forEach(id => { const el = $('#' + id); if (el) el.hidden = prodi; });
  // Bila tab aktif tersembunyi, pindah ke tab pertama yang terlihat.
  const act = $('#tabs .tab.active');
  if (act && act.hidden) {
    const first = $$('#tabs .tab').find(t => !t.hidden);
    if (first) {
      $$('#tabs .tab').forEach(x => x.classList.remove('active')); first.classList.add('active'); activeTab = first.dataset.tab;
      $$('.panel').forEach(p => p.classList.remove('active')); $('#panel-' + activeTab).classList.add('active');
    }
  }
}

async function bootApp() {
  await loadDB();
  setupTabs();
  setupModal();
  renderUserBox();
  applyRole();
  renderPeriode();
  renderPeriodeFilter();
  renderFilters();
  renderActive();
  $('#btnTambahJadwal').addEventListener('click', () => openJadwalForm());
  $('#btnAuto').addEventListener('click', openAutoForm);
  $('#btnResetJadwal').addEventListener('click', resetJadwal);
  $('#btnCetakSK').addEventListener('click', openCetakSK);
  $('#btnExportJadwal').addEventListener('click', exportJadwal);
  $('#fltPeriode').addEventListener('change', () => { renderDosenFilter(); renderJadwal(); });
  $('#fltProdi').addEventListener('change', () => { renderDosenFilter(); renderSemesterFilter(); renderKelasFilter(); renderJadwal(); });
  $('#fltFakultas').addEventListener('change', () => { renderFilters(); renderJadwal(); });
  $('#fltDosen').addEventListener('change', renderJadwal);
  $('#fltSemester').addEventListener('change', renderJadwal);
  $('#fltKelas').addEventListener('change', renderJadwal);
  $('#fltRuang').addEventListener('change', renderJadwal);
  $('#viewMode').addEventListener('change', renderJadwal);
}

async function start() {
  setupLogin();
  if (TOKEN) {
    const { ok, data } = await api('GET', '/api/me');
    if (ok) { currentUser = data.user; hideLogin(); await bootApp(); return; }
  }
  showLogin();
}

// ---------- Reset jadwal (periode yang sedang dilihat) ----------
async function resetJadwal() {
  const [ta, sem] = ($('#fltPeriode').value || periodeKey(DB.pengaturan || {})).split('||');
  if (!confirm(`Hapus SEMUA jadwal periode ${periodeText(ta, sem)}? Tindakan ini tidak dapat dibatalkan.`)) return;
  const { ok, data } = await api('POST', '/api/jadwal/reset', { tahunAkademik: ta, semesterAktif: sem });
  if (!ok) return toast(data.error || 'Gagal mereset', 'err');
  await loadDB();
  renderPeriodeFilter();
  toast(`${data.removed} jadwal dihapus`);
  renderJadwal();
}

// ---------- Cetak Surat Tugas (SK) → PDF via dialog cetak ----------
function getViewPeriode() {
  const [ta, sem] = ($('#fltPeriode').value || periodeKey(DB.pengaturan || {})).split('||');
  return { ta: ta || '', sem: sem || '' };
}
function jadwalPeriode(ta, sem) {
  return DB.jadwal.filter(j => (j.tahunAkademik || '') === ta && (j.semesterAktif || '') === sem);
}
function skTanggalHariIni() {
  const bln = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const d = new Date();
  return `${d.getDate()} ${bln[d.getMonth()]} ${d.getFullYear()}`;
}
function nl2br(t) { return esc(t).replace(/\n/g, '<br>'); }
function replPlaceholder(t, ctx) {
  return String(t || '')
    .replace(/\{dosen\}/g, ctx.dosen).replace(/\{ta\}/g, ctx.ta)
    .replace(/\{semester\}/g, ctx.semester).replace(/\{kota\}/g, ctx.kota)
    .replace(/\{tanggal\}/g, ctx.tanggal);
}

function openCetakSK() {
  const { ta, sem } = getViewPeriode();
  const rows = jadwalPeriode(ta, sem);
  // Dosen yang punya jadwal pada periode ini (termasuk sebagai pengampu bersama).
  const dosenIds = Array.from(new Set(rows.flatMap(j => dosenIdsOf(j))));
  const dosenList = dosenIds.map(id => DB.dosen.find(d => d.id === id)).filter(Boolean)
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const curDosen = $('#fltDosen') ? $('#fltDosen').value : '';
  const form = $('#modalForm');
  // Kop/letterhead: admin bisa pilih; fakultas & prodi terkunci ke fakultasnya.
  const prodiFakId = isProdi() ? ((DB.prodi.find(p => p.id === currentUser.prodiId) || {}).fakultasId || '') : '';
  const fixedFak = isFakultas() ? currentUser.fakultasId : (isProdi() ? prodiFakId : '');
  let kopSel = '';
  if (isAdmin() && DB.fakultas.length) {
    const opts = DB.fakultas.map(f => `<option value="${f.id}">${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
    kopSel = `<label class="field"><span>Kop / Letterhead</span>
      <select name="skFak"><option value="">Default (global)</option>${opts}</select></label>`;
  }
  form.innerHTML = `
    <p class="hint">Cetak Surat Tugas Mengajar untuk periode <b>${esc(periodeText(ta, sem))}</b>. Hasil dapat disimpan sebagai <b>PDF</b> melalui dialog cetak (pilih "Save as PDF").</p>
    <label class="field"><span>Dosen</span>
      <select name="dosenPilih">
        <option value="">Semua dosen (${dosenList.length}) — tiap dosen 1 halaman</option>
        ${dosenList.map(d => `<option value="${d.id}" ${d.id === curDosen ? 'selected' : ''}>${esc(d.nama)}</option>`).join('')}
      </select></label>
    ${kopSel}
    ${isProdi() ? '' : '<button type="button" class="btn" id="btnAturTemplate">⚙️ Sesuaikan Template SK</button>'}
    ${dosenList.length === 0 ? '<div class="conflict bad">Belum ada jadwal pada periode ini.</div>' : ''}`;
  $('#modalTitle').textContent = 'Cetak Surat Tugas (SK)';
  const tplBtn = $('#btnAturTemplate', form);
  if (tplBtn) tplBtn.addEventListener('click', () => {
    const fId = isAdmin() ? (form.elements['skFak'] ? form.elements['skFak'].value : '') : fixedFak;
    openTemplateSK(fId);
  });
  showModal((e) => {
    e.preventDefault();
    const pilih = form.elements['dosenPilih'].value;
    const targets = pilih ? dosenList.filter(d => d.id === pilih) : dosenList;
    if (targets.length === 0) return setModalMsg('Tidak ada dosen untuk dicetak', 'err');
    const fId = isAdmin() ? (form.elements['skFak'] ? form.elements['skFak'].value : '') : fixedFak;
    cetakSK(targets, ta, sem, templateSKFor(fId));
    hideModal();
  });
  $('#modalSave').textContent = 'Cetak';
}
// Template SK untuk sebuah fakultas (override), atau global bila belum ada.
function templateSKFor(fakultasId) {
  const glob = DB.templateSK || {};
  const ov = fakultasId && (DB.templateSKFak || {})[fakultasId];
  return ov ? Object.assign({}, glob, ov) : glob;
}

function buildSKLetter(dosen, ta, sem, tpl) {
  tpl = tpl || DB.templateSK || {};
  const ctx = { dosen: dosen.nama, ta, semester: sem, kota: tpl.kota || '', tanggal: skTanggalHariIni() };
  const rows = jadwalPeriode(ta, sem).filter(j => dosenIdsOf(j).includes(dosen.id))
    .sort((a, b) => DB.hari.indexOf(a.hari) - DB.hari.indexOf(b.hari) || a.jamMulai.localeCompare(b.jamMulai));
  let totalSks = 0;
  const trs = rows.map(j => {
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    const kelas = DB.kelas.find(k => k.id === j.kelasId);
    const ruang = DB.ruangan.find(r => r.id === j.ruanganId);
    const sks = mk ? (Number(mk.sks) || ((Number(mk.sksTeori) || 0) + (Number(mk.sksPraktik) || 0))) : '';
    totalSks += Number(sks) || 0;
    return `<tr><td>${esc(j.hari)}</td><td>${esc(j.jamMulai)}–${esc(j.jamSelesai)}</td><td>${esc(kelas ? kelas.nama : '-')}</td><td>${esc(mk ? mk.nama : '-')}</td><td class="c">${esc(sks)}</td><td>${esc(ruang ? (ruang.nama || ruang.kode) : '-')}</td></tr>`;
  }).join('');
  const ket = (tpl.ketentuan || '').trim();
  return `
  <section class="sk">
    ${(tpl.logo || tpl.kop) ? `<div class="kop-head">${tpl.logo ? `<img class="kop-logo" src="${tpl.logo}"/>` : ''}${tpl.kop ? `<div class="kop">${nl2br(tpl.kop)}</div>` : ''}</div><hr class="kopline"/>` : ''}
    <div class="judul">${esc(tpl.judul || 'SURAT TUGAS')}</div>
    <div class="nomor">${tpl.nomor ? 'Nomor: ' + esc(replPlaceholder(tpl.nomor, ctx)) : ''}</div>
    <table class="meta"><tbody>
      ${tpl.lampiran ? `<tr><td>Lampiran</td><td>: ${esc(tpl.lampiran)}</td></tr>` : ''}
      ${tpl.hal ? `<tr><td>Hal</td><td>: ${esc(replPlaceholder(tpl.hal, ctx))}</td></tr>` : ''}
    </tbody></table>
    ${tpl.kepada ? `<div class="kepada">${nl2br(replPlaceholder(tpl.kepada, ctx))}</div>` : ''}
    ${tpl.pembuka ? `<p>${nl2br(replPlaceholder(tpl.pembuka, ctx))}</p>` : ''}
    ${tpl.isi ? `<p class="isi">${nl2br(replPlaceholder(tpl.isi, ctx))}</p>` : ''}
    <table class="jadwal">
      <thead><tr><th>Hari</th><th>Jam</th><th>Kelas</th><th>Mata Kuliah</th><th>SKS</th><th>Ruangan</th></tr></thead>
      <tbody>${trs || '<tr><td colspan="6" class="c">(tidak ada jadwal)</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4" class="c">Total SKS</td><td class="c">${totalSks}</td><td></td></tr></tfoot>
    </table>
    ${ket ? `<div class="ketentuan">${nl2br(ket)}</div>` : ''}
    ${tpl.penutup ? `<p>${nl2br(replPlaceholder(tpl.penutup, ctx))}</p>` : ''}
    ${tpl.salam ? `<p>${nl2br(replPlaceholder(tpl.salam, ctx))}</p>` : ''}
    <div class="ttd">
      <div>${esc(ctx.kota)}${ctx.kota ? ', ' : ''}${esc(ctx.tanggal)}</div>
      <div>${esc(tpl.jabatan || '')}</div>
      <div class="sp"></div>
      <div class="nm"><b><u>${esc(tpl.namaPenandatangan || '(..........................)')}</u></b></div>
      ${tpl.nipPenandatangan ? `<div>NIP. ${esc(tpl.nipPenandatangan)}</div>` : ''}
    </div>
  </section>`;
}

function cetakSK(dosenList, ta, sem, tpl) {
  const letters = dosenList.map(d => buildSKLetter(d, ta, sem, tpl)).join('');
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Surat Tugas Mengajar</title>
  <style>
    @page { size: A4; margin: 20mm 20mm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; }
    .sk { page-break-after: always; }
    .sk:last-child { page-break-after: auto; }
    .kop-head { display: flex; align-items: center; justify-content: center; gap: 14px; }
    .kop-logo { height: 90px; width: auto; object-fit: contain; }
    .kop { text-align: center; font-weight: bold; line-height: 1.3; }
    .kopline { border: none; border-top: 3px double #000; margin: 6px 0 14px; }
    .judul { text-align: center; font-weight: bold; text-decoration: underline; font-size: 14pt; margin-top: 6px; }
    .nomor { text-align: center; margin-bottom: 12px; }
    table.meta td { vertical-align: top; padding: 0 4px 0 0; }
    .kepada { margin: 10px 0; }
    p { text-align: justify; margin: 8px 0; line-height: 1.5; }
    table.jadwal { width: 100%; border-collapse: collapse; margin: 10px 0; }
    table.jadwal th, table.jadwal td { border: 1px solid #000; padding: 5px 7px; font-size: 11pt; }
    table.jadwal th { background: #eee; text-align: center; }
    table.jadwal td.c, table.jadwal th { text-align: center; }
    .ketentuan { margin: 8px 0; }
    .ttd { margin-top: 26px; width: 42%; margin-left: auto; text-align: left; }
    .ttd .sp { height: 60px; }
    @media screen { body { background: #f0f0f0; } .sk { background: #fff; max-width: 210mm; margin: 12px auto; padding: 20mm; box-shadow: 0 2px 10px rgba(0,0,0,.2); } }
  </style></head><body onload="setTimeout(function(){window.print();},300)">${letters}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Popup diblokir browser. Izinkan popup untuk mencetak.', 'err'); return; }
  w.document.write(html);
  w.document.close();
}

// ---------- Sesuaikan Template SK ----------
function openTemplateSK(fakultasId) {
  const scope = isFakultas() ? currentUser.fakultasId : (fakultasId || '');
  const t = scope ? templateSKFor(scope) : (DB.templateSK || {});
  const form = $('#modalForm');
  const ta = (v) => esc(v == null ? '' : v);
  let logoData = t.logo || '';
  const scopeNama = scope ? (nameOf('fakultas', scope)) : 'Default (semua fakultas)';
  form.innerHTML = `
    <p class="hint">Template untuk: <b>${esc(scopeNama)}</b>. Placeholder: <code>{dosen}</code> <code>{ta}</code> <code>{semester}</code> <code>{kota}</code> <code>{tanggal}</code>.</p>
    <label class="field"><span>Logo (letterhead)</span>
      <div class="logo-row">
        <img id="skLogoPreview" class="logo-preview ${logoData ? '' : 'kosong'}" src="${logoData || ''}" alt="logo" />
        <div class="logo-btns">
          <input type="file" id="skLogoFile" accept="image/*" hidden />
          <button type="button" class="btn" id="skLogoPick">📁 Pilih Logo</button>
          <button type="button" class="btn danger" id="skLogoDel" ${logoData ? '' : 'disabled'}>Hapus Logo</button>
          <small class="hint">PNG/JPG, maks ~500 KB.</small>
        </div>
      </div></label>
    <label class="field"><span>Kop Surat (teks di samping/di bawah logo)</span><textarea name="kop" rows="3">${ta(t.kop)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Judul</span><input name="judul" value="${ta(t.judul)}" /></label>
      <label class="field"><span>Nomor</span><input name="nomor" value="${ta(t.nomor)}" /></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Lampiran</span><input name="lampiran" value="${ta(t.lampiran)}" /></label>
      <label class="field"><span>Hal</span><input name="hal" value="${ta(t.hal)}" /></label>
    </div>
    <label class="field"><span>Kepada (Yth.)</span><textarea name="kepada" rows="2">${ta(t.kepada)}</textarea></label>
    <label class="field"><span>Pembuka</span><input name="pembuka" value="${ta(t.pembuka)}" /></label>
    <label class="field"><span>Isi/Pengantar</span><textarea name="isi" rows="3">${ta(t.isi)}</textarea></label>
    <label class="field"><span>Ketentuan (opsional)</span><textarea name="ketentuan" rows="3">${ta(t.ketentuan)}</textarea></label>
    <label class="field"><span>Penutup</span><textarea name="penutup" rows="3">${ta(t.penutup)}</textarea></label>
    <label class="field"><span>Salam Penutup</span><input name="salam" value="${ta(t.salam)}" /></label>
    <div class="field-row">
      <label class="field"><span>Kota</span><input name="kota" value="${ta(t.kota)}" /></label>
      <label class="field"><span>Jabatan Penandatangan</span><input name="jabatan" value="${ta(t.jabatan)}" /></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Nama Penandatangan</span><input name="namaPenandatangan" value="${ta(t.namaPenandatangan)}" /></label>
      <label class="field"><span>NIP</span><input name="nipPenandatangan" value="${ta(t.nipPenandatangan)}" /></label>
    </div>`;
  $('#modalTitle').textContent = 'Sesuaikan Template SK';
  const prev = $('#skLogoPreview', form);
  const delBtn = $('#skLogoDel', form);
  $('#skLogoPick', form).addEventListener('click', () => $('#skLogoFile', form).click());
  $('#skLogoFile', form).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) return toast('Logo terlalu besar (maks 500 KB)', 'err');
    const reader = new FileReader();
    reader.onload = () => { logoData = reader.result; prev.src = logoData; prev.classList.remove('kosong'); delBtn.disabled = false; };
    reader.readAsDataURL(file);
  });
  delBtn.addEventListener('click', () => { logoData = ''; prev.src = ''; prev.classList.add('kosong'); delBtn.disabled = true; });
  showModal(async (e) => {
    e.preventDefault();
    const keys = ['kop', 'judul', 'nomor', 'lampiran', 'hal', 'kepada', 'pembuka', 'isi', 'ketentuan', 'penutup', 'salam', 'kota', 'jabatan', 'namaPenandatangan', 'nipPenandatangan'];
    const body = { logo: logoData };
    keys.forEach(k => { body[k] = form.elements[k].value; });
    if (scope) body.fakultasId = scope;
    const { ok, data } = await api('PUT', '/api/config/template-sk', body);
    if (!ok) return setModalMsg(data.error || 'Gagal menyimpan', 'err');
    if (scope) { DB.templateSKFak = DB.templateSKFak || {}; DB.templateSKFak[scope] = data; }
    else DB.templateSK = data;
    hideModal();
    toast('Template SK disimpan');
  });
}

// ---------- Periode akademik ----------
function renderPeriode() {
  const p = DB.pengaturan || {};
  $('#periodeBox').innerHTML = `
    <div class="periode-info">
      <span class="periode-label">Tahun Akademik</span>
      <b>${esc(p.tahunAkademik || '-')}</b>
      <span class="periode-sem">${esc(p.semesterAktif || '-')}</span>
    </div>
    ${isProdi() ? '' : '<button class="btn" id="btnPeriode">⚙️ Atur Periode</button>'}`;
  const btn = $('#btnPeriode');
  if (btn) btn.addEventListener('click', openPeriodeForm);
}

// ---------- Atur Periode (modal melayang, kelola tahun akademik gaya Edu-D) ----------
let periodePilih = null;

function openPeriodeForm() {
  const aktif = DB.pengaturan || {};
  periodePilih = { tahunAkademik: aktif.tahunAkademik, semesterAktif: aktif.semesterAktif };
  $('#modalTitle').textContent = 'Atur Periode Akademik';
  showModal(async (e) => { e.preventDefault(); await saveActivePeriode(); });
  $('#modalSave').textContent = 'Simpan Periode Aktif';
  renderPeriodeModal();
}

function renderPeriodeModal() {
  const form = $('#modalForm');
  const aktif = DB.pengaturan || {};
  const years = (DB.tahunAkademik || []).slice().sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
  const sems = ['Ganjil', 'Genap', 'Pendek'];
  const dirty = periodePilih.tahunAkademik !== aktif.tahunAkademik || periodePilih.semesterAktif !== aktif.semesterAktif;
  const selLabel = periodePilih.tahunAkademik ? periodeText(periodePilih.tahunAkademik, periodePilih.semesterAktif) : '—';

  let html = `
    <div class="periode-banner">Tiap tahun akademik punya periode <b>Ganjil</b> &amp; <b>Genap</b> yang tersimpan terpisah. Pilih satu periode aktif (✓); Dosen, Mata Kuliah &amp; Jadwal mengikuti periode aktif.</div>
    <div class="ta-bar"><span><b>Periode aktif dipilih:</b> ${esc(selLabel)}</span></div>
    <div class="table-wrap"><table><tbody>`;
  years.forEach(y => {
    let btns = '';
    sems.forEach(sem => {
      const selected = y.nama === periodePilih.tahunAkademik && sem === periodePilih.semesterAktif;
      const isActive = y.nama === aktif.tahunAkademik && sem === aktif.semesterAktif;
      btns += `<button type="button" class="btn btn-sm ta-sem ${selected ? 'primary' : ''}" data-pick="${esc(y.nama)}|${sem}">${sem}${isActive ? ' ✓' : ''}</button> `;
    });
    html += `<tr>
      <td><b>${esc(y.nama)}</b></td>
      <td>${btns}</td>
      <td class="col-act">
        <button type="button" class="icon-btn" data-taedit="${y.id}" title="Ubah">✏️</button>
        <button type="button" class="icon-btn danger" data-tadel="${y.id}" title="Hapus">🗑️</button>
      </td></tr>`;
  });
  if (years.length === 0) html += `<tr><td colspan="3"><span class="hint">Belum ada tahun akademik.</span></td></tr>`;
  html += `</tbody></table></div>
    <div class="hari-add" style="margin-top:12px">
      <input type="text" id="taInput" placeholder="mis. 2027/2028" maxlength="20" />
      <button type="button" class="btn" id="taAdd">+ Tambah Tahun</button>
    </div>`;
  form.innerHTML = html;
  $('#modalSave').disabled = !(dirty && periodePilih.tahunAkademik);

  $$('[data-pick]', form).forEach(b => b.addEventListener('click', () => {
    const [ta, sem] = b.dataset.pick.split('|');
    periodePilih = { tahunAkademik: ta, semesterAktif: sem };
    renderPeriodeModal();
  }));
  const inp = $('#taInput', form);
  $('#taAdd', form).addEventListener('click', addYear);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addYear(); } });
  $$('[data-taedit]', form).forEach(b => b.addEventListener('click', () => editYear(b.dataset.taedit)));
  $$('[data-tadel]', form).forEach(b => b.addEventListener('click', () => delYear(b.dataset.tadel)));
}

async function addYear() {
  const inp = $('#taInput');
  const v = (inp.value || '').trim();
  if (!v) return;
  if ((DB.tahunAkademik || []).some(y => (y.nama || '').toLowerCase() === v.toLowerCase())) return toast('Tahun sudah ada', 'warn');
  const { ok, data } = await api('POST', '/api/tahunAkademik', { nama: v });
  if (!ok) return toast(data.error || 'Gagal menambah', 'err');
  await loadDB(); renderPeriodeModal(); renderPeriodeFilter();
}
async function editYear(id) {
  const y = (DB.tahunAkademik || []).find(x => x.id === id);
  if (!y) return;
  const v = prompt('Nama tahun akademik:', y.nama);
  if (v === null) return;
  const nv = v.trim(); if (!nv) return;
  const { ok, data } = await api('PUT', `/api/tahunAkademik/${id}`, { nama: nv });
  if (!ok) return toast(data.error || 'Gagal menyimpan', 'err');
  await loadDB(); renderPeriodeModal(); renderPeriode(); renderPeriodeFilter();
}
async function delYear(id) {
  if (!confirm('Hapus tahun akademik ini? (jadwal/data periode terkait tetap tersimpan)')) return;
  const { ok, data } = await api('DELETE', `/api/tahunAkademik/${id}`);
  if (!ok) return toast(data.error || 'Gagal menghapus', 'err');
  await loadDB(); renderPeriodeModal(); renderPeriodeFilter();
}

async function saveActivePeriode() {
  if (!periodePilih.tahunAkademik) return;
  const { ok, data } = await api('PUT', '/api/config/pengaturan', {
    tahunAkademik: periodePilih.tahunAkademik, semesterAktif: periodePilih.semesterAktif
  });
  if (!ok) return setModalMsg(data.error || 'Gagal menyimpan', 'err');
  await loadDB();
  hideModal();
  toast('Periode aktif disimpan');
  renderPeriode();
  renderPeriodeFilter();
  renderActive();
}

// ---------- Tabs ----------
function setupTabs() {
  $$('#tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#tabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      $$('.panel').forEach(p => p.classList.remove('active'));
      $('#panel-' + activeTab).classList.add('active');
      renderActive();
    });
  });
}
function renderActive() {
  if (activeTab === 'jadwal') { renderFilters(); renderJadwal(); }
  else if (activeTab === 'beban') renderBebanDosen();
  else if (activeTab === 'pengguna') renderPengguna();
  else renderMaster(activeTab);
}

// =====================================================================
// MASTER DATA (generik)
// =====================================================================
let masterProdiFak = ''; // filter fakultas pada tab Program Studi
let masterMkDosen = ''; // filter dosen pada tab Mata Kuliah
let masterRuangFak = ''; // filter fakultas pada tab Ruangan
let jrEditFak = ''; // fakultas yang sedang diedit kategori ruangnya ('' = default global)
let masterDosenFak = ''; // filter fakultas pada tab Dosen
let masterDosenProdi = ''; // filter prodi pada tab Dosen
function renderMaster(col) {
  const s = SCHEMAS[col];
  const panel = $('#panel-' + col);
  let rows = col === 'matakuliah' ? mkAktif()
    : col === 'dosen' ? dosenAktif()
      : col === 'kelas' ? kelasAktif()
        : col === 'semester' ? semesterSesuaiPeriode() : (DB[col] || []);
  if (col === 'prodi' && masterProdiFak) rows = rows.filter(p => p.fakultasId === masterProdiFak);
  if (col === 'matakuliah' && masterMkDosen) rows = rows.filter(m => dosenIdsOf(m).includes(masterMkDosen));
  if (col === 'ruangan' && masterRuangFak) rows = rows.filter(r => r.fakultasId === masterRuangFak);
  if (col === 'dosen' && masterDosenFak) rows = rows.filter(d => { const p = DB.prodi.find(x => x.id === d.prodiId); return p && p.fakultasId === masterDosenFak; });
  if (col === 'dosen' && masterDosenProdi) rows = rows.filter(d => d.prodiId === masterDosenProdi);
  const bulk = (col === 'matakuliah' || col === 'dosen' || col === 'kelas');
  const hasIO = ['matakuliah', 'dosen', 'ruangan', 'kelas', 'fakultas', 'prodi'].includes(col);
  const extraBtn = hasIO
    ? `<button class="btn" data-template="1">📄 Template</button>
       <button class="btn" data-export="1">⬇️ Export</button>
       <button class="btn" data-import="1">⬆️ Import</button>
       ${bulk ? '<button class="btn danger" data-bulkdel="1" disabled>🗑️ Hapus Terpilih</button>' : ''}
       <input type="file" id="${col}ImportFile" accept=".xlsx,.xls,.csv" hidden />`
    : '';
  let html = `
    <div class="toolbar">
      <h2>${esc(s.label)} <span class="count">${rows.length}</span></h2>
      <div class="actions">${extraBtn}<button class="btn primary" data-add="${col}">+ Tambah ${esc(s.label)}</button></div>
    </div>`;
  if (col === 'prodi') {
    const opts = DB.fakultas.map(f => `<option value="${f.id}" ${masterProdiFak === f.id ? 'selected' : ''}>${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
    html += `<div class="filters" style="margin-bottom:14px"><label>Fakultas
      <select id="prodiFakFilter"><option value="">Semua Fakultas</option>${opts}</select></label></div>`;
  }
  if (col === 'matakuliah') {
    // Daftar dosen yang mengampu pada periode aktif (unik), untuk filter.
    const idset = new Set();
    mkAktif().forEach(m => dosenIdsOf(m).forEach(id => idset.add(id)));
    const opts = dosenAktif().filter(d => idset.has(d.id))
      .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
      .map(d => `<option value="${d.id}" ${masterMkDosen === d.id ? 'selected' : ''}>${esc(d.nama)}${dosenIdent(d) ? ' (' + esc(dosenIdent(d)) + ')' : ''}</option>`).join('');
    html += `<div class="filters" style="margin-bottom:14px"><label>Dosen
      <select id="mkDosenFilter"><option value="">Semua Dosen</option>${opts}</select></label></div>`;
  }
  if (col === 'ruangan' && !isFakultas() && DB.fakultas.length) {
    const opts = DB.fakultas.map(f => `<option value="${f.id}" ${masterRuangFak === f.id ? 'selected' : ''}>${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
    html += `<div class="filters" style="margin-bottom:14px"><label>Fakultas (pemilik ruang)
      <select id="ruangFakFilter"><option value="">Semua Fakultas</option>${opts}</select></label></div>`;
  }
  if (col === 'dosen') {
    const p = DB.pengaturan || {};
    html += `<div class="periode-banner">👨‍🏫 Daftar dosen <b>berlaku di semua Tahun Akademik &amp; Semester</b> — cukup dikelola sekali dan otomatis tersedia pada setiap periode.</div>`;
    // Filter: admin = Fakultas + Prodi; fakultas = Prodi saja; prodi = tanpa filter.
    if (!isProdi()) {
      let fh = '<div class="filters" style="margin-bottom:14px">';
      if (!isFakultas()) {
        const fopts = DB.fakultas.map(f => `<option value="${f.id}" ${masterDosenFak === f.id ? 'selected' : ''}>${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
        fh += `<label>Fakultas <select id="dosenFakFilter"><option value="">Semua Fakultas</option>${fopts}</select></label>`;
      }
      const prodiSrc = DB.prodi.filter(pr => isFakultas() || !masterDosenFak || pr.fakultasId === masterDosenFak);
      const popts = prodiSrc.map(pr => `<option value="${pr.id}" ${masterDosenProdi === pr.id ? 'selected' : ''}>${esc(pr.kode ? pr.kode + ' ' + pr.nama : pr.nama)}</option>`).join('');
      fh += `<label>Program Studi <select id="dosenProdiFilter"><option value="">Semua Prodi</option>${popts}</select></label>`;
      fh += '</div>';
      html += fh;
    }
  }
  if (col === 'kelas') {
    const p = DB.pengaturan || {};
    html += `<div class="periode-banner">👥 Menampilkan kelas periode <b>${esc(periodeText(p.tahunAkademik, p.semesterAktif))}</b>. Tiap Tahun Akademik &amp; Semester punya daftar kelas sendiri — ganti lewat <b>Atur Periode</b>.</div>`;
  }
  if (rows.length === 0) {
    html += `<div class="empty">Belum ada data ${esc(s.label)}.</div>`;
  } else {
    html += '<div class="table-wrap"><table><thead><tr>';
    if (bulk) html += '<th class="col-chk"><input type="checkbox" id="chkAll" title="Pilih semua"></th>';
    s.columns.forEach(c => html += `<th>${esc(c.t)}</th>`);
    html += '<th class="col-act">Aksi</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>';
      if (bulk) html += `<td class="col-chk"><input type="checkbox" class="rowchk" data-id="${r.id}"></td>`;
      s.columns.forEach(c => {
        let v = r[c.k];
        if (c.fmt) v = c.fmt(r);
        else if (c.ref) v = nameOf(c.ref, r[c.k]);
        html += `<td>${esc(v)}</td>`;
      });
      html += `<td class="col-act">
        <button class="icon-btn" data-edit="${col}" data-id="${r.id}" title="Ubah">✏️</button>
        <button class="icon-btn danger" data-del="${col}" data-id="${r.id}" title="Hapus">🗑️</button>
      </td></tr>`;
    });
    html += '</tbody></table></div>';
  }
  // Tab Slot Waktu juga memuat pengelola Hari Kuliah.
  if (col === 'slot') html = hariEditorHtml() +
    `<div class="periode-banner">⏱️ Cukup tentukan <b>rentang jam</b> tiap kelompok (mis. Pagi 07.00–12.00, Siang 13.00–18.00). Durasi tiap kuliah dihitung otomatis dari <b>SKS</b> (1 SKS = ${Number((DB.pengaturan || {}).menitPerSks) || 45} menit) saat Auto-generate.</div>` + html;
  // Tab Ruangan memuat pengelola Kategori Ruang.
  if (col === 'ruangan') html = jenisRuangEditorHtml() + html;
  panel.innerHTML = html;
  const addBtn = col === 'matakuliah' ? () => openOfferingForm() : () => openRecordForm(col);
  panel.querySelector('[data-add]').addEventListener('click', addBtn);
  $$('[data-edit]', panel).forEach(b => b.addEventListener('click', () => {
    const rec = DB[col].find(x => x.id === b.dataset.id);
    if (col === 'matakuliah') openOfferingForm(rec); else openRecordForm(col, rec);
  }));
  $$('[data-del]', panel).forEach(b => b.addEventListener('click', () => delRecord(col, b.dataset.id)));
  if (bulk) {
    const chkAll = panel.querySelector('#chkAll');
    const chks = $$('.rowchk', panel);
    const bulkBtn = panel.querySelector('[data-bulkdel]');
    const sync = () => {
      const sel = chks.filter(c => c.checked);
      if (bulkBtn) {
        bulkBtn.disabled = sel.length === 0;
        bulkBtn.textContent = sel.length ? `🗑️ Hapus Terpilih (${sel.length})` : '🗑️ Hapus Terpilih';
      }
      if (chkAll) chkAll.checked = chks.length > 0 && sel.length === chks.length;
    };
    if (chkAll) chkAll.addEventListener('change', () => { chks.forEach(c => c.checked = chkAll.checked); sync(); });
    chks.forEach(c => c.addEventListener('change', sync));
    if (bulkBtn) bulkBtn.addEventListener('click', () => delRecordBulk(col, chks.filter(c => c.checked).map(c => c.dataset.id)));
  }
  if (col === 'prodi') {
    const f = panel.querySelector('#prodiFakFilter');
    if (f) f.addEventListener('change', () => { masterProdiFak = f.value; renderMaster('prodi'); });
  }
  if (col === 'matakuliah') {
    const f = panel.querySelector('#mkDosenFilter');
    if (f) f.addEventListener('change', () => { masterMkDosen = f.value; renderMaster('matakuliah'); });
  }
  if (col === 'ruangan') {
    const f = panel.querySelector('#ruangFakFilter');
    if (f) f.addEventListener('change', () => { masterRuangFak = f.value; renderMaster('ruangan'); });
  }
  if (col === 'dosen') {
    const ff = panel.querySelector('#dosenFakFilter');
    if (ff) ff.addEventListener('change', () => { masterDosenFak = ff.value; masterDosenProdi = ''; renderMaster('dosen'); });
    const pf = panel.querySelector('#dosenProdiFilter');
    if (pf) pf.addEventListener('change', () => { masterDosenProdi = pf.value; renderMaster('dosen'); });
  }
  if (col === 'slot') bindHariEditor(panel);
  if (col === 'ruangan') bindJenisRuangEditor(panel);
  if (col === 'matakuliah') bindOfferExportImport(panel);
  if (col === 'dosen') bindDosenExportImport(panel);
  if (col === 'ruangan') bindRuanganExportImport(panel);
  if (col === 'kelas') bindKelasExportImport(panel);
  if (col === 'fakultas') bindFakultasExportImport(panel);
  if (col === 'prodi') bindProdiExportImport(panel);
}

// ---------- Beban Dosen (rekap jumlah mengajar per dosen) ----------
let bebanState = { fak: '', prodi: '', sort: 'sks', dir: 'desc', ambang: 12 };
function hitungBebanDosen() {
  const perSks = Number((DB.pengaturan || {}).menitPerSks) || 45;
  const allMk = mkAktifSemua();   // beban total lintas prodi/fakultas
  const myMk = mkAktif();         // MK dalam lingkup akun (prodi/fakultas/semua)
  const prodiAll = (DB.prodiSemua && DB.prodiSemua.length) ? DB.prodiSemua : DB.prodi;
  // Dosen homebase (lingkup) + dosen "tamu" yang dipakai di MK lingkup ini.
  const homebaseIds = new Set(dosenAktif().map(d => d.id));
  const shownIds = new Set(homebaseIds);
  myMk.forEach(m => dosenIdsOf(m).forEach(id => shownIds.add(id)));
  const dosenById = (id) => (DB.dosen || []).find(x => x.id === id) || (DB.dosenSemua || []).find(x => x.id === id);
  return Array.from(shownIds).map(id => {
    const d = dosenById(id);
    if (!d) return null;
    const totalList = allMk.filter(m => dosenIdsOf(m).includes(id));
    const scopeList = myMk.filter(m => dosenIdsOf(m).includes(id));
    const sks = totalList.reduce((a, m) => a + (Number(m.sks) || ((Number(m.sksTeori) || 0) + (Number(m.sksPraktik) || 0))), 0);
    const kelasSet = new Set(totalList.map(m => m.kelasId).filter(Boolean));
    const jamMinggu = Math.round((sks * perSks / 60) * 10) / 10;
    const p = prodiAll.find(x => x.id === d.prodiId);
    return {
      id, nama: d.nama, kode: dosenIdent(d), prodiId: d.prodiId,
      prodiNama: p ? (p.kode ? p.kode + ' ' + p.nama : p.nama) : '-', fakultasId: p ? p.fakultasId : '',
      mk: totalList.length, sks, kelas: kelasSet.size, jam: jamMinggu,
      mkScope: scopeList.length, tamu: !homebaseIds.has(id)
    };
  }).filter(Boolean);
}
function renderBebanDosen() {
  const panel = $('#panel-beban');
  const p = DB.pengaturan || {};
  const scoped = isProdi() || isFakultas(); // lingkup terbatas → tampilkan kolom "MK di sini" & dosen tamu
  const lingkupNama = isProdi() ? 'Prodi Ini' : (isFakultas() ? 'Fakultas Ini' : '');
  const fakOpts = DB.fakultas.map(f => `<option value="${f.id}" ${bebanState.fak === f.id ? 'selected' : ''}>${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
  const prodiSrc = DB.prodi.filter(pr => !bebanState.fak || pr.fakultasId === bebanState.fak);
  const prodiOpts = prodiSrc.map(pr => `<option value="${pr.id}" ${bebanState.prodi === pr.id ? 'selected' : ''}>${esc(pr.kode ? pr.kode + ' ' + pr.nama : pr.nama)}</option>`).join('');

  let rows = hitungBebanDosen();
  if (!scoped && bebanState.fak) rows = rows.filter(r => r.fakultasId === bebanState.fak);
  if (!scoped && bebanState.prodi) rows = rows.filter(r => r.prodiId === bebanState.prodi);

  const dir = bebanState.dir === 'asc' ? 1 : -1;
  const key = bebanState.sort;
  rows.sort((a, b) => {
    if (key === 'nama' || key === 'prodiNama') return dir * String(a[key]).localeCompare(String(b[key]));
    return dir * ((a[key] || 0) - (b[key] || 0)) || String(a.nama).localeCompare(String(b.nama));
  });

  const nDosen = rows.length;
  const totSks = rows.reduce((a, r) => a + r.sks, 0);
  const totMk = rows.reduce((a, r) => a + r.mk, 0);
  const avgSks = nDosen ? Math.round((totSks / nDosen) * 10) / 10 : 0;
  const avgMk = nDosen ? Math.round((totMk / nDosen) * 10) / 10 : 0;
  const ambang = Number(bebanState.ambang) || 12;
  const tanpaMk = rows.filter(r => r.mk === 0).length;
  const lebih = rows.filter(r => r.sks > ambang).length;
  const nTamu = rows.filter(r => r.tamu).length;

  const arrow = (k) => bebanState.sort === k ? (bebanState.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const warna = (r) => {
    if (r.sks === 0) return 'beban-kosong';
    if (r.sks > ambang) return 'beban-lebih';
    if (r.sks < avgSks) return 'beban-kurang';
    return 'beban-ideal';
  };

  let html = `
    <div class="toolbar">
      <h2>Beban Dosen <span class="count">${nDosen}</span></h2>
    </div>
    <div class="periode-banner">📊 Rekap periode <b>${esc(periodeText(p.tahunAkademik, p.semesterAktif))}</b>. <b>Total SKS/MK dihitung dari SELURUH mata kuliah</b> (termasuk di prodi &amp; fakultas lain), 1 SKS = ${Number(p.menitPerSks) || 45} menit.${scoped ? ` Dosen berlabel <span class="jbadge daring">Tamu</span> = bukan homebase ${esc(lingkupNama.toLowerCase())} tapi dipakai di MK ${esc(lingkupNama.toLowerCase())}.` : ''} Warna: 🟩 ideal · 🟨 di bawah rata-rata · 🟥 di atas ambang · ⬜ belum mengajar.</div>
    <div class="filters" style="margin-bottom:14px">
      ${scoped ? '' : `<label>Fakultas
        <select id="bebanFak"><option value="">Semua Fakultas</option>${fakOpts}</select></label>
      <label>Program Studi
        <select id="bebanProdi"><option value="">Semua Prodi</option>${prodiOpts}</select></label>`}
      <label>Ambang Total SKS
        <input type="number" id="bebanAmbang" min="1" value="${ambang}" style="width:90px" /></label>
    </div>
    <div class="beban-ringkas">
      <span class="beban-kpi">Dosen: <b>${nDosen}</b></span>
      <span class="beban-kpi">Rata-rata SKS: <b>${avgSks}</b></span>
      <span class="beban-kpi">Total SKS: <b>${totSks}</b></span>
      <span class="beban-kpi beban-lebih-txt">Di atas ambang (&gt;${ambang}): <b>${lebih}</b></span>
      ${scoped ? `<span class="beban-kpi">Dosen tamu: <b>${nTamu}</b></span>` : `<span class="beban-kpi beban-kosong-txt">Belum mengajar: <b>${tanpaMk}</b></span>`}
    </div>`;

  if (nDosen === 0) {
    html += `<div class="empty">Tidak ada dosen pada lingkup ini.</div>`;
  } else {
    html += `<div class="table-wrap"><table><thead><tr>
      <th class="sortable" data-sort="nama">Nama${arrow('nama')}</th>
      <th class="sortable" data-sort="prodiNama">Program Studi (homebase)${arrow('prodiNama')}</th>
      ${scoped ? `<th class="c sortable" data-sort="mkScope">MK di ${esc(lingkupNama)}${arrow('mkScope')}</th>` : ''}
      <th class="c sortable" data-sort="mk">${scoped ? 'Total MK' : 'Jumlah MK'}${arrow('mk')}</th>
      <th class="c sortable" data-sort="sks">Total SKS${arrow('sks')}</th>
      <th class="c sortable" data-sort="kelas">Jumlah Kelas${arrow('kelas')}</th>
      <th class="c sortable" data-sort="jam">Jam/Minggu${arrow('jam')}</th>
    </tr></thead><tbody>`;
    rows.forEach(r => {
      html += `<tr class="${warna(r)}">
        <td><a href="#" class="beban-nama" data-dosen="${r.id}" title="Lihat mata kuliah dosen ini">${esc(r.nama)}</a>${r.tamu ? ' <span class="jbadge daring">Tamu</span>' : ''}${r.kode ? ' <small class="muted">' + esc(r.kode) + '</small>' : ''}</td>
        <td>${esc(r.prodiNama)}</td>
        ${scoped ? `<td class="c"><b>${r.mkScope}</b></td>` : ''}
        <td class="c">${r.mk}</td>
        <td class="c"><b>${r.sks}</b></td>
        <td class="c">${r.kelas}</td>
        <td class="c">${r.jam}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }
  panel.innerHTML = html;

  const fEl = panel.querySelector('#bebanFak');
  if (fEl) fEl.addEventListener('change', (e) => { bebanState.fak = e.target.value; bebanState.prodi = ''; renderBebanDosen(); });
  const pEl = panel.querySelector('#bebanProdi');
  if (pEl) pEl.addEventListener('change', (e) => { bebanState.prodi = e.target.value; renderBebanDosen(); });
  panel.querySelector('#bebanAmbang').addEventListener('change', (e) => { bebanState.ambang = Number(e.target.value) || 12; renderBebanDosen(); });
  $$('.sortable', panel).forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (bebanState.sort === k) bebanState.dir = bebanState.dir === 'asc' ? 'desc' : 'asc';
    else { bebanState.sort = k; bebanState.dir = (k === 'nama' || k === 'prodiNama') ? 'asc' : 'desc'; }
    renderBebanDosen();
  }));
  $$('.beban-nama', panel).forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    bukaMkDosen(a.dataset.dosen);
  }));
}

// Pindah ke tab Mata Kuliah dan tampilkan mata kuliah dosen terpilih.
function bukaMkDosen(dosenId) {
  const btn = document.querySelector('#tabs .tab[data-tab="matakuliah"]');
  $$('#tabs .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  activeTab = 'matakuliah';
  $$('.panel').forEach(p => p.classList.remove('active'));
  $('#panel-matakuliah').classList.add('active');
  masterMkDosen = dosenId;
  renderMaster('matakuliah');
}

// ---------- Kelola Pengguna (admin) ----------
let penggunaState = { role: '', q: '' };
async function renderPengguna() {
  const panel = $('#panel-pengguna');
  panel.innerHTML = `<div class="toolbar"><h2>Kelola Pengguna</h2></div><div class="empty">Memuat…</div>`;
  const { ok, data } = await api('GET', '/api/users');
  if (!ok) { panel.innerHTML = `<div class="empty">Gagal memuat pengguna: ${esc((data && data.error) || '')}</div>`; return; }
  const all = data;
  let rows = all.slice();
  if (penggunaState.role) rows = rows.filter(u => u.role === penggunaState.role);
  const q = penggunaState.q.trim().toLowerCase();
  if (q) rows = rows.filter(u => (u.username + ' ' + u.nama + ' ' + u.lingkup).toLowerCase().includes(q));
  const rank = { admin: 0, fakultas: 1, prodi: 2 };
  rows.sort((a, b) => (rank[a.role] - rank[b.role]) || a.username.localeCompare(b.username));
  const cnt = { admin: all.filter(u => u.role === 'admin').length, fakultas: all.filter(u => u.role === 'fakultas').length, prodi: all.filter(u => u.role === 'prodi').length };
  const badge = (r) => `<span class="rolebadge2 ${r}">${r === 'admin' ? 'Admin' : r === 'fakultas' ? 'Fakultas' : 'Prodi'}</span>`;
  let html = `
    <div class="toolbar">
      <h2>Kelola Pengguna <span class="count">${all.length}</span></h2>
      <div class="actions"><button class="btn primary" id="btnAddAdmin">+ Tambah Admin</button></div>
    </div>
    <div class="periode-banner">🔐 Username & password awal = kode entitas (mis. prodi <b>86206</b>, fakultas <b>FKIP</b>). Akun prodi/fakultas dibuat otomatis — bisa direset/dinonaktifkan, tidak dihapus. Admin: ${cnt.admin} · Fakultas: ${cnt.fakultas} · Prodi: ${cnt.prodi}.</div>
    <div class="filters" style="margin-bottom:14px">
      <label>Peran <select id="pgRole">
        <option value="">Semua</option>
        <option value="admin" ${penggunaState.role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="fakultas" ${penggunaState.role === 'fakultas' ? 'selected' : ''}>Fakultas</option>
        <option value="prodi" ${penggunaState.role === 'prodi' ? 'selected' : ''}>Prodi</option>
      </select></label>
      <label>Cari <input id="pgSearch" type="text" placeholder="username / nama / lingkup" value="${esc(penggunaState.q)}" /></label>
    </div>`;
  if (rows.length === 0) html += `<div class="empty">Tidak ada pengguna pada filter ini.</div>`;
  else {
    html += `<div class="table-wrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Lingkup</th><th>Status</th><th class="col-act">Aksi</th></tr></thead><tbody>`;
    rows.forEach(u => {
      const self = currentUser && u.id === currentUser.id;
      html += `<tr>
        <td><b>${esc(u.username)}</b>${self ? ' <small class="muted">(Anda)</small>' : ''}</td>
        <td>${esc(u.nama)}</td>
        <td>${badge(u.role)}</td>
        <td>${esc(u.lingkup)}</td>
        <td>${u.nonaktif ? '<span class="statusbadge off">Nonaktif</span>' : '<span class="statusbadge on">Aktif</span>'}</td>
        <td class="col-act">
          <button class="icon-btn" data-reset="${u.id}" title="Reset password ke default (= username)">♻️</button>
          <button class="icon-btn" data-setpass="${u.id}" title="Set password">🔑</button>
          <button class="icon-btn" data-toggle="${u.id}" data-non="${u.nonaktif ? 1 : 0}" title="${u.nonaktif ? 'Aktifkan' : 'Nonaktifkan'}">${u.nonaktif ? '✅' : '🚫'}</button>
          ${u.role === 'admin' && !self ? `<button class="icon-btn danger" data-deluser="${u.id}" title="Hapus admin">🗑️</button>` : ''}
        </td></tr>`;
    });
    html += `</tbody></table></div>`;
  }
  panel.innerHTML = html;
  $('#pgRole', panel).addEventListener('change', e => { penggunaState.role = e.target.value; renderPengguna(); });
  const s = $('#pgSearch', panel);
  s.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); renderPengguna(); } });
  s.addEventListener('change', () => renderPengguna());
  $('#btnAddAdmin', panel).addEventListener('click', openAddAdmin);
  $$('[data-reset]', panel).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Reset password pengguna ini ke default (= username)?')) return;
    const { ok, data } = await api('POST', `/api/users/${b.dataset.reset}/reset`);
    if (!ok) return toast(data.error || 'Gagal', 'err');
    toast('Password direset ke: ' + data.password, 'ok');
  }));
  $$('[data-setpass]', panel).forEach(b => b.addEventListener('click', async () => {
    const pw = prompt('Password baru (min. 4 karakter):');
    if (pw == null) return;
    if (pw.length < 4) return toast('Minimal 4 karakter', 'err');
    const { ok, data } = await api('PUT', `/api/users/${b.dataset.setpass}`, { password: pw });
    if (!ok) return toast(data.error || 'Gagal', 'err');
    toast('Password diperbarui', 'ok');
  }));
  $$('[data-toggle]', panel).forEach(b => b.addEventListener('click', async () => {
    const non = b.dataset.non === '1';
    const { ok, data } = await api('PUT', `/api/users/${b.dataset.toggle}`, { nonaktif: !non });
    if (!ok) return toast(data.error || 'Gagal', 'err');
    toast(non ? 'Akun diaktifkan' : 'Akun dinonaktifkan', 'ok'); renderPengguna();
  }));
  $$('[data-deluser]', panel).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus akun admin ini?')) return;
    const { ok, data } = await api('DELETE', `/api/users/${b.dataset.deluser}`);
    if (!ok) return toast(data.error || 'Gagal', 'err');
    toast('Akun dihapus', 'ok'); renderPengguna();
  }));
}
function openAddAdmin() {
  const form = $('#modalForm');
  form.innerHTML = `
    <label class="field"><span>Username *</span><input name="username" autocomplete="off" required /></label>
    <label class="field"><span>Nama</span><input name="nama" /></label>
    <label class="field"><span>Password *</span><input name="password" type="text" placeholder="min. 4 karakter" required /></label>
    <p class="hint">Akun ini berperan <b>Admin (master)</b> dengan akses penuh.</p>`;
  $('#modalTitle').textContent = 'Tambah Admin';
  showModal(async (e) => {
    e.preventDefault();
    const body = { username: form.elements['username'].value.trim(), nama: form.elements['nama'].value.trim(), password: form.elements['password'].value };
    if (!body.username || body.password.length < 4) return setModalMsg('Username wajib & password minimal 4 karakter', 'err');
    const { ok, data } = await api('POST', '/api/users', body);
    if (!ok) return setModalMsg(data.error || 'Gagal', 'err');
    hideModal(); toast('Admin baru dibuat', 'ok'); renderPengguna();
  });
}

// ---------- Form Penawaran Mata Kuliah (Master MK + Kelas + Dosen) ----------
function openOfferingForm(record) {
  const form = $('#modalForm');
  const r = record || {};
  const prodiOpts = DB.prodi.map(p => `<option value="${p.id}">${esc(p.kode ? p.kode + ' ' + p.nama : p.nama)}</option>`).join('');
  const semOpts = semesterSesuaiPeriode()
    .map(s => `<option value="${s.nomor}">${esc(s.nama || ('Semester ' + s.nomor))}</option>`).join('');
  const jrOpts = (DB.jenisRuang || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');

  form.innerHTML = `
    <label class="field"><span>Program Studi *</span>
      <select name="prodiId" required><option value="">— pilih —</option>${prodiOpts}</select></label>
    <label class="field"><span>Semester *</span>
      <select name="semester" required><option value="">— pilih —</option>${semOpts}</select></label>
    <label class="field"><span>Kode MK</span><input name="kode" /></label>
    <label class="field"><span>Mata Kuliah *</span>
      <input name="nama" list="mkNamaList" autocomplete="off" placeholder="ketik nama mata kuliah" required />
      <datalist id="mkNamaList"></datalist></label>
    <div class="field-row">
      <label class="field"><span>SKS Teori *</span><input type="number" name="sksTeori" min="0" required /></label>
      <label class="field"><span>SKS Praktik</span><input type="number" name="sksPraktik" min="0" /></label>
    </div>
    <label class="field"><span>Jenis Ruang</span>
      <select name="jenisRuang">${jrOpts}</select></label>
    <label class="field"><span>Kelas *</span>
      <select name="kelasId" required><option value="">— pilih kelas —</option></select></label>
    <label class="field"><span>Dosen * <small class="hint-inline">(ketik untuk mencari; bisa lebih dari satu, boleh dari prodi lain)</small></span>
      <div id="dosenChips" class="chips"></div>
      <input name="dosenCari" list="dosenList" autocomplete="off" placeholder="ketik nama / NIP-NIDN dosen lalu pilih" />
      <datalist id="dosenList"></datalist></label>`;

  const el = (n) => form.elements[n];

  // Daftar dosen (lintas prodi) untuk pencarian ketik; peta label -> id.
  const dosenMap = new Map();
  const dosenLabelById = new Map();
  function labelDosen(d) {
    const p = DB.prodi.find(x => x.id === d.prodiId);
    const pk = p ? (p.kode || p.nama) : '';
    let label = d.nama + (pk ? ' — ' + pk : '') + (dosenIdent(d) ? ' — ' + dosenIdent(d) : '');
    let base = label, n = 2;
    while (dosenMap.has(label)) { label = base + ' #' + n; n++; }
    return label;
  }
  function fillDosenList() {
    dosenMap.clear(); dosenLabelById.clear();
    const list = dosenPilihan().slice().sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    const opts = list.map(d => {
      const label = labelDosen(d);
      dosenMap.set(label, d.id);
      dosenLabelById.set(d.id, label);
      return `<option value="${esc(label)}">`;
    }).join('');
    $('#dosenList', form).innerHTML = opts;
  }
  fillDosenList();

  function refill() {
    const pid = el('prodiId').value, sem = el('semester').value;
    // Kelas sesuai prodi + semester, dalam periode aktif.
    const kelas = (pid && sem) ? kelasAktif().filter(k => k.prodiId === pid && Number(k.semester) === Number(sem)) : [];
    el('kelasId').innerHTML = `<option value="">— pilih kelas —</option>` +
      kelas.map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('');
    if (r.kelasId) el('kelasId').value = r.kelasId;
    // Jenis ruang mengikuti kategori fakultas dari prodi terpilih.
    const prodiSel = DB.prodi.find(x => x.id === pid);
    const fId = prodiSel ? prodiSel.fakultasId : '';
    const curJr = el('jenisRuang').value || (record ? r.jenisRuang : '');
    const jrList = jenisRuangFor(fId).slice();
    if (curJr && !jrList.includes(curJr)) jrList.unshift(curJr);
    el('jenisRuang').innerHTML = jrList.map(x => `<option value="${esc(x)}" ${x === curJr ? 'selected' : ''}>${esc(x)}</option>`).join('');
    // Daftar pilihan nama MK: prodi+semester dahulu (paling relevan), lalu seluruh MK (lintas prodi) sebagai katalog.
    const utama = mkAktif().filter(m => (!pid || m.prodiId === pid) && (!sem || Number(m.semester) === Number(sem))).map(m => m.nama);
    const semua = mkAktifSemua().map(m => m.nama);
    const namaUnik = Array.from(new Set([...utama, ...semua].filter(Boolean)));
    $('#mkNamaList', form).innerHTML = namaUnik.map(n => `<option value="${esc(n)}">`).join('');
  }
  // Bila nama MK cocok penawaran yang ada, isi otomatis kode/SKS/jenis ruang.
  function prefillFromMaster() {
    const pid = el('prodiId').value, sem = el('semester').value, nama = el('nama').value.trim().toLowerCase();
    const m = mkAktif().find(x => x.prodiId === pid && Number(x.semester) === Number(sem) && (x.nama || '').toLowerCase() === nama);
    if (m) {
      el('kode').value = m.kode || '';
      el('sksTeori').value = m.sksTeori != null ? m.sksTeori : '';
      el('sksPraktik').value = m.sksPraktik != null ? m.sksPraktik : '';
      if (m.jenisRuang) el('jenisRuang').value = m.jenisRuang;
    }
  }

  // Prefill saat edit.
  if (record) {
    el('prodiId').value = r.prodiId || '';
    el('semester').value = r.semester || '';
    el('nama').value = r.nama || '';
    el('kode').value = r.kode || '';
    el('sksTeori').value = r.sksTeori != null ? r.sksTeori : '';
    el('sksPraktik').value = r.sksPraktik != null ? r.sksPraktik : '';
    if (r.jenisRuang) el('jenisRuang').value = r.jenisRuang;
  }
  refill();
  // Dosen terpilih (bisa lebih dari satu).
  const selectedDosen = [];
  function renderChips() {
    const box = $('#dosenChips', form);
    if (!selectedDosen.length) { box.innerHTML = '<span class="hint" style="margin:2px 0">Belum ada dosen dipilih.</span>'; return; }
    box.innerHTML = selectedDosen.map(id => {
      const d = DB.dosen.find(x => x.id === id) || (DB.dosenSemua || []).find(x => x.id === id);
      const nm = d ? d.nama : '(dosen)';
      return `<span class="chip">${esc(nm)}<button type="button" class="chip-x" data-rm="${id}" title="Hapus">✕</button></span>`;
    }).join('');
    $$('.chip-x', box).forEach(b => b.addEventListener('click', () => {
      const i = selectedDosen.indexOf(b.dataset.rm);
      if (i >= 0) selectedDosen.splice(i, 1);
      renderChips();
    }));
  }
  if (record) {
    const ids = Array.isArray(r.dosenIds) && r.dosenIds.length ? r.dosenIds : (r.dosenId ? [r.dosenId] : []);
    ids.forEach(id => { if (!selectedDosen.includes(id)) selectedDosen.push(id); });
  }
  renderChips();
  // Tambah dosen dari ketikan (cocok label -> id).
  function tambahDosen() {
    const v = el('dosenCari').value.trim();
    const id = dosenMap.get(v);
    if (id) {
      if (!selectedDosen.includes(id)) selectedDosen.push(id);
      el('dosenCari').value = '';
      renderChips();
    }
  }
  el('dosenCari').addEventListener('input', tambahDosen);
  el('dosenCari').addEventListener('change', tambahDosen);
  // Akun prodi: kunci Program Studi ke prodinya.
  if (isProdi()) { el('prodiId').value = currentUser.prodiId; el('prodiId').disabled = true; refill(); }
  el('prodiId').addEventListener('change', refill);
  el('semester').addEventListener('change', refill);
  el('nama').addEventListener('change', prefillFromMaster);

  $('#modalTitle').textContent = record ? 'Ubah Penawaran' : 'Tambah Penawaran';
  showModal(async (e) => {
    e.preventDefault();
    const prodiId = el('prodiId').value;
    const semester = Number(el('semester').value) || '';
    const nama = el('nama').value.trim();
    const kode = el('kode').value.trim();
    const sksTeori = Number(el('sksTeori').value) || 0;
    const sksPraktik = Number(el('sksPraktik').value) || 0;
    const jenisRuang = el('jenisRuang').value || 'Kelas';
    const kelasId = el('kelasId').value;
    tambahDosen(); // tangkap ketikan terakhir bila cocok
    const dosenIds = selectedDosen.slice();
    const dosenId = dosenIds[0] || '';
    if (el('dosenCari').value.trim() && !dosenIds.length) return setModalMsg('Dosen tidak dikenali — pilih dari daftar (ketik lalu pilih)', 'err');
    if (!prodiId || !semester || !nama || !kelasId || !dosenId) return setModalMsg('Prodi, Semester, Mata Kuliah, Kelas, minimal 1 Dosen wajib diisi', 'err');

    // Cegah duplikasi penawaran (MK sama untuk kelas sama).
    const dup = mkAktif().find(m => (m.nama || '').toLowerCase() === nama.toLowerCase() &&
      m.prodiId === prodiId && Number(m.semester) === Number(semester) && m.kelasId === kelasId && (!record || m.id !== record.id));
    if (dup) return setModalMsg('Penawaran untuk mata kuliah & kelas ini sudah ada', 'err');

    const body = { prodiId, kode, nama, sksTeori, sksPraktik, sks: sksTeori + sksPraktik, semester, jenisRuang, kelasId, dosenId, dosenIds };
    const url = record ? `/api/matakuliah/${record.id}` : '/api/matakuliah';
    const { ok, data } = await api(record ? 'PUT' : 'POST', url, body);
    if (!ok) return setModalMsg(data.error || 'Gagal menyimpan', 'err');
    await loadDB();
    hideModal();
    toast('Mata kuliah tersimpan');
    renderActive();
  });
}

// ---------- Pengelola Kategori Ruang ----------
function jenisRuangEditorHtml() {
  const fakLock = isFakultas();
  const scope = fakLock ? currentUser.fakultasId : jrEditFak; // '' = default global
  const list = jenisRuangFor(scope);
  const chips = list.map((d, i) => `
    <span class="hari-chip">
      ${esc(d)}
      ${d === 'Kelas' ? '' : `<button class="hari-del" data-jrdel="${i}" title="Hapus">✕</button>`}
    </span>`).join('');
  let selHtml = '';
  if (!fakLock && DB.fakultas.length) {
    const opts = DB.fakultas.map(f => `<option value="${f.id}" ${jrEditFak === f.id ? 'selected' : ''}>${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
    selHtml = `<label class="field" style="max-width:360px;margin-bottom:12px"><span>Kategori milik</span>
      <select id="jrFakSel"><option value="" ${jrEditFak === '' ? 'selected' : ''}>Default (semua fakultas)</option>${opts}</select></label>`;
  }
  const catatan = (fakLock || jrEditFak)
    ? 'Daftar khusus fakultas ini (menimpa default). Mengubahnya tidak memengaruhi fakultas lain.'
    : 'Daftar default dipakai fakultas yang belum menyetel kategorinya sendiri.';
  return `
    <div class="hari-editor">
      <div class="toolbar"><h2>Kategori Ruang <span class="count">${list.length}</span></h2></div>
      ${selHtml}
      <div class="hari-chips">${chips || '<span class="hint">Belum ada kategori.</span>'}</div>
      <div class="hari-add">
        <input type="text" id="jrInput" placeholder="mis. Lab Multimedia" maxlength="30" />
        <button class="btn primary" id="jrAdd">+ Tambah Kategori</button>
      </div>
      <small class="hint">${catatan}</small>
    </div>`;
}
async function saveJenisRuang(list) {
  const scope = isFakultas() ? currentUser.fakultasId : jrEditFak;
  const { ok, data } = await api('PUT', '/api/config/jenis-ruang', { list, fakultasId: scope || null });
  if (!ok) return toast(data.error || 'Gagal menyimpan kategori', 'err');
  await loadDB();
  toast('Kategori ruang diperbarui');
  renderMaster('ruangan');
}
function bindJenisRuangEditor(panel) {
  const scope = isFakultas() ? currentUser.fakultasId : jrEditFak;
  const curList = jenisRuangFor(scope);
  const sel = $('#jrFakSel', panel);
  if (sel) sel.addEventListener('change', () => { jrEditFak = sel.value; renderMaster('ruangan'); });
  const add = () => {
    const inp = $('#jrInput', panel);
    const v = inp.value.trim();
    if (!v) return;
    if (curList.some(x => x.toLowerCase() === v.toLowerCase())) return toast('Kategori sudah ada', 'warn');
    saveJenisRuang([...curList, v]);
  };
  $('#jrAdd', panel).addEventListener('click', add);
  $('#jrInput', panel).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $$('[data-jrdel]', panel).forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.jrdel);
    saveJenisRuang(curList.filter((_, idx) => idx !== i));
  }));
}

// ---------- Export / Import Mata Kuliah (Excel .xlsx) ----------
// Satu baris = MK lengkap + Kelas + Dosen (mendukung dosen berbeda tiap kelas).
const OFFER_HEADER = ['prodi_kode', 'kode_mk', 'nama_mk', 'sks_teori', 'sks_praktik', 'semester', 'jenis_ruang', 'kelas', 'dosen', 'nidn_nuptk'];

function tulisXLSX(namaFile, aoa, sheet) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet || 'Sheet1');
  XLSX.writeFile(wb, namaFile);
}

function bindOfferExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadOfferTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportOffer);
  const file = $('#matakuliahImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importOffer(file.files[0]); file.value = ''; });
}

// ---------- Export / Import Dosen ----------
const DOSEN_HEADER = ['prodi_kode', 'nidn', 'nuptk', 'nama'];

function bindDosenExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadDosenTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportDosen);
  const file = $('#dosenImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importDosen(file.files[0]); file.value = ''; });
}

function exportDosen() {
  const aoa = [DOSEN_HEADER];
  dosenAktif().forEach(d => {
    const prodi = DB.prodi.find(p => p.id === d.prodiId);
    aoa.push([prodi ? prodi.kode : '', d.nidn || '', d.nuptk || '', d.nama || '']);
  });
  tulisXLSX('dosen.xlsx', aoa, 'Dosen');
  toast('Data dosen diekspor');
}

function downloadDosenTemplate() {
  const prodi = isProdi() ? DB.prodi.find(p => p.id === currentUser.prodiId) : DB.prodi[0];
  const pk = prodi ? prodi.kode : 'PGSD';
  const aoa = [
    DOSEN_HEADER,
    [pk, '0912345678', '', 'Dr. Contoh Dosen, M.Pd.'],
    [pk, '', '1234567890123456', 'Dosen dengan NUPTK'],
    [pk, '', '', 'Nama Dosen Tanpa Identitas (Non Home Base / LB)']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Dosen');
  const ref = [['Kode Prodi', 'Nama Program Studi']].concat(DB.prodi.map(p => [p.kode, p.nama]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Referensi');
  XLSX.writeFile(wb, 'template-dosen.xlsx');
  toast('Template diunduh');
}

async function importDosen(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; DOSEN_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  if (idx.nama === -1) return toast('Header wajib: nama', 'err');

  let ok = 0, gagal = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const nama = get('nama');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama kosong`); continue; }
    // Akun prodi: prodinya sendiri; admin: dari prodi_kode.
    let prodiId;
    if (isProdi()) prodiId = currentUser.prodiId;
    else {
      const prodi = DB.prodi.find(p => (p.kode || '').toLowerCase() === get('prodi_kode').toLowerCase());
      if (!prodi) { gagal++; errs.push(`Baris ${i + 1}: prodi "${get('prodi_kode')}" tidak ditemukan`); continue; }
      prodiId = prodi.id;
    }
    const res = await api('POST', '/api/dosen', { prodiId, nidn: get('nidn'), nuptk: get('nuptk'), nama });
    if (res.ok) ok++; else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('dosen');
  toast(`Import selesai: ${ok} dosen${gagal ? ', ' + gagal + ' gagal' : ''}`, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import dosen:', errs);
}

// ---------- Export / Import Ruangan ----------
const RUANGAN_HEADER = ['fakultas_kode', 'kode', 'nama', 'jenis_ruang', 'kapasitas', 'gedung'];

function bindRuanganExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadRuanganTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportRuangan);
  const file = $('#ruanganImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importRuangan(file.files[0]); file.value = ''; });
}

function exportRuangan() {
  const aoa = [RUANGAN_HEADER];
  (DB.ruangan || []).forEach(r => {
    const fak = DB.fakultas.find(f => f.id === r.fakultasId);
    aoa.push([fak ? fak.kode : '', r.kode || '', r.nama || '', r.jenisRuang || 'Kelas', r.kapasitas != null ? r.kapasitas : '', r.gedung || '']);
  });
  tulisXLSX('ruangan.xlsx', aoa, 'Ruangan');
  toast('Data ruangan diekspor');
}

function downloadRuanganTemplate() {
  const fak = isFakultas() ? DB.fakultas.find(f => f.id === currentUser.fakultasId) : DB.fakultas[0];
  const fk = fak ? fak.kode : 'FKIP';
  const jr0 = (DB.jenisRuang || []).find(x => x !== 'Kelas') || 'Lab Komputer';
  const aoa = [
    RUANGAN_HEADER,
    [fk, 'R101', 'Ruang 101', 'Kelas', 40, 'Gedung A'],
    [fk, 'LAB01', 'Lab Komputer 1', jr0, 30, 'Gedung B']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Ruangan');
  const ref = [['Kode Fakultas', 'Nama Fakultas']].concat(DB.fakultas.map(f => [f.kode, f.nama]))
    .concat([[''], ['Kategori Jenis Ruang']]).concat((DB.jenisRuang || []).map(x => [x]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Referensi');
  XLSX.writeFile(wb, 'template-ruangan.xlsx');
  toast('Template diunduh');
}

async function importRuangan(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; RUANGAN_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  if (idx.nama === -1) return toast('Header wajib: nama', 'err');

  let ok = 0, gagal = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const nama = get('nama');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama kosong`); continue; }
    // Akun fakultas: fakultasnya sendiri; admin: dari fakultas_kode.
    let fakultasId;
    if (isFakultas()) fakultasId = currentUser.fakultasId;
    else {
      const fak = DB.fakultas.find(f => (f.kode || '').toLowerCase() === get('fakultas_kode').toLowerCase());
      if (!fak) { gagal++; errs.push(`Baris ${i + 1}: fakultas "${get('fakultas_kode')}" tidak ditemukan`); continue; }
      fakultasId = fak.id;
    }
    let jr = get('jenis_ruang');
    if (jr) { const f = jenisRuangFor(fakultasId).find(x => x.toLowerCase() === jr.toLowerCase()); if (f) jr = f; }
    const body = { fakultasId, kode: get('kode'), nama, jenisRuang: jr || 'Kelas', kapasitas: Number(get('kapasitas')) || 0, gedung: get('gedung') };
    const res = await api('POST', '/api/ruangan', body);
    if (res.ok) ok++; else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('ruangan');
  toast(`Import selesai: ${ok} ruangan${gagal ? ', ' + gagal + ' gagal' : ''}`, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import ruangan:', errs);
}

// ---------- Export / Import Kelas ----------
const KELAS_HEADER = ['prodi_kode', 'nama', 'semester', 'jumlah_mhs'];

function bindKelasExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadKelasTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportKelas);
  const file = $('#kelasImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importKelas(file.files[0]); file.value = ''; });
}

function exportKelas() {
  const aoa = [KELAS_HEADER];
  kelasAktif().forEach(k => {
    const prodi = DB.prodi.find(p => p.id === k.prodiId);
    aoa.push([prodi ? prodi.kode : '', k.nama || '', k.semester || '', k.jumlahMhs != null ? k.jumlahMhs : '']);
  });
  tulisXLSX('kelas.xlsx', aoa, 'Kelas');
  toast('Data kelas diekspor');
}

function downloadKelasTemplate() {
  const prodi = isProdi() ? DB.prodi.find(p => p.id === currentUser.prodiId) : DB.prodi[0];
  const pk = prodi ? prodi.kode : 'PGSD';
  const aoa = [
    KELAS_HEADER,
    [pk, pk + '-2A', 2, 40],
    [pk, pk + '-4A', 4, 35]
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Kelas');
  const ref = [['Kode Prodi', 'Nama Program Studi']].concat(DB.prodi.map(p => [p.kode, p.nama]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Referensi');
  XLSX.writeFile(wb, 'template-kelas.xlsx');
  toast('Template diunduh');
}

async function importKelas(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; KELAS_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  if (idx.nama === -1) return toast('Header wajib: nama', 'err');

  const adaKelas = kelasAktif().slice();
  let ok = 0, gagal = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const nama = get('nama');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama kosong`); continue; }
    // Akun prodi: prodinya sendiri; admin/fakultas: dari prodi_kode.
    let prodiId;
    if (isProdi()) prodiId = currentUser.prodiId;
    else {
      const prodi = DB.prodi.find(p => (p.kode || '').toLowerCase() === get('prodi_kode').toLowerCase());
      if (!prodi) { gagal++; errs.push(`Baris ${i + 1}: prodi "${get('prodi_kode')}" tidak ditemukan`); continue; }
      prodiId = prodi.id;
    }
    const semester = Number(get('semester')) || 1;
    if (adaKelas.some(k => k.prodiId === prodiId && (k.nama || '').toLowerCase() === nama.toLowerCase())) {
      gagal++; errs.push(`Baris ${i + 1}: kelas "${nama}" sudah ada`); continue;
    }
    const res = await api('POST', '/api/kelas', { prodiId, nama, semester, jumlahMhs: Number(get('jumlah_mhs')) || 40 });
    if (res.ok) { ok++; adaKelas.push(res.data); } else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('kelas');
  toast(`Import selesai: ${ok} kelas${gagal ? ', ' + gagal + ' gagal' : ''}`, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import kelas:', errs);
}

// ---------- Export / Import Fakultas ----------
const FAKULTAS_HEADER = ['kode', 'nama'];

function bindFakultasExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadFakultasTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportFakultas);
  const file = $('#fakultasImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importFakultas(file.files[0]); file.value = ''; });
}

function exportFakultas() {
  const aoa = [FAKULTAS_HEADER];
  (DB.fakultas || []).forEach(f => aoa.push([f.kode || '', f.nama || '']));
  tulisXLSX('fakultas.xlsx', aoa, 'Fakultas');
  toast('Data fakultas diekspor');
}

function downloadFakultasTemplate() {
  const aoa = [
    FAKULTAS_HEADER,
    ['FKIP', 'Keguruan dan Ilmu Pendidikan'],
    ['FT', 'Teknik']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Fakultas');
  XLSX.writeFile(wb, 'template-fakultas.xlsx');
  toast('Template diunduh');
}

async function importFakultas(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; FAKULTAS_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  if (idx.nama === -1) return toast('Header wajib: nama', 'err');

  const ada = (DB.fakultas || []).slice();
  let ok = 0, gagal = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const nama = get('nama'), kode = get('kode');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama kosong`); continue; }
    if (ada.some(f => (f.nama || '').toLowerCase() === nama.toLowerCase() || (kode && (f.kode || '').toLowerCase() === kode.toLowerCase()))) {
      gagal++; errs.push(`Baris ${i + 1}: fakultas "${kode || nama}" sudah ada`); continue;
    }
    const res = await api('POST', '/api/fakultas', { kode, nama });
    if (res.ok) { ok++; ada.push(res.data); } else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('fakultas');
  toast(`Import selesai: ${ok} fakultas${gagal ? ', ' + gagal + ' gagal' : ''}`, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import fakultas:', errs);
}

// ---------- Export / Import Program Studi ----------
const PRODI_HEADER = ['kode', 'nama', 'jenjang', 'fakultas_kode'];
const JENJANG_OPTS = ['D3', 'D4', 'S1', 'S2', 'S3', 'Sp-1', 'Sp-2', 'Profesi'];

function bindProdiExportImport(panel) {
  panel.querySelector('[data-template]').addEventListener('click', downloadProdiTemplate);
  panel.querySelector('[data-export]').addEventListener('click', exportProdi);
  const file = $('#prodiImportFile', panel);
  panel.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importProdi(file.files[0]); file.value = ''; });
}

function exportProdi() {
  const aoa = [PRODI_HEADER];
  (DB.prodi || []).forEach(p => {
    const fak = DB.fakultas.find(f => f.id === p.fakultasId);
    aoa.push([p.kode || '', p.nama || '', p.jenjang || '', fak ? fak.kode : '']);
  });
  tulisXLSX('program-studi.xlsx', aoa, 'Program Studi');
  toast('Data program studi diekspor');
}

function downloadProdiTemplate() {
  const fak = DB.fakultas[0];
  const fk = fak ? fak.kode : 'FKIP';
  const aoa = [
    PRODI_HEADER,
    ['86206', 'Pendidikan Guru Sekolah Dasar', 'S1', fk],
    ['88203', 'Pendidikan Bahasa Inggris', 'S1', fk]
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Program Studi');
  const ref = [['Kode Fakultas', 'Nama Fakultas']].concat(DB.fakultas.map(f => [f.kode, f.nama]))
    .concat([[''], ['Jenjang']]).concat(JENJANG_OPTS.map(x => [x]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Referensi');
  XLSX.writeFile(wb, 'template-program-studi.xlsx');
  toast('Template diunduh');
}

async function importProdi(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; PRODI_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  if (idx.nama === -1) return toast('Header wajib: nama', 'err');

  const ada = (DB.prodi || []).slice();
  let ok = 0, gagal = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const nama = get('nama'), kode = get('kode');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama kosong`); continue; }
    // Akun fakultas: fakultasnya sendiri; admin: dari fakultas_kode.
    let fakultasId;
    if (isFakultas()) fakultasId = currentUser.fakultasId;
    else {
      const fak = DB.fakultas.find(f => (f.kode || '').toLowerCase() === get('fakultas_kode').toLowerCase());
      if (!fak) { gagal++; errs.push(`Baris ${i + 1}: fakultas "${get('fakultas_kode')}" tidak ditemukan`); continue; }
      fakultasId = fak.id;
    }
    let jenjang = get('jenjang');
    if (jenjang) { const f = JENJANG_OPTS.find(x => x.toLowerCase() === jenjang.toLowerCase()); jenjang = f || jenjang; }
    if (ada.some(p => (kode && (p.kode || '').toLowerCase() === kode.toLowerCase()) || (p.fakultasId === fakultasId && (p.nama || '').toLowerCase() === nama.toLowerCase()))) {
      gagal++; errs.push(`Baris ${i + 1}: prodi "${kode || nama}" sudah ada`); continue;
    }
    const res = await api('POST', '/api/prodi', { kode, nama, jenjang, fakultasId });
    if (res.ok) { ok++; ada.push(res.data); } else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('prodi');
  toast(`Import selesai: ${ok} program studi${gagal ? ', ' + gagal + ' gagal' : ''}`, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import program studi:', errs);
}

function exportOffer() {
  const aoa = [OFFER_HEADER];
  mkAktif().forEach(m => {
    const prodi = DB.prodi.find(p => p.id === m.prodiId);
    const kelas = DB.kelas.find(k => k.id === m.kelasId);
    const dosenObjs = dosenIdsOf(m).map(id => DB.dosen.find(x => x.id === id)).filter(Boolean);
    const dosenNama = dosenObjs.map(d => d.nama).join('; ');
    const dosenIdentStr = dosenObjs.map(d => dosenIdent(d)).join('; ');
    aoa.push([
      prodi ? prodi.kode : '', m.kode || '', m.nama || '',
      m.sksTeori != null ? m.sksTeori : 0, m.sksPraktik != null ? m.sksPraktik : 0,
      m.semester || '', m.jenisRuang || 'Kelas', kelas ? kelas.nama : '', dosenNama, dosenIdentStr
    ]);
  });
  tulisXLSX('mata-kuliah.xlsx', aoa, 'Mata Kuliah');
  toast('Mata kuliah diekspor');
}

function downloadOfferTemplate() {
  const prodi = DB.prodi[0];
  const pk = prodi ? prodi.kode : 'PGSD';
  const kelas0 = prodi ? DB.kelas.find(k => k.prodiId === prodi.id) : DB.kelas[0];
  const dosen0 = dosenAktif()[0];
  const contohLab = (DB.jenisRuang || []).find(x => x !== 'Kelas') || 'Lab Komputer';
  const aoa = [
    OFFER_HEADER,
    [pk, pk + '101', 'Contoh MK Teori', 3, 0, 2, 'Kelas', kelas0 ? kelas0.nama : 'PGSD-2A', dosen0 ? dosen0.nama : 'Nama Dosen', dosen0 ? dosenIdent(dosen0) : '0912345678'],
    [pk, pk + '102', 'Contoh MK Praktik', 2, 1, 4, contohLab, kelas0 ? kelas0.nama : 'PGSD-4A', dosen0 ? dosen0.nama : 'Nama Dosen', dosen0 ? dosenIdent(dosen0) : '0912345678']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Mata Kuliah');
  const ref = [['Kode Prodi', 'Nama Program Studi']].concat(DB.prodi.map(p => [p.kode, p.nama]))
    .concat([[''], ['Kategori Jenis Ruang']]).concat((DB.jenisRuang || []).map(x => [x]))
    .concat([[''], ['Kelas']]).concat(DB.kelas.map(k => [k.nama]))
    .concat([[''], ['Dosen', 'NIDN', 'NUPTK']]).concat(dosenAktif().map(d => [d.nama, d.nidn || '', d.nuptk || '']));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Referensi');
  XLSX.writeFile(wb, 'template-mata-kuliah.xlsx');
  toast('Template diunduh');
}

async function importOffer(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) return toast('File kosong atau tanpa data', 'err');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = {}; OFFER_HEADER.forEach(h => { idx[h] = head.indexOf(h); });
  // Kompatibilitas file lama: 'kode' = kode_mk, 'nama' = nama_mk.
  if (idx.kode_mk === -1) idx.kode_mk = head.indexOf('kode');
  if (idx.nama_mk === -1) idx.nama_mk = head.indexOf('nama');
  if (idx.nidn_nuptk === -1) idx.nidn_nuptk = head.indexOf('nidn'); // kompatibilitas
  if (idx.nidn_nuptk === -1) idx.nidn_nuptk = head.indexOf('nip_nidn'); // kompatibilitas file lama
  if (idx.prodi_kode === -1 || idx.nama_mk === -1 || idx.kelas === -1 || idx.dosen === -1)
    return toast('Header wajib: prodi_kode, nama_mk (atau nama), kelas, dosen', 'err');

  // Cache lokal agar dosen/kelas baru bisa dipakai ulang antar baris.
  // Dosen dicocokkan lintas prodi: dosen homebase prodi lain tetap dikenali (tak diduplikasi).
  let dosenList = dosenPilihan().slice();
  let kelasList = kelasAktif().slice();
  let ok = 0, gagal = 0, dosenBaru = 0, kelasBaru = 0; const errs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const prodi = DB.prodi.find(p => (p.kode || '').toLowerCase() === get('prodi_kode').toLowerCase());
    if (!prodi) { gagal++; errs.push(`Baris ${i + 1}: prodi "${get('prodi_kode')}" tidak ditemukan`); continue; }
    const nama = get('nama_mk');
    if (!nama) { gagal++; errs.push(`Baris ${i + 1}: nama MK kosong`); continue; }
    const semester = Number(get('semester')) || 1;
    const kelasNama = get('kelas');
    const dosenNama = get('dosen');
    if (!kelasNama || !dosenNama) { gagal++; errs.push(`Baris ${i + 1}: kelas/dosen kosong`); continue; }

    // Kelas: pakai yang ada atau buat baru (default 40 mahasiswa, ≤ kapasitas ruang).
    let kelas = kelasList.find(k => k.prodiId === prodi.id && (k.nama || '').toLowerCase() === kelasNama.toLowerCase());
    if (!kelas) {
      const res = await api('POST', '/api/kelas', { prodiId: prodi.id, nama: kelasNama, semester, jumlahMhs: 40 });
      if (!res.ok) { gagal++; errs.push(`Baris ${i + 1}: gagal buat kelas "${kelasNama}"`); continue; }
      kelas = res.data; kelasList.push(kelas); kelasBaru++;
    }
    // Dosen: banyak dosen dipisah HANYA dengan ';' (koma bagian gelar). Satu kolom identitas dicocokkan ke NIDN atau NUPTK, lalu nama.
    const namaDosenList = dosenNama.split(';').map(s => s.trim()).filter(Boolean);
    const identRaw = idx.nidn_nuptk >= 0 ? get('nidn_nuptk') : '';
    const identList = identRaw ? identRaw.split(';').map(s => s.trim()) : [];
    const dosenIds = [];
    let dosenGagal = false;
    const matchIdent = (d, v) => v && (String(d.nidn || '').toLowerCase() === v.toLowerCase() || String(d.nuptk || '').toLowerCase() === v.toLowerCase());
    for (let di = 0; di < namaDosenList.length; di++) {
      const dn = namaDosenList[di];
      const ident = (identList[di] || '').trim();
      // 1) cocok NIDN atau NUPTK (lintas prodi) → 2) nama prodi ini → 3) nama prodi mana pun.
      const dnN = normNama(dn);
      let dosen = ident ? dosenList.find(d => matchIdent(d, ident)) : null;
      if (!dosen) dosen = dosenList.find(d => d.prodiId === prodi.id && normNama(d.nama) === dnN)
        || dosenList.find(d => normNama(d.nama) === dnN);
      if (!dosen) {
        const res = await api('POST', '/api/dosen', { nama: dn, nidn: ident, nuptk: '', prodiId: prodi.id });
        if (!res.ok) { gagal++; errs.push(`Baris ${i + 1}: gagal buat dosen "${dn}"`); dosenGagal = true; break; }
        dosen = res.data; dosenList.push(dosen); dosenBaru++;
      }
      if (!dosenIds.includes(dosen.id)) dosenIds.push(dosen.id);
    }
    if (dosenGagal) continue;

    let jr = get('jenis_ruang');
    if (jr) { const f = jenisRuangFor(prodi.fakultasId).find(x => x.toLowerCase() === jr.toLowerCase()); if (f) jr = f; }
    const teori = Number(get('sks_teori')) || 0;
    const praktik = Number(get('sks_praktik')) || 0;
    if (mkAktif().some(m => (m.nama || '').toLowerCase() === nama.toLowerCase() && m.prodiId === prodi.id && Number(m.semester) === semester && m.kelasId === kelas.id)) {
      gagal++; errs.push(`Baris ${i + 1}: penawaran sudah ada`); continue;
    }
    const body = {
      prodiId: prodi.id, kode: get('kode_mk'), nama, sksTeori: teori, sksPraktik: praktik,
      sks: teori + praktik, semester, jenisRuang: jr || 'Kelas', kelasId: kelas.id,
      dosenId: dosenIds[0], dosenIds
    };
    const res = await api('POST', '/api/matakuliah', body);
    if (res.ok) ok++; else { gagal++; errs.push(`Baris ${i + 1}: ${res.data.error || 'gagal'}`); }
  }
  await loadDB();
  renderMaster('matakuliah');
  let msg = `Import selesai: ${ok} MK`;
  if (dosenBaru) msg += `, ${dosenBaru} dosen baru`;
  if (kelasBaru) msg += `, ${kelasBaru} kelas baru`;
  if (gagal) msg += `, ${gagal} gagal`;
  toast(msg, gagal ? 'warn' : 'ok');
  if (errs.length) console.warn('Import mata kuliah:', errs);
}

// ---------- Pengelola Hari Kuliah ----------
function hariEditorHtml() {
  const chips = DB.hari.map((d, i) => `
    <span class="hari-chip">
      <button class="hari-move" data-move="${i}" data-dir="-1" title="Naik" ${i === 0 ? 'disabled' : ''}>◀</button>
      ${esc(d)}
      <button class="hari-move" data-move="${i}" data-dir="1" title="Turun" ${i === DB.hari.length - 1 ? 'disabled' : ''}>▶</button>
      <button class="hari-del" data-hdel="${i}" title="Hapus">✕</button>
    </span>`).join('');
  return `
    <div class="hari-editor">
      <div class="toolbar"><h2>Hari Kuliah <span class="count">${DB.hari.length}</span></h2></div>
      <div class="hari-chips">${chips || '<span class="hint">Belum ada hari.</span>'}</div>
      <div class="hari-add">
        <input type="text" id="hariInput" placeholder="mis. Sabtu" maxlength="20" />
        <button class="btn primary" id="hariAdd">+ Tambah Hari</button>
      </div>
    </div>`;
}

async function saveHari(list) {
  const { ok, data } = await api('PUT', '/api/config/hari', { hari: list });
  if (!ok) return toast(data.error || 'Gagal menyimpan hari', 'err');
  await loadDB();
  toast('Hari kuliah diperbarui');
  renderMaster('slot');
}

function bindHariEditor(panel) {
  const add = () => {
    const inp = $('#hariInput', panel);
    const v = inp.value.trim();
    if (!v) return;
    if (DB.hari.some(h => h.toLowerCase() === v.toLowerCase())) return toast('Hari sudah ada', 'warn');
    saveHari([...DB.hari, v]);
  };
  $('#hariAdd', panel).addEventListener('click', add);
  $('#hariInput', panel).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $$('[data-hdel]', panel).forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.hdel);
    saveHari(DB.hari.filter((_, idx) => idx !== i));
  }));
  $$('[data-move]', panel).forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.move), dir = Number(b.dataset.dir), j = i + dir;
    if (j < 0 || j >= DB.hari.length) return;
    const list = DB.hari.slice();
    [list[i], list[j]] = [list[j], list[i]];
    saveHari(list);
  }));
}

async function delRecord(col, id) {
  if (!confirm('Hapus data ini? Data terkait (mis. jadwal) juga akan terhapus.')) return;
  const { ok, data } = await api('DELETE', `/api/${col}/${id}`);
  if (!ok) return toast(data.error || 'Gagal menghapus', 'err');
  await loadDB();
  toast('Data dihapus');
  renderActive();
}

async function delRecordBulk(col, ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return;
  const label = (SCHEMAS[col] || {}).label || 'data';
  if (!confirm(`Hapus ${ids.length} ${label} terpilih? Data terkait (mis. jadwal) juga akan terhapus.`)) return;
  let ok = 0, gagal = 0;
  for (const id of ids) {
    const res = await api('DELETE', `/api/${col}/${id}`);
    if (res.ok) ok++; else gagal++;
  }
  await loadDB();
  toast(gagal ? `${ok} dihapus, ${gagal} gagal` : `${ok} data dihapus`, gagal ? 'err' : 'ok');
  renderActive();
}

// ---------- Form builder generik ----------
function fieldHtml(f, record) {
  const val = record ? record[f.key] : '';
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'daycheck') {
    const cur = record ? slotHariArr(record) : [];
    const boxes = DB.hari.map(d =>
      `<label class="daybox"><input type="checkbox" name="${f.key}" value="${esc(d)}" ${cur.includes(d) ? 'checked' : ''}/> ${esc(d)}</label>`).join('');
    return `<div class="field"><span>${esc(f.label)}</span><div class="dayboxes">${boxes || '<span class="hint">Belum ada hari.</span>'}</div><small class="hint">Kosongkan = berlaku semua hari</small></div>`;
  }
  if (f.type === 'select') {
    let opts = '';
    let list;
    if (f.hariOpts) list = DB.hari.map(d => ({ v: d, t: d }));
    else if (f.semesterOpts) list = semesterSesuaiPeriode().map(s => ({ v: s.nomor, t: s.nama || ('Semester ' + s.nomor) }));
    else if (f.jenisRuangOpts) list = (DB.jenisRuang || []).map(x => ({ v: x, t: x }));
    else if (f.ref) { const src = f.ref === 'dosen' ? dosenAktif() : (DB[f.ref] || []); list = src.map(r => ({ v: r.id, t: r.kode ? `${r.kode} — ${r.nama}` : r.nama })); }
    else list = f.options;
    // Jenis ruang tak memakai placeholder kosong (default = opsi pertama, mis. Kelas).
    if (!f.jenisRuangOpts) opts = `<option value="">${esc(f.emptyLabel || '— pilih —')}</option>`;
    opts += list.map(o => `<option value="${esc(o.v)}" ${String(val) === String(o.v) ? 'selected' : ''}>${esc(o.t)}</option>`).join('');
    input = `<select name="${f.key}" ${req}>${opts}</select>`;
  } else {
    const type = f.type === 'number' ? 'number' : f.type === 'time' ? 'time' : 'text';
    input = `<input type="${type}" name="${f.key}" value="${esc(val)}" ${req} ${type === 'number' ? 'min="0"' : ''} />`;
  }
  return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}</label>`;
}

function openRecordForm(col, record) {
  const s = SCHEMAS[col];
  const form = $('#modalForm');
  form.innerHTML = s.fields.map(f => fieldHtml(f, record)).join('');
  // Akun prodi: kunci field Program Studi ke prodinya.
  if (isProdi() && form.elements['prodiId']) {
    form.elements['prodiId'].value = currentUser.prodiId;
    form.elements['prodiId'].disabled = true;
  }
  // Akun fakultas: kunci field Fakultas (mis. pemilik ruangan) ke fakultasnya.
  if (isFakultas() && form.elements['fakultasId']) {
    form.elements['fakultasId'].value = currentUser.fakultasId;
    form.elements['fakultasId'].disabled = true;
  }
  // Ruangan: kategori (jenis ruang) mengikuti fakultas pemilik.
  if (col === 'ruangan' && form.elements['jenisRuang']) {
    const jrSel = form.elements['jenisRuang'];
    const fakSel = form.elements['fakultasId'];
    const isiJr = () => {
      const fId = fakSel ? fakSel.value : '';
      const cur = jrSel.value || (record ? record.jenisRuang : '');
      const list = jenisRuangFor(fId).slice();
      if (cur && !list.includes(cur)) list.unshift(cur);
      jrSel.innerHTML = list.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    isiJr();
    if (fakSel && !fakSel.disabled) fakSel.addEventListener('change', isiJr);
  }
  $('#modalTitle').textContent = (record ? 'Ubah ' : 'Tambah ') + s.label;
  showModal(async (e) => {
    e.preventDefault();
    const body = collectForm(form, s.fields);
    // Total SKS = teori + praktik.
    if (col === 'matakuliah') body.sks = (Number(body.sksTeori) || 0) + (Number(body.sksPraktik) || 0);
    const url = record ? `/api/${col}/${record.id}` : `/api/${col}`;
    const method = record ? 'PUT' : 'POST';
    const { ok, data } = await api(method, url, body);
    if (!ok) return setModalMsg(data.error || 'Gagal menyimpan', 'err');
    await loadDB();
    hideModal();
    toast('Tersimpan');
    renderActive();
  });
}

function collectForm(form, fields) {
  const body = {};
  fields.forEach(f => {
    if (f.type === 'daycheck') {
      body[f.key] = $$(`input[name="${f.key}"]:checked`, form).map(el => el.value);
      return;
    }
    let v = form.elements[f.key] ? form.elements[f.key].value : '';
    if ((f.type === 'number' || f.semesterOpts) && v !== '') v = Number(v);
    body[f.key] = v;
  });
  return body;
}

// =====================================================================
// FILTER JADWAL
// =====================================================================
// ---------- Filter periode (lihat T.A. lain) ----------
function periodeKey(o) { return `${o.tahunAkademik || ''}||${o.semesterAktif || ''}`; }
function periodeText(ta, sem) { return `${ta || '-'} · ${sem || '-'}`; }
function renderPeriodeFilter() {
  const sel = $('#fltPeriode');
  const prev = sel.value;
  const active = periodeKey(DB.pengaturan || {});
  // Kumpulkan semua periode yang ada pada jadwal + periode aktif.
  const map = new Map();
  map.set(active, { ta: DB.pengaturan.tahunAkademik, sem: DB.pengaturan.semesterAktif });
  DB.jadwal.forEach(j => {
    const k = periodeKey(j);
    if (!map.has(k)) map.set(k, { ta: j.tahunAkademik, sem: j.semesterAktif });
  });
  const items = Array.from(map, ([k, v]) => ({ k, v }))
    .sort((a, b) => (b.v.ta || '').localeCompare(a.v.ta || '') || (a.v.sem || '').localeCompare(b.v.sem || ''));
  sel.innerHTML = items.map(it =>
    `<option value="${esc(it.k)}">${esc(periodeText(it.v.ta, it.v.sem))}${it.k === active ? ' (aktif)' : ''}</option>`).join('');
  sel.value = (prev && map.has(prev)) ? prev : active;
}

function renderFilters() {
  // Akun prodi: fakultas & prodi dikunci ke miliknya (tidak bisa memilih yang lain).
  const meProdi = isProdi() ? DB.prodi.find(x => x.id === currentUser.prodiId) : null;
  const fak = $('#fltFakultas');
  if (fak) {
    const curF = meProdi ? (meProdi.fakultasId || '') : fak.value;
    fak.innerHTML = '<option value="">Semua Fakultas</option>' +
      DB.fakultas.map(f => `<option value="${f.id}">${esc(f.kode ? f.kode + ' — ' + f.nama : f.nama)}</option>`).join('');
    fak.value = curF;
    fak.disabled = !!meProdi;
  }
  const sel = $('#fltProdi');
  const cur = meProdi ? meProdi.id : sel.value;
  const fakId = fak ? fak.value : '';
  const prodiList = DB.prodi.filter(p => !fakId || p.fakultasId === fakId);
  sel.innerHTML = '<option value="">Semua Program Studi</option>' +
    prodiList.map(p => `<option value="${p.id}">${esc(p.kode ? p.kode + ' ' + p.nama : p.nama)}</option>`).join('');
  sel.value = prodiList.some(p => p.id === cur) ? cur : '';
  sel.disabled = !!meProdi;
  renderDosenFilter();
  renderSemesterFilter();
  renderKelasFilter();
}
function renderDosenFilter() {
  const sel = $('#fltDosen');
  const cur = sel.value;
  const prodiId = isProdi() ? currentUser.prodiId : $('#fltProdi').value;
  const fakId = $('#fltFakultas') ? $('#fltFakultas').value : '';
  const [vTa, vSem] = ($('#fltPeriode').value || periodeKey(DB.pengaturan || {})).split('||');
  // Hanya dosen yang benar-benar mengajar pada jadwal (sesuai prodi/fakultas & periode terpilih).
  const ids = new Set();
  DB.jadwal.forEach(j => {
    if ((j.tahunAkademik || '') !== (vTa || '') || (j.semesterAktif || '') !== (vSem || '')) return;
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    if (prodiId && (!mk || mk.prodiId !== prodiId)) return;
    if (fakId) {
      const p = DB.prodi.find(x => x.id === (mk ? mk.prodiId : (j.prodiId || '')));
      if (!p || p.fakultasId !== fakId) return;
    }
    dosenIdsOf(j).forEach(id => id && ids.add(id));
  });
  const lookup = new Map();
  dosenAktif().forEach(d => lookup.set(d.id, d.nama));
  (DB.dosenSemua || []).forEach(d => { if (!lookup.has(d.id)) lookup.set(d.id, d.nama); });
  const list = Array.from(ids).map(id => ({ id, nama: lookup.get(id) || id }))
    .sort((a, b) => a.nama.localeCompare(b.nama));
  sel.innerHTML = '<option value="">Semua Dosen</option>' +
    list.map(d => `<option value="${d.id}">${esc(d.nama)}</option>`).join('');
  sel.value = list.some(d => d.id === cur) ? cur : '';
}
function renderSemesterFilter() {
  const prodiId = $('#fltProdi').value;
  const sems = new Set();
  mkAktif().forEach(m => { if (!prodiId || m.prodiId === prodiId) sems.add(Number(m.semester)); });
  const sel = $('#fltSemester');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua Semester</option>' +
    Array.from(sems).filter(Boolean).sort((a, b) => a - b).map(s => `<option value="${s}">Semester ${s}</option>`).join('');
  sel.value = cur;
}
// Kelas hanya bisa difilter setelah memilih Program Studi.
function renderKelasFilter() {
  const prodiId = isProdi() ? currentUser.prodiId : $('#fltProdi').value;
  const sel = $('#fltKelas');
  if (!sel) return;
  const cur = sel.value;
  if (!prodiId) {
    sel.innerHTML = '<option value="">Pilih prodi dahulu</option>';
    sel.value = '';
    sel.disabled = true;
    return;
  }
  const list = kelasAktif().filter(k => k.prodiId === prodiId)
    .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
  sel.disabled = false;
  sel.innerHTML = '<option value="">Semua Kelas</option>' +
    list.map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('');
  sel.value = list.some(k => k.id === cur) ? cur : '';
}

function filteredJadwal() {
  const prodiId = $('#fltProdi').value;
  const dosenId = $('#fltDosen').value;
  const fakId = $('#fltFakultas') ? $('#fltFakultas').value : '';
  const sem = $('#fltSemester').value;
  const kelasId = $('#fltKelas') ? $('#fltKelas').value : '';
  const ruang = $('#fltRuang') ? $('#fltRuang').value : '';
  const [vTa, vSem] = ($('#fltPeriode').value || periodeKey(DB.pengaturan || {})).split('||');
  return DB.jadwal.filter(j => {
    // Hanya jadwal pada periode yang dipilih untuk dilihat.
    if ((j.tahunAkademik || '') !== (vTa || '') || (j.semesterAktif || '') !== (vSem || '')) return false;
    if (dosenId && !dosenIdsOf(j).includes(dosenId)) return false;
    if (kelasId && j.kelasId !== kelasId) return false;
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    if (prodiId && (!mk || mk.prodiId !== prodiId)) return false;
    if (fakId) {
      const p = DB.prodi.find(x => x.id === (mk ? mk.prodiId : (j.prodiId || '')));
      if (!p || p.fakultasId !== fakId) return false;
    }
    if (sem && (!mk || Number(mk.semester) !== Number(sem))) return false;
    if (ruang && ruangKategori(j) !== ruang) return false;
    return true;
  });
}

// Kategori ruangan sebuah jadwal: Kelas | Lab | Daring.
function ruangKategori(j) {
  if (j.daring || isDaringRoomId(j.ruanganId)) return 'Daring';
  const r = DB.ruangan.find(x => x.id === j.ruanganId);
  let jr = (r && r.jenisRuang) || '';
  if (!jr) { const mk = DB.matakuliah.find(m => m.id === j.matakuliahId); jr = mk ? (mk.jenisRuang || 'Kelas') : 'Kelas'; }
  if (/^Lab/i.test(jr)) return 'Lab';
  if (/Daring/i.test(jr)) return 'Daring';
  return 'Kelas';
}

// =====================================================================
// RENDER JADWAL
// =====================================================================
// Prodi = hanya-baca; admin & fakultas boleh ubah/hapus jadwal.
function canEditJadwal() { return !isProdi(); }

// Unduh jadwal (sesuai filter aktif) ke Excel.
function exportJadwal() {
  const rows = filteredJadwal();
  if (!rows.length) return toast('Tidak ada jadwal untuk diekspor', 'warn');
  const hi = h => DB.hari.indexOf(h);
  const sorted = rows.slice().sort((a, b) => (hi(a.hari) - hi(b.hari)) || String(a.jamMulai || '').localeCompare(String(b.jamMulai || '')));
  const aoa = [['Hari', 'Jam Mulai', 'Jam Selesai', 'Program Studi', 'Semester', 'Kode MK', 'Mata Kuliah', 'Kelas', 'Dosen', 'Ruangan', 'SKS']];
  sorted.forEach(j => {
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    const prodi = DB.prodi.find(p => p.id === (j.prodiId || (mk ? mk.prodiId : '')));
    const kelas = DB.kelas.find(k => k.id === j.kelasId);
    const ruang = DB.ruangan.find(r => r.id === j.ruanganId);
    const dnama = dosenIdsOf(j).length ? dosenNamaOf(j) : dosenNamaOf(mk);
    const sks = mk ? (Number(mk.sks) || ((Number(mk.sksTeori) || 0) + (Number(mk.sksPraktik) || 0))) : '';
    const ruName = (j.daring || isDaringRoomId(j.ruanganId)) ? 'Daring'
      : (!j.hari || !j.jamMulai) ? 'Fleksibel'
        : (ruang ? (ruang.nama || ruang.kode) : '-');
    aoa.push([
      j.hari || '', j.jamMulai || '', j.jamSelesai || '',
      prodi ? (prodi.kode ? prodi.kode + ' ' + prodi.nama : prodi.nama) : '',
      mk ? mk.semester : '', mk ? (mk.kode || '') : '', mk ? mk.nama : '',
      kelas ? kelas.nama : '', dnama, ruName, sks
    ]);
  });
  const { ta, sem } = getViewPeriode();
  tulisXLSX(`jadwal-${String(ta || '').replace('/', '-')}-${sem || ''}.xlsx`, aoa, 'Jadwal');
  toast('Jadwal diekspor');
}

function renderJadwal() {
  const mode = $('#viewMode').value;
  const view = $('#jadwalView');
  const rows = filteredJadwal();
  if (DB.jadwal.length === 0) {
    view.innerHTML = isProdi()
      ? `<div class="empty">Belum ada jadwal yang disusun untuk periode ini.</div>`
      : `<div class="empty">Belum ada jadwal. Klik <b>Tambah Jadwal</b> atau <b>Auto-generate</b>.</div>`;
    return;
  }
  // Peringatan bila sedang melihat periode selain periode aktif.
  const viewing = $('#fltPeriode').value;
  const active = periodeKey(DB.pengaturan || {});
  let banner = '';
  if (viewing && viewing !== active) {
    const [ta, sem] = viewing.split('||');
    banner = `<div class="periode-banner">👁️ Melihat periode <b>${esc(periodeText(ta, sem))}</b> (arsip). Jadwal baru akan masuk ke periode aktif <b>${esc(periodeText(DB.pengaturan.tahunAkademik, DB.pengaturan.semesterAktif))}</b>.</div>`;
  }
  // Pisahkan jadwal fleksibel (Ujian/Praktik Lapangan, tanpa hari/jam).
  const flex = rows.filter(j => !j.hari || !j.jamMulai);
  const sched = rows.filter(j => j.hari && j.jamMulai);
  let flexHtml = '';
  if (flex.length) {
    flexHtml = `<div class="flex-jadwal"><h4>🕓 Jadwal Fleksibel (Ujian / Praktik Lapangan) — ${flex.length}</h4><div class="flex-cards">${flex.map(jadwalCard).join('')}</div></div>`;
  }
  view.innerHTML = banner + (mode === 'grid' ? gridHtml(sched) : tableHtml(sched)) + flexHtml;
  bindJadwalActions(view);
}

function jadwalCard(j) {
  const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
  const prodi = DB.prodi.find(p => p.id === (j.prodiId || (mk ? mk.prodiId : '')));
  const ruang = DB.ruangan.find(r => r.id === j.ruanganId);
  const kelas = DB.kelas.find(k => k.id === j.kelasId);
  const dnama = dosenIdsOf(j).length ? dosenNamaOf(j) : dosenNamaOf(mk);
  const tipe = mk ? (mk.jenisRuang || 'Kelas') : 'Kelas';
  const nama = mk ? mk.nama : '-';
  const daring = !!j.daring || !!(ruang && ruang.daring);
  return `<div class="jcard ${tipe === 'Lab' ? 'is-lab' : ''} ${daring ? 'is-daring' : ''}" data-id="${j.id}">
    <div class="jcard-top">
      <b title="${esc(nama)}">${esc(nama)}</b>
      ${canEditJadwal() ? `<span class="jcard-btns">
        <button class="icon-btn" data-jedit="${j.id}" title="Ubah">✏️</button>
        <button class="icon-btn danger" data-jdel="${j.id}" title="Hapus">🗑️</button>
      </span>` : ''}
    </div>
    <div class="jmeta" title="${esc(prodi ? prodi.nama : '')}">${esc(prodi ? prodi.kode : '-')} · ${esc(kelas ? kelas.nama : '-')} · Smt ${esc(mk ? mk.semester : '-')}</div>
    <div class="jmeta" title="${esc(dnama)}">👨‍🏫 ${esc(dnama)}</div>
    <div class="jmeta">${(!j.hari || !j.jamMulai) ? '<span class="jbadge">' + esc(tipe) + '</span> <b>Fleksibel</b>'
      : (daring ? '<span class="jbadge daring">🌐 Daring</span> ' + esc(j.jamMulai) + '–' + esc(j.jamSelesai)
        : '<span class="jbadge ' + (tipe === 'Lab' ? 'lab' : '') + '">' + esc(tipe) + '</span> ' + esc(ruang ? (ruang.kode || ruang.nama) : '-') + ' · ' + esc(j.jamMulai) + '–' + esc(j.jamSelesai))}</div>
  </div>`;
}

function tableHtml(rows) {
  if (rows.length === 0) return `<div class="empty">Tidak ada jadwal untuk filter ini.</div>`;
  const sorted = rows.slice().sort((a, b) =>
    DB.hari.indexOf(a.hari) - DB.hari.indexOf(b.hari) || a.jamMulai.localeCompare(b.jamMulai));
  let h = '<div class="table-wrap"><table><thead><tr>' +
    '<th>Hari</th><th>Jam</th><th>Program Studi</th><th>Mata Kuliah</th><th>Kelas</th><th>Dosen</th><th>Ruangan</th>' +
    (canEditJadwal() ? '<th class="col-act">Aksi</th>' : '') +
    '</tr></thead><tbody>';
  sorted.forEach(j => {
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    h += `<tr>
      <td>${esc(j.hari)}</td>
      <td>${esc(j.jamMulai)}–${esc(j.jamSelesai)}</td>
      <td>${esc(prodiLabel(j.prodiId || (mk ? mk.prodiId : '')))}</td>
      <td>${esc(mk ? mk.nama : '-')}</td>
      <td>${esc(nameOf('kelas', j.kelasId))}</td>
      <td>${esc(dosenIdsOf(j).length ? dosenNamaOf(j) : dosenNamaOf(mk))}</td>
      <td>${(j.daring || isDaringRoomId(j.ruanganId)) ? '🌐 Daring' : esc(nameOf('ruangan', j.ruanganId))}</td>
      ${canEditJadwal() ? `<td class="col-act">
        <button class="icon-btn" data-jedit="${j.id}">✏️</button>
        <button class="icon-btn danger" data-jdel="${j.id}">🗑️</button>
      </td>` : ''}</tr>`;
  });
  h += '</tbody></table></div>';
  return h;
}

function gridHtml(rows) {
  const hari = DB.hari;
  // Baris = gabungan jam mulai dari jadwal (durasi bervariasi berdasarkan SKS),
  // ditambah awal rentang agar tetap tampil walau kosong.
  const startsSet = new Set(rows.map(j => j.jamMulai));
  (DB.slot || []).forEach(s => { if (s.jamMulai) startsSet.add(s.jamMulai); });
  const starts = Array.from(startsSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
  let h = '<div class="table-wrap"><table class="grid"><thead><tr><th class="col-time">Jam</th>';
  hari.forEach(d => h += `<th>${esc(d)}</th>`);
  h += '</tr></thead><tbody>';
  starts.forEach(st => {
    h += `<tr><td class="col-time">${esc(st)}</td>`;
    hari.forEach(d => {
      const cell = rows.filter(j => j.hari === d && j.jamMulai === st);
      h += '<td class="gcell">' + cell.map(jadwalCard).join('') + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function bindJadwalActions(root) {
  $$('[data-jedit]', root).forEach(b => b.addEventListener('click', () =>
    openJadwalForm(DB.jadwal.find(x => x.id === b.dataset.jedit))));
  $$('[data-jdel]', root).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus jadwal ini?')) return;
    const { ok, data } = await api('DELETE', `/api/jadwal/${b.dataset.jdel}`);
    if (!ok) return toast(data.error || 'Gagal', 'err');
    await loadDB(); toast('Jadwal dihapus'); renderJadwal();
  }));
}

// =====================================================================
// FORM JADWAL (khusus, dengan select dependen & cek bentrok)
// =====================================================================
function openJadwalForm(record) {
  const form = $('#modalForm');
  const r = record || {};
  const prodiOpts = DB.prodi.map(p => `<option value="${p.id}">${esc(p.kode ? p.kode + ' ' + p.nama : p.nama)}</option>`).join('');
  const hariOpts = DB.hari.map(d => `<option value="${d}">${esc(d)}</option>`).join('');

  const curOff = r.matakuliahId ? DB.matakuliah.find(m => m.id === r.matakuliahId) : null;
  const curProdi = r.prodiId || (curOff ? curOff.prodiId : '');
  form.innerHTML = `
    <label class="field"><span>Program Studi *</span>
      <select name="prodiId" required><option value="">— pilih —</option>${prodiOpts}</select></label>
    <label class="field"><span>Mata Kuliah (Penawaran) *</span>
      <input name="mkCari" list="mkList" autocomplete="off" placeholder="ketik kode / nama mata kuliah" />
      <datalist id="mkList"></datalist>
      <input type="hidden" name="matakuliahId" /></label>
    <p class="hint" id="offInfo"></p>
    <label class="field"><span>Ruangan *</span>
      <input name="ruangCari" list="ruangList" autocomplete="off" placeholder="ketik kode / nama ruangan" />
      <datalist id="ruangList"></datalist>
      <input type="hidden" name="ruanganId" /></label>
    <label class="field"><span>Hari *</span>
      <select name="hari" required><option value="">— pilih —</option>${hariOpts}</select></label>
    <label class="field"><span>Kelompok Jam</span>
      <select name="slotPick"><option value="">— pilih hari dahulu —</option></select></label>
    <div class="field-row">
      <label class="field"><span>Jam Mulai *</span><input type="time" name="jamMulai" required /></label>
      <label class="field"><span>Jam Selesai *</span><input type="time" name="jamSelesai" required /></label>
    </div>
    <div id="conflictBox"></div>`;

  const elProdi = form.elements['prodiId'];
  const elMk = form.elements['matakuliahId'];
  let kelasId = r.kelasId || '';
  let dosenId = r.dosenId || '';
  let dosenIds = dosenIdsOf(r);

  function offLabel(m) {
    const kelas = DB.kelas.find(k => k.id === m.kelasId);
    return `${(m.kode ? m.kode + ' ' : '')}${m.nama} — ${kelas ? kelas.nama : '?'} (${dosenNamaOf(m)})`;
  }
  // Datalist mata kuliah & ruangan agar bisa diketik untuk mencari; peta label -> id.
  const mkMap = new Map(), mkLabelById = new Map();
  const ruangMap = new Map(), ruangLabelById = new Map();
  function fillMk() {
    const pid = elProdi.value;
    mkMap.clear(); mkLabelById.clear();
    const list = mkAktif().filter(m => m.prodiId === pid);
    $('#mkList', form).innerHTML = list.map(m => {
      let label = offLabel(m), base = label, n = 2;
      while (mkMap.has(label)) { label = base + ' #' + n; n++; }
      mkMap.set(label, m.id); mkLabelById.set(m.id, label);
      return `<option value="${esc(label)}">`;
    }).join('');
  }
  function fillRuangList() {
    ruangMap.clear(); ruangLabelById.clear();
    $('#ruangList', form).innerHTML = DB.ruangan.map(rr => {
      let label = (rr.kode ? rr.kode + ' — ' : '') + rr.nama + (rr.kapasitas ? ' (kap. ' + rr.kapasitas + ')' : '');
      let base = label, n = 2;
      while (ruangMap.has(label)) { label = base + ' #' + n; n++; }
      ruangMap.set(label, rr.id); ruangLabelById.set(rr.id, label);
      return `<option value="${esc(label)}">`;
    }).join('');
  }
  function resolveMk() { elMk.value = mkMap.get(form.elements['mkCari'].value.trim()) || ''; }
  function resolveRuang() { form.elements['ruanganId'].value = ruangMap.get(form.elements['ruangCari'].value.trim()) || ''; }
  function updateOffInfo() {
    const m = DB.matakuliah.find(x => x.id === elMk.value);
    kelasId = m ? m.kelasId : '';
    dosenId = m ? m.dosenId : '';
    dosenIds = m ? dosenIdsOf(m) : [];
    const kelas = DB.kelas.find(k => k.id === kelasId);
    $('#offInfo', form).textContent = m
      ? `Kelas: ${kelas ? kelas.nama : '-'} · Dosen: ${dosenNamaOf(m)} · ${m.sks || ((Number(m.sksTeori) || 0) + (Number(m.sksPraktik) || 0))} SKS · ${m.jenisRuang || 'Kelas'}`
      : '';
  }
  fillRuangList();
  elProdi.value = curProdi || '';
  fillMk();
  if (r.matakuliahId && mkLabelById.has(r.matakuliahId)) { elMk.value = r.matakuliahId; form.elements['mkCari'].value = mkLabelById.get(r.matakuliahId); }
  updateOffInfo();
  elProdi.addEventListener('change', () => { form.elements['mkCari'].value = ''; elMk.value = ''; fillMk(); updateOffInfo(); });
  const onMk = () => { resolveMk(); updateOffInfo(); autoSelesai(); checkConflictLive(); };
  form.elements['mkCari'].addEventListener('input', onMk);
  form.elements['mkCari'].addEventListener('change', onMk);
  const onRuang = () => { resolveRuang(); checkConflictLive(); };
  form.elements['ruangCari'].addEventListener('input', onRuang);
  form.elements['ruangCari'].addEventListener('change', onRuang);

  // Jam selesai dihitung dari SKS penawaran (durasi per SKS sesuai pengaturan).
  function autoSelesai() {
    const m = DB.matakuliah.find(x => x.id === elMk.value);
    const sks = m ? (Number(m.sks) || ((Number(m.sksTeori) || 0) + (Number(m.sksPraktik) || 0))) : 0;
    const start = form.elements['jamMulai'].value;
    if (!start || !sks) return;
    const perSks = Number((DB.pengaturan || {}).menitPerSks) || 45;
    const [hh, mm] = start.split(':').map(Number);
    const tot = hh * 60 + mm + sks * perSks;
    form.elements['jamSelesai'].value = String(Math.floor(tot / 60)).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
  }
  // Pemilih kelompok jam (Pagi/Siang) hanya mengisi jam MULAI; selesai dihitung dari SKS.
  const elSlot = form.elements['slotPick'];
  function fillSlotPick() {
    const hari = form.elements['hari'].value;
    const list = hari ? slotsForHari(hari) : [];
    elSlot.innerHTML = `<option value="">${hari ? '— pilih kelompok jam —' : '— pilih hari dahulu —'}</option>` +
      list.map(s => `<option value="${s.jamMulai}">${esc((s.kelompok ? s.kelompok + ' ' : '') + s.jamMulai + '–' + s.jamSelesai)}</option>`).join('');
  }
  elSlot.addEventListener('change', (e) => {
    if (e.target.value) { form.elements['jamMulai'].value = e.target.value; autoSelesai(); checkConflictLive(); }
  });
  form.elements['hari'].addEventListener('change', fillSlotPick);
  form.elements['jamMulai'].addEventListener('change', autoSelesai);
  ['hari', 'jamMulai', 'jamSelesai'].forEach(k =>
    form.elements[k].addEventListener('change', checkConflictLive));

  // Isi nilai saat edit.
  if (record) {
    form.elements['ruanganId'].value = r.ruanganId || '';
    if (r.ruanganId && ruangLabelById.has(r.ruanganId)) form.elements['ruangCari'].value = ruangLabelById.get(r.ruanganId);
    form.elements['hari'].value = r.hari || '';
    form.elements['jamMulai'].value = r.jamMulai || '';
    form.elements['jamSelesai'].value = r.jamSelesai || '';
  }
  fillSlotPick();

  async function checkConflictLive() {
    const box = $('#conflictBox');
    const cand = {
      hari: form.elements['hari'].value,
      jamMulai: form.elements['jamMulai'].value,
      jamSelesai: form.elements['jamSelesai'].value,
      ruanganId: form.elements['ruanganId'].value,
      dosenId: dosenId,
      dosenIds: dosenIds,
      kelasId: kelasId,
      id: record ? record.id : undefined
    };
    if (!cand.hari || !cand.jamMulai || !cand.jamSelesai) { box.innerHTML = ''; return; }
    const { data } = await api('POST', '/api/jadwal/check', cand);
    box.innerHTML = renderConflictBox(data.conflicts);
  }

  $('#modalTitle').textContent = record ? 'Ubah Jadwal' : 'Tambah Jadwal';
  showModal(async (e) => {
    e.preventDefault();
    resolveMk(); resolveRuang();
    const m = DB.matakuliah.find(x => x.id === elMk.value);
    if (!m) return setModalMsg('Pilih mata kuliah (penawaran) dari daftar', 'err');
    if (!form.elements['ruanganId'].value) return setModalMsg('Pilih ruangan dari daftar', 'err');
    const body = {
      prodiId: m.prodiId,
      matakuliahId: m.id,
      kelasId: m.kelasId,
      dosenId: m.dosenId,
      dosenIds: dosenIdsOf(m),
      ruanganId: form.elements['ruanganId'].value,
      hari: form.elements['hari'].value,
      jamMulai: form.elements['jamMulai'].value,
      jamSelesai: form.elements['jamSelesai'].value,
      daring: isDaringRoomId(form.elements['ruanganId'].value)
    };
    if (toMin(body.jamSelesai) <= toMin(body.jamMulai))
      return setModalMsg('Jam selesai harus setelah jam mulai', 'err');
    await saveJadwal(body, record);
  });
  checkConflictLive();
}

function toMin(hhmm) { if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return NaN; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

function renderConflictBox(conflicts) {
  if (!conflicts || conflicts.length === 0)
    return '<div class="conflict ok">✓ Tidak ada bentrok</div>';
  let h = `<div class="conflict bad"><b>⚠ Bentrok terdeteksi (${conflicts.length}):</b><ul>`;
  conflicts.forEach(c => {
    h += `<li><b>${esc(c.jenis.join(' & '))}</b> — ${esc(c.matakuliah)} · ${esc(c.kelas)} · ${esc(c.dosen)} · ${esc(c.ruangan)} · ${esc(c.hari)} ${esc(c.jam)}</li>`;
  });
  h += '</ul></div>';
  return h;
}

async function saveJadwal(body, record) {
  const url = record ? `/api/jadwal/${record.id}` : '/api/jadwal';
  const method = record ? 'PUT' : 'POST';
  let res = await api(method, url, body);
  if (res.status === 409) {
    // Bentrok — tampilkan & tawarkan simpan paksa.
    setModalMsg('', '');
    const box = $('#conflictBox');
    box.innerHTML = renderConflictBox(res.data.conflicts) +
      `<button type="button" class="btn danger" id="btnForce">Tetap simpan (paksa)</button>`;
    $('#btnForce').addEventListener('click', async () => {
      const res2 = await api(method, url, Object.assign({ force: true }, body));
      if (!res2.ok) return setModalMsg(res2.data.error || 'Gagal', 'err');
      await loadDB(); hideModal(); toast('Jadwal disimpan (dengan bentrok!)', 'warn'); renderJadwal();
    });
    return;
  }
  if (!res.ok) return setModalMsg(res.data.error || 'Gagal menyimpan', 'err');
  await loadDB(); hideModal(); toast('Jadwal tersimpan'); renderJadwal();
}

// =====================================================================
// AUTO-GENERATE
// =====================================================================
function openAutoForm() {
  const form = $('#modalForm');
  const prodiOpts = DB.prodi.map(p => `<option value="${p.id}">${esc(p.kode ? p.kode + ' ' + p.nama : p.nama)}</option>`).join('');
  form.innerHTML = `
    <p class="hint">Sistem akan menyusun jadwal otomatis bebas bentrok berdasarkan mata kuliah, kelas, dosen pengampu, ruangan (sesuai kapasitas), hari &amp; slot waktu.</p>
    <label class="field"><span>Program Studi</span>
      <select name="prodiId"><option value="">Semua Program Studi</option>${prodiOpts}</select></label>
    <label class="field"><span>Semester (opsional)</span>
      <input type="number" name="semester" min="1" placeholder="Kosongkan untuk semua" /></label>
    <label class="field"><span>Pengelompokan jadwal</span>
      <select name="pusat">
        <option value="kelas">Berpusat pada kelas (mahasiswa)</option>
        <option value="dosen">Berpusat pada dosen</option>
      </select></label>
    <label class="field"><span>1 SKS = berapa menit</span>
      <input type="number" name="menitPerSks" min="1" value="${Number((DB.pengaturan||{}).menitPerSks)||45}" /></label>
    <label class="check"><input type="checkbox" name="replace" /> Hapus & susun ulang jadwal yang ada dalam lingkup ini</label>
    <label class="check"><input type="checkbox" name="daring" checked /> Alihkan jadwal bentrok ke <b>pembelajaran daring</b> (online, tanpa ruang)</label>`;
  $('#modalTitle').textContent = 'Auto-generate Jadwal';
  showModal(async (e) => {
    e.preventDefault();
    const body = {
      prodiId: form.elements['prodiId'].value || null,
      semester: form.elements['semester'].value || null,
      replace: form.elements['replace'].checked,
      daring: form.elements['daring'].checked,
      pusat: form.elements['pusat'].value,
      menitPerSks: Number(form.elements['menitPerSks'].value) || 45
    };
    const { ok, data } = await api('POST', '/api/auto-generate', body);
    if (!ok) return setModalMsg(data.error || 'Gagal', 'err');
    await loadDB();
    hideModal();
    let msg = `${data.created} jadwal dibuat`;
    if (data.daring) msg += ` (${data.daring} daring)`;
    msg += '.';
    if (data.unplaced && data.unplaced.length) msg += ` ${data.unplaced.length} tidak tertempatkan.`;
    toast(msg, data.unplaced && data.unplaced.length ? 'warn' : 'ok');
    if (data.unplaced && data.unplaced.length) showUnplaced(data.unplaced);
    renderJadwal();
  });
}

function showUnplaced(list) {
  const form = $('#modalForm');
  form.innerHTML = '<p class="hint">Beberapa mata kuliah tidak dapat dijadwalkan bebas bentrok:</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Mata Kuliah</th><th>Kelas</th><th>Alasan</th></tr></thead><tbody>' +
    list.map(u => `<tr><td>${esc(u.kode)}</td><td>${esc(u.matakuliah)}</td><td>${esc(u.kelas)}</td><td>${esc(u.alasan)}</td></tr>`).join('') +
    '</tbody></table></div>';
  $('#modalTitle').textContent = 'Hasil Auto-generate';
  showModal((e) => { e.preventDefault(); hideModal(); }, true);
}

// =====================================================================
// MODAL
// =====================================================================
let modalSubmit = null;
function setupModal() {
  $('#modalClose').addEventListener('click', hideModal);
  $('#modalCancel').addEventListener('click', hideModal);
  $('#modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') hideModal(); });
  $('#modalForm').addEventListener('submit', (e) => { if (modalSubmit) modalSubmit(e); });
}
function showModal(onSubmit, hideSave) {
  modalSubmit = onSubmit;
  setModalMsg('', '');
  const save = $('#modalSave');
  save.style.display = hideSave ? 'none' : '';
  save.textContent = 'Simpan';
  save.disabled = false;
  $('#modalOverlay').hidden = false;
}
function hideModal() { $('#modalOverlay').hidden = true; modalSubmit = null; }
function setModalMsg(msg, kind) {
  const el = $('#modalMsg');
  el.textContent = msg;
  el.className = 'modal-msg ' + (kind || '');
}

document.addEventListener('DOMContentLoaded', start);
