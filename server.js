// =====================================================================
// server.js — Aplikasi Penjadwalan Kuliah
// Multi Program Studi. Deteksi bentrok: ruang, hari, jam, dosen, kelas.
// Manual (dengan peringatan bentrok) + Auto-generate jadwal bebas bentrok.
// Hanya modul bawaan Node.js (tanpa npm). Jalankan: node server.js
// =====================================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8099;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_ROOT = process.env.DATA_ROOT || ROOT;
const DATA_DIR = path.join(DATA_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB

// ------------------------------------------------------------------
// Utilitas
// ------------------------------------------------------------------
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// ------------------------------------------------------------------
// Autentikasi (password scrypt + sesi token di memori)
// ------------------------------------------------------------------
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), s, 64).toString('hex');
  return `${s}:${derived}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt] = stored.split(':');
  const check = hashPassword(password, salt);
  const a = Buffer.from(check), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const SESSIONS = new Map(); // token -> { userId, exp }
function newSession(userId) {
  const t = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(t, { userId, exp: Date.now() + 1000 * 60 * 60 * 12 });
  return t;
}
function userFromReq(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = SESSIONS.get(m[1]);
  if (!s || s.exp < Date.now()) { SESSIONS.delete(m[1]); return null; }
  return DB.users.find(u => u.id === s.userId) || null;
}
function pubUser(u) { return { id: u.id, username: u.username, nama: u.nama, role: u.role, prodiId: u.prodiId || null, fakultasId: u.fakultasId || null }; }
// Info pengguna lengkap untuk panel Kelola Pengguna (tanpa hash password).
function pubUserFull(u) {
  let lingkup = '-';
  if (u.role === 'admin') lingkup = 'Semua (master)';
  else if (u.role === 'prodi') { const p = DB.prodi.find(x => x.id === u.prodiId); lingkup = p ? (p.kode ? p.kode + ' ' + p.nama : p.nama) : '(prodi terhapus)'; }
  else if (u.role === 'fakultas') { const f = DB.fakultas.find(x => x.id === u.fakultasId); lingkup = f ? (f.kode ? f.kode + ' — ' + f.nama : f.nama) : '(fakultas terhapus)'; }
  return { id: u.id, username: u.username, nama: u.nama, role: u.role, prodiId: u.prodiId || null, fakultasId: u.fakultasId || null, nonaktif: !!u.nonaktif, lingkup };
}
// Himpunan id prodi dalam sebuah fakultas.
function prodiIdsOfFakultas(fakultasId) {
  return new Set(DB.prodi.filter(p => p.fakultasId === fakultasId).map(p => p.id));
}
// Prodi ini termasuk fakultas milik user? (untuk otorisasi akun fakultas)
function inUserFakultas(user, prodiId) {
  if (!user || user.role !== 'fakultas') return true;
  const p = DB.prodi.find(x => x.id === prodiId);
  return !!(p && p.fakultasId === user.fakultasId);
}
// Buat akun admin + akun per prodi + akun per fakultas bila belum ada. Password awal = username.
function seedUsers() {
  if (!Array.isArray(DB.users)) DB.users = [];
  // Buang akun prodi/fakultas yatim (entitas induknya sudah dihapus) agar tak bentrok username.
  DB.users = DB.users.filter(u => {
    if (u.role === 'prodi') return DB.prodi.some(p => p.id === u.prodiId);
    if (u.role === 'fakultas') return DB.fakultas.some(f => f.id === u.fakultasId);
    return true;
  });
  if (!DB.users.some(u => u.role === 'admin')) {
    DB.users.push({ id: uid('user'), username: 'admin', nama: 'Administrator', role: 'admin', pass: hashPassword('admin123') });
  }
  DB.prodi.forEach(p => {
    if (!DB.users.some(u => u.role === 'prodi' && u.prodiId === p.id)) {
      const uname = String(p.kode || p.id);
      DB.users.push({ id: uid('user'), username: uname, nama: p.nama, role: 'prodi', prodiId: p.id, pass: hashPassword(uname) });
    }
  });
  DB.fakultas.forEach(f => {
    if (!DB.users.some(u => u.role === 'fakultas' && u.fakultasId === f.id)) {
      const uname = String(f.kode || f.id);
      DB.users.push({ id: uid('user'), username: uname, nama: f.nama, role: 'fakultas', fakultasId: f.id, pass: hashPassword(uname) });
    }
  });
}
// Data yang dikirim ke frontend, disaring sesuai peran.
function dbForUser(u) {
  const base = {
    hari: DB.hari, jenisRuang: DB.jenisRuang, pengaturan: DB.pengaturan, tahunAkademik: DB.tahunAkademik,
    templateSK: DB.templateSK, fakultas: DB.fakultas, prodi: DB.prodi, ruangan: DB.ruangan,
    semester: DB.semester, slot: DB.slot, jenisRuangFak: DB.jenisRuangFak, templateSKFak: DB.templateSKFak,
    dosen: DB.dosen, matakuliah: DB.matakuliah, kelas: DB.kelas, jadwal: DB.jadwal,
    dosenSemua: DB.dosen, // semua dosen (lintas prodi) untuk pemilihan pengampu
    matakuliahSemua: DB.matakuliah, // semua MK (lintas prodi/fakultas) untuk hitung beban dosen
    prodiSemua: DB.prodi, // semua prodi untuk resolusi nama homebase dosen tamu
    _me: pubUser(u)
  };
  if (u.role === 'prodi') {
    base.dosen = DB.dosen.filter(d => d.prodiId === u.prodiId);
    base.matakuliah = DB.matakuliah.filter(m => m.prodiId === u.prodiId);
    base.kelas = DB.kelas.filter(k => k.prodiId === u.prodiId);
    base.jadwal = DB.jadwal.filter(j => j.prodiId === u.prodiId);
  } else if (u.role === 'fakultas') {
    const pids = prodiIdsOfFakultas(u.fakultasId);
    base.fakultas = DB.fakultas.filter(f => f.id === u.fakultasId);
    base.prodi = DB.prodi.filter(p => p.fakultasId === u.fakultasId);
    base.dosen = DB.dosen.filter(d => pids.has(d.prodiId));
    base.matakuliah = DB.matakuliah.filter(m => pids.has(m.prodiId));
    base.kelas = DB.kelas.filter(k => pids.has(k.prodiId));
    base.jadwal = DB.jadwal.filter(j => pids.has(j.prodiId));
    // Ruangan milik fakultasnya + ruang daring (bersama).
    base.ruangan = DB.ruangan.filter(r => r.daring || r.fakultasId === u.fakultasId);
    // dosenSemua tetap berisi semua dosen agar bisa memilih dosen lintas fakultas.
  }
  return base;
}
const PRODI_WRITABLE = ['dosen', 'matakuliah', 'kelas'];
// Akun fakultas: koleksi yang terikat prodi (divalidasi harus di fakultasnya).
const FAKULTAS_PRODISCOPED = ['prodi', 'dosen', 'matakuliah', 'kelas', 'jadwal'];

// "HH:MM" -> menit sejak 00:00
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
// menit -> "HH:MM"
function fromMinutes(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
// Total SKS mata kuliah (teori + praktik).
function totalSks(mk) {
  const t = Number(mk.sks);
  if (t) return t;
  return (Number(mk.sksTeori) || 0) + (Number(mk.sksPraktik) || 0);
}
const MENIT_PER_SKS = 45;
// Dua rentang waktu beririsan? [aS,aE) vs [bS,bE)
function overlap(aS, aE, bS, bE) {
  return aS < bE && bS < aE;
}
// Hash sederhana & stabil dari string (untuk sebar anchor hari per dosen).
function hashKode(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ------------------------------------------------------------------
// Penyimpanan (satu file JSON, tulis atomik)
// ------------------------------------------------------------------
const COLLECTIONS = ['fakultas', 'prodi', 'dosen', 'ruangan', 'matakuliah', 'kelas', 'semester', 'slot', 'tahunAkademik', 'jadwal'];
let DB = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
// Template Surat Tugas (SK). Placeholder: {dosen} {ta} {semester} {kota} {tanggal}.
function defaultTemplateSK() {
  return {
    kop: 'PIMPINAN FAKULTAS\nUNIVERSITAS ...\nAlamat: ...',
    logo: '',
    judul: 'SURAT TUGAS',
    nomor: '',
    lampiran: '-',
    hal: 'Surat Tugas Mengajar Semester {semester} Tahun Akademik {ta}',
    kepada: 'Yth. {dosen}\ndi Tempat',
    pembuka: 'Assalamualaikum Wr. Wb.',
    isi: 'Disampaikan kepada Bapak/Ibu Dosen bahwa ditugaskan mengajar sesuai jadwal Perkuliahan Semester {semester} Tahun Akademik {ta} yang telah selesai disusun, dengan rincian sebagai berikut:',
    ketentuan: 'Kuliah dimulai : ...\nUjian Akhir Semester : ...\nPemasukan Nilai : ...',
    penutup: 'Sangat diharapkan perkuliahan dapat berlangsung sebagaimana mestinya dan selesai tepat pada waktunya. Kerja sama dan partisipasi Bapak/Ibu sangat diharapkan demi suksesnya tugas kita bersama. Terima kasih.',
    salam: 'Wassalamualaikum Wr. Wb.',
    kota: 'Makassar',
    jabatan: 'Dekan',
    namaPenandatangan: '',
    nipPenandatangan: ''
  };
}
function defaultDB() {
  return {
    hari: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
    // Kategori/jenis ruang yang tersedia (Kelas + berbagai Lab + jenis kegiatan).
    jenisRuang: ['Kelas', 'Lab Komputer', 'Lab IPA', 'Lab Bahasa', 'Lab Fisika', 'Lab Biologi', 'Lab Microteaching', 'Ujian', 'Praktik Lapangan'],
    // Kategori ruang khusus per fakultas (override daftar global). { fakultasId: [..] }
    jenisRuangFak: {},
    // Periode akademik yang sedang aktif.
    pengaturan: { tahunAkademik: '2025/2026', semesterAktif: 'Ganjil', menitPerSks: MENIT_PER_SKS },
    // Master daftar tahun akademik (tiap tahun punya periode Ganjil & Genap).
    tahunAkademik: [{ id: uid('ta'), nama: '2025/2026' }],
    // Template Surat Tugas (SK) mengajar, dapat disesuaikan di aplikasi.
    templateSK: defaultTemplateSK(),
    // Template SK khusus per fakultas (override global). { fakultasId: {..} }
    templateSKFak: {},
    fakultas: [],
    prodi: [],
    dosen: [],
    ruangan: [],
    matakuliah: [],
    kelas: [],
    // Master semester (default 1..8)
    semester: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: uid('smt'), nomor: n, nama: 'Semester ' + n })),
    // Rentang/kelompok jam (durasi kuliah dihitung dari SKS, 1 SKS = 45 menit).
    slot: [
      { id: uid('slot'), kelompok: 'Pagi', jamMulai: '07:00', jamSelesai: '12:00' },
      { id: uid('slot'), kelompok: 'Siang', jamMulai: '13:00', jamSelesai: '18:00' }
    ],
    jadwal: []
  };
}
// Prodi khusus penampung dosen Non Home Base (Luar Biasa / LB).
function findLBProdi() {
  return DB.prodi.find(p =>
    /non\s*home\s*base/i.test(p.nama || '') ||
    /\blb\b/i.test(p.nama || '') ||
    /luar\s*biasa/i.test(p.nama || '')) || null;
}
function loadDB() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch (e) { console.error('Gagal membaca db.json, membuat baru:', e.message); DB = null; }
  }
  if (!DB) { DB = defaultDB(); saveDB(); }
  // Migrasi ringan: pastikan semua koleksi ada.
  if (!Array.isArray(DB.hari)) DB.hari = defaultDB().hari;
  if (!Array.isArray(DB.jenisRuang) || DB.jenisRuang.length === 0) DB.jenisRuang = defaultDB().jenisRuang;
  if (!DB.jenisRuangFak || typeof DB.jenisRuangFak !== 'object') DB.jenisRuangFak = {};
  if (!DB.pengaturan || typeof DB.pengaturan !== 'object') DB.pengaturan = defaultDB().pengaturan;
  if (!DB.pengaturan.tahunAkademik) DB.pengaturan.tahunAkademik = defaultDB().pengaturan.tahunAkademik;
  if (!DB.pengaturan.semesterAktif) DB.pengaturan.semesterAktif = defaultDB().pengaturan.semesterAktif;
  if (!(Number(DB.pengaturan.menitPerSks) > 0)) DB.pengaturan.menitPerSks = MENIT_PER_SKS;
  // Template SK: isi kunci yang belum ada dengan default.
  DB.templateSK = Object.assign(defaultTemplateSK(), DB.templateSK || {});
  if (!DB.templateSKFak || typeof DB.templateSKFak !== 'object') DB.templateSKFak = {};
  seedUsers();
  for (const c of COLLECTIONS) if (!Array.isArray(DB[c])) DB[c] = [];
  if (DB.slot.length === 0) DB.slot = defaultDB().slot;
  if (DB.semester.length === 0) DB.semester = defaultDB().semester;
  ensureDaringRoom();
  // Migrasi: ruangan lama (tanpa fakultasId, bukan daring) → milik FKIP.
  const fkip = DB.fakultas.find(f => String(f.kode || '').toUpperCase() === 'FKIP' || /keguruan dan ilmu pendidikan/i.test(f.nama || ''));
  if (fkip) DB.ruangan.forEach(r => { if (!r.daring && !r.fakultasId) r.fakultasId = fkip.id; });
  // Aturan: dosen tanpa NIP/NIDN → homebase otomatis ke prodi "Non Home Base (LB)".
  const lb = findLBProdi();
  if (lb) DB.dosen.forEach(d => { if (!String(d.kode || '').trim() && d.prodiId !== lb.id) d.prodiId = lb.id; });
  // Migrasi satu kali: dosen berlaku lintas periode → gabungkan duplikat antar-periode & remap referensi.
  if (!DB.pengaturan._dosenGlobal) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyOf = d => { const k = String(d.kode || '').trim(); return k ? 'k:' + k.toLowerCase() : 'n:' + (d.prodiId || '') + '|' + norm(d.nama); };
    const canon = new Map(), remap = new Map();
    for (const d of DB.dosen) {
      const key = keyOf(d);
      if (!canon.has(key)) canon.set(key, d);
      else remap.set(d.id, canon.get(key).id);
    }
    for (const d of canon.values()) { delete d.tahunAkademik; delete d.semesterAktif; }
    DB.dosen = Array.from(canon.values());
    const fix = obj => {
      if (obj.dosenId && remap.has(obj.dosenId)) obj.dosenId = remap.get(obj.dosenId);
      if (Array.isArray(obj.dosenIds)) obj.dosenIds = obj.dosenIds.map(id => remap.get(id) || id).filter((v, i, a) => a.indexOf(v) === i);
    };
    DB.matakuliah.forEach(fix);
    DB.jadwal.forEach(fix);
    DB.pengaturan._dosenGlobal = true;
    saveDB();
  }
  // Seed daftar tahun akademik dari data yang ada bila masih kosong.
  if (DB.tahunAkademik.length === 0) {
    const names = new Set();
    if (DB.pengaturan && DB.pengaturan.tahunAkademik) names.add(DB.pengaturan.tahunAkademik);
    ['matakuliah', 'dosen', 'jadwal'].forEach(c => (DB[c] || []).forEach(r => { if (r.tahunAkademik) names.add(r.tahunAkademik); }));
    if (names.size === 0) names.add('2025/2026');
    DB.tahunAkademik = Array.from(names).sort().map(n => ({ id: uid('ta'), nama: n }));
  }
}
let saveTimer = null;
function saveDB() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Ruang daring: kapasitas tak terbatas, boleh dipakai banyak kelas bersamaan.
function ensureDaringRoom() {
  if (!Array.isArray(DB.ruangan)) DB.ruangan = [];
  let r = DB.ruangan.find(x => x.daring);
  if (!r) {
    r = { id: uid('rng'), kode: 'DARING', nama: 'Daring (Online)', jenisRuang: 'Daring', kapasitas: 9999, daring: true };
    DB.ruangan.push(r);
  }
  return r;
}
function isDaringRoom(id) {
  const r = DB.ruangan.find(x => x.id === id);
  return !!(r && r.daring);
}
// Kumpulan id dosen sebuah penawaran/jadwal (mendukung banyak dosen).
function dosenSetOf(x) {
  if (x && Array.isArray(x.dosenIds) && x.dosenIds.length) return x.dosenIds;
  return (x && x.dosenId) ? [x.dosenId] : [];
}

// ------------------------------------------------------------------
// Deteksi bentrok
// ------------------------------------------------------------------
// Periode akademik (tahun akademik + semester aktif). Jadwal beda periode
// tidak dianggap bentrok.
function samePeriode(a, b) {
  return (a.tahunAkademik || '') === (b.tahunAkademik || '') &&
    (a.semesterAktif || '') === (b.semesterAktif || '');
}
// Lengkapi kandidat dengan periode aktif bila belum ada.
function withPeriode(cand) {
  return Object.assign({
    tahunAkademik: DB.pengaturan.tahunAkademik,
    semesterAktif: DB.pengaturan.semesterAktif
  }, cand);
}
// Jadwal dalam periode yang sama dengan kandidat.
function jadwalSePeriode(cand) {
  return DB.jadwal.filter(j => samePeriode(j, cand));
}
// Bandingkan kandidat jadwal terhadap daftar jadwal lain.
// Kandidat: {hari, jamMulai, jamSelesai, ruanganId, dosenId, kelasId, id?}
function findConflicts(cand, list) {
  const cS = toMinutes(cand.jamMulai), cE = toMinutes(cand.jamSelesai);
  const out = [];
  for (const j of list) {
    if (cand.id && j.id === cand.id) continue; // abaikan diri sendiri saat edit
    if (j.hari !== cand.hari) continue;
    const jS = toMinutes(j.jamMulai), jE = toMinutes(j.jamSelesai);
    if (!overlap(cS, cE, jS, jE)) continue;
    const jenis = [];
    // Ruang daring tak terbatas kapasitas → tidak pernah bentrok ruang.
    if (cand.ruanganId && !isDaringRoom(cand.ruanganId) && j.ruanganId === cand.ruanganId) jenis.push('ruangan');
    const candDs = dosenSetOf(cand), jDs = dosenSetOf(j);
    if (candDs.length && jDs.some(id => candDs.includes(id))) jenis.push('dosen');
    if (cand.kelasId && j.kelasId === cand.kelasId) jenis.push('kelas');
    if (jenis.length) out.push({ jadwalId: j.id, jenis, jadwal: j });
  }
  return out;
}

// ------------------------------------------------------------------
// Slot per hari
// ------------------------------------------------------------------
// Slot dengan field `hari` berlaku khusus hari-hari itu. Jika sebuah hari
// punya slot khusus, hanya slot itu yang dipakai; jika tidak, dipakai
// slot umum (hari kosong). Berguna mis. Jumat yang punya jeda salat.
// `hari` bisa berupa array beberapa hari, string satu hari, atau kosong.
function slotHariArr(s) {
  if (Array.isArray(s.hari)) return s.hari;
  if (s.hari) return [s.hari];
  return [];
}
function slotsForHari(hari) {
  const spesifik = DB.slot.filter(s => slotHariArr(s).includes(hari));
  const base = spesifik.length ? spesifik : DB.slot.filter(s => slotHariArr(s).length === 0);
  return base.slice().sort((a, b) => toMinutes(a.jamMulai) - toMinutes(b.jamMulai));
}
// Jenis mata kuliah dengan jadwal fleksibel (tanpa hari/jam/ruang tetap).
const JENIS_FLEKSIBEL = ['Ujian', 'Praktik Lapangan'];

// ------------------------------------------------------------------
// Auto-generate jadwal bebas bentrok (greedy best-fit)
// ------------------------------------------------------------------
function autoGenerate(opts) {
  const prodiId = opts.prodiId || null;
  const semester = opts.semester ? Number(opts.semester) : null;
  const replace = !!opts.replace;
  const fakultasId = opts.fakultasId || null; // lingkup akun fakultas
  const fakPids = fakultasId ? prodiIdsOfFakultas(fakultasId) : null;
  const daringMode = opts.daring !== false; // default: alihkan yang bentrok ke daring
  const pusat = opts.pusat === 'dosen' ? 'dosen' : 'kelas'; // fokus pengelompokan hari
  const menitPerSks = Number(opts.menitPerSks) > 0 ? Number(opts.menitPerSks) : (Number(DB.pengaturan.menitPerSks) || MENIT_PER_SKS);
  DB.pengaturan.menitPerSks = menitPerSks; // simpan sebagai aturan aktif
  const periode = { tahunAkademik: DB.pengaturan.tahunAkademik, semesterAktif: DB.pengaturan.semesterAktif };

  // Lingkup penggantian: dalam periode aktif + filter prodi/semester/fakultas.
  let scopeFilter = (j) => {
    if (!samePeriode(j, periode)) return false;
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    if (prodiId && (!mk || mk.prodiId !== prodiId)) return false;
    if (fakPids && (!mk || !fakPids.has(mk.prodiId))) return false;
    if (semester && (!mk || Number(mk.semester) !== semester)) return false;
    return true;
  };

  if (replace) {
    DB.jadwal = DB.jadwal.filter(j => !scopeFilter(j));
  }

  // Basis cek bentrok: hanya jadwal pada periode aktif.
  const placed = DB.jadwal.filter(j => samePeriode(j, periode));

  // Setiap mata kuliah (penawaran) sudah berisi kelas & dosen; jadwalkan langsung.
  const assignments = [];
  for (const mk of DB.matakuliah) {
    if (!samePeriode(mk, periode)) continue;
    if (prodiId && mk.prodiId !== prodiId) continue;
    if (fakPids && !fakPids.has(mk.prodiId)) continue;
    if (semester && Number(mk.semester) !== semester) continue;
    const kelas = DB.kelas.find(k => k.id === mk.kelasId);
    if (!kelas) continue;
    if (placed.some(j => j.matakuliahId === mk.id)) continue; // sudah dijadwalkan
    assignments.push({ mk, kelas });
  }
  // Prioritaskan kelas besar & SKS besar; kelompokkan per dosen agar mudah diklaster.
  assignments.sort((a, b) =>
    (Number(b.kelas.jumlahMhs) || 0) - (Number(a.kelas.jumlahMhs) || 0) ||
    (a.mk.dosenId || '').localeCompare(b.mk.dosenId || '') ||
    (Number(b.mk.sks) || 0) - (Number(a.mk.sks) || 0));

  const hariList = DB.hari;

  const created = [];
  const unplaced = [];
  for (const { mk, kelas } of assignments) {
    // Dosen dari penawaran (mata kuliah) — bisa lebih dari satu (team teaching).
    let dosenId = mk.dosenId || null;
    if (!dosenId) {
      const d = DB.dosen.find(x => x.prodiId === mk.prodiId && samePeriode(x, periode))
        || DB.dosen.find(x => samePeriode(x, periode));
      dosenId = d ? d.id : null;
    }
    if (!dosenId) { unplaced.push({ mk, kelas, alasan: 'Tidak ada dosen tersedia' }); continue; }
    const dsList = dosenSetOf(mk).length ? dosenSetOf(mk) : [dosenId];

    // MK jenis fleksibel (Ujian / Praktik Lapangan): tanpa hari/jam/ruang.
    if (JENIS_FLEKSIBEL.includes(mk.jenisRuang)) {
      const rec = {
        id: uid('jdw'), prodiId: mk.prodiId, matakuliahId: mk.id, dosenId, dosenIds: dsList,
        ruanganId: '', kelasId: kelas.id, hari: '', jamMulai: '', jamSelesai: '',
        tahunAkademik: periode.tahunAkademik, semesterAktif: periode.semesterAktif
      };
      DB.jadwal.push(rec); placed.push(rec); created.push(rec);
      continue;
    }

    // Ruangan sesuai jenis (Kelas/Lab) lalu memenuhi kapasitas (best-fit).
    const tipe = mk.jenisRuang || 'Kelas';
    // Ruang fisik milik fakultas prodi MK ini (tiap fakultas punya ruang sendiri).
    const prodiMk = DB.prodi.find(p => p.id === mk.prodiId);
    const fIdMk = prodiMk ? prodiMk.fakultasId : null;
    const fisik = DB.ruangan.filter(r => !r.daring && (!fIdMk || r.fakultasId === fIdMk));
    const pool = fisik.filter(r => (r.jenisRuang || 'Kelas') === tipe);
    const poolPakai = pool.length ? pool : fisik;
    const butuh = Number(kelas.jumlahMhs) || 0;
    const ruangCocok = poolPakai
      .filter(r => (Number(r.kapasitas) || 0) >= butuh)
      .sort((a, b) => (Number(a.kapasitas) || 0) - (Number(b.kapasitas) || 0));
    const ruangCoba = ruangCocok.length ? ruangCocok : poolPakai.slice();
    if (ruangCoba.length === 0) { unplaced.push({ mk, kelas, alasan: 'Tidak ada ruangan' }); continue; }

    // Urutan hari: padatkan pertemuan per KELAS (2–4/hari) sebelum membuka hari
    // baru, dengan batas atas per kelas & per dosen agar tak menumpuk berlebihan.
    const MAKS_KELAS_HARI = 4;   // maksimal pertemuan satu kelas dalam sehari
    const MAKS_DOSEN_HARI = 4;   // batas wajar pertemuan satu dosen dalam sehari
    const cntK = {}, cntD = {};
    hariList.forEach(h => { cntK[h] = 0; cntD[h] = 0; });
    placed.forEach(j => {
      if (cntK[j.hari] == null) return;
      if (j.kelasId === kelas.id) cntK[j.hari]++;
      if (dosenSetOf(j).includes(dosenId)) cntD[j.hari]++;
    });
    // Anchor & pemadatan mengikuti fokus pengelompokan: kelas atau dosen.
    const cntPusat = pusat === 'dosen' ? cntD : cntK;
    const capPusat = pusat === 'dosen' ? MAKS_DOSEN_HARI : MAKS_KELAS_HARI;
    const anchorId = pusat === 'dosen' ? dosenId : kelas.id;
    const dipakaiPusat = hariList.map((h, i) => cntPusat[h] > 0 ? i : -1).filter(i => i >= 0);
    const anchor = hashKode(anchorId) % hariList.length;
    const hariUrut = hariList.map((h, i) => {
      const ck = cntK[h], cd = cntD[h], cp = cntPusat[h];
      let skor = 0;
      if (ck >= MAKS_KELAS_HARI) skor += 1000;   // jangan lampaui batas kelas/hari
      if (cd >= MAKS_DOSEN_HARI) skor += 1000;   // jangan lampaui batas dosen/hari
      // Padatkan ke hari yang sudah dipakai (menuju batas/hari) sebelum buka hari baru.
      skor += (cp === 0) ? 6 : (capPusat - cp);
      const jarak = dipakaiPusat.length
        ? Math.min(...dipakaiPusat.map(u => Math.abs(u - i)))
        : Math.abs(i - anchor);
      return { h, i, skor: skor + jarak * 2 };
    }).sort((a, b) => a.skor - b.skor || a.i - b.i).map(x => x.h);

    let done = false;
    // Durasi kuliah dari SKS; ditempatkan back-to-back dalam rentang jam.
    const dur = totalSks(mk) * menitPerSks;
    for (const hari of hariUrut) {
      // Batas keras: satu kelas & tiap dosen maksimal N pertemuan per hari.
      if (placed.filter(j => j.kelasId === kelas.id && j.hari === hari).length >= MAKS_KELAS_HARI) continue;
      if (dsList.some(did => placed.filter(j => dosenSetOf(j).includes(did) && j.hari === hari).length >= MAKS_DOSEN_HARI)) continue;
      const windows = slotsForHari(hari);
      const jamHari = placed.filter(j => j.hari === hari);
      for (const win of windows) {
        const winS = toMinutes(win.jamMulai), winE = toMinutes(win.jamSelesai);
        if (!(winS < winE) || dur <= 0) continue;
        // Utamakan ruang yang sudah dipakai KELAS ini pada SESI (rentang) yang sama —
        // boleh pindah ruang bila sesi berbeda (mis. pagi → siang).
        const ruangKelasSesi = new Set(
          jamHari.filter(j => j.kelasId === kelas.id && toMinutes(j.jamMulai) >= winS && toMinutes(j.jamMulai) < winE)
            .map(j => j.ruanganId));
        const ruangUrut = ruangCoba.slice().sort((a, b) =>
          (ruangKelasSesi.has(b.id) ? 1 : 0) - (ruangKelasSesi.has(a.id) ? 1 : 0));
        // Kandidat waktu mulai: awal rentang + akhir sesi yang sudah ada di rentang itu.
        const ends = jamHari.map(j => toMinutes(j.jamSelesai)).filter(t => t >= winS && t < winE);
        const starts = Array.from(new Set([winS, ...ends]))
          .filter(s => s + dur <= winE).sort((a, b) => a - b);
        for (const st of starts) {
          const jm = fromMinutes(st), js = fromMinutes(st + dur);
          for (const ruang of ruangUrut) {
            const cand = { hari, jamMulai: jm, jamSelesai: js, ruanganId: ruang.id, dosenIds: dsList, kelasId: kelas.id };
            if (findConflicts(cand, placed).length === 0) {
              const rec = {
                id: uid('jdw'),
                prodiId: mk.prodiId,
                matakuliahId: mk.id,
                dosenId,
                dosenIds: dsList,
                ruanganId: ruang.id,
                kelasId: kelas.id,
                hari,
                jamMulai: jm,
                jamSelesai: js,
                tahunAkademik: periode.tahunAkademik,
                semesterAktif: periode.semesterAktif
              };
              DB.jadwal.push(rec);
              placed.push(rec);
              jamHari.push(rec);
              created.push(rec);
              done = true;
              break;
            }
          }
          if (done) break;
        }
        if (done) break;
      }
      if (done) break;
    }
    // Alihkan ke DARING bila tak ada ruang fisik bebas bentrok (tanpa ruang, cek dosen & kelas saja).
    if (!done && daringMode) {
      const daringRoom = ensureDaringRoom();
      for (const hari of hariUrut) {
        if (placed.filter(j => j.kelasId === kelas.id && j.hari === hari).length >= MAKS_KELAS_HARI) continue;
        if (dsList.some(did => placed.filter(j => dosenSetOf(j).includes(did) && j.hari === hari).length >= MAKS_DOSEN_HARI)) continue;
        for (const win of slotsForHari(hari)) {
          const winS = toMinutes(win.jamMulai), winE = toMinutes(win.jamSelesai);
          if (!(winS < winE) || dur <= 0) continue;
          const ends = placed.filter(j => j.hari === hari).map(j => toMinutes(j.jamSelesai)).filter(t => t >= winS && t < winE);
          const starts = Array.from(new Set([winS, ...ends])).filter(s => s + dur <= winE).sort((a, b) => a - b);
          for (const st of starts) {
            const jm = fromMinutes(st), js = fromMinutes(st + dur);
            const cand = { hari, jamMulai: jm, jamSelesai: js, ruanganId: daringRoom.id, dosenIds: dsList, kelasId: kelas.id };
            if (findConflicts(cand, placed).length === 0) {
              const rec = {
                id: uid('jdw'), prodiId: mk.prodiId, matakuliahId: mk.id, dosenId, dosenIds: dsList,
                ruanganId: daringRoom.id, kelasId: kelas.id, hari, jamMulai: jm, jamSelesai: js, daring: true,
                tahunAkademik: periode.tahunAkademik, semesterAktif: periode.semesterAktif
              };
              DB.jadwal.push(rec); placed.push(rec); created.push(rec);
              done = true; break;
            }
          }
          if (done) break;
        }
        if (done) break;
      }
    }
    if (!done) unplaced.push({ mk, kelas, alasan: 'Tidak ada rentang/ruang/daring bebas bentrok' });
  }

  saveDB();
  return {
    created: created.length,
    daring: created.filter(r => r.daring).length,
    unplaced: unplaced.map(u => ({
      matakuliah: u.mk.nama, kode: u.mk.kode, kelas: u.kelas.nama, alasan: u.alasan
    }))
  };
}

// ------------------------------------------------------------------
// Helper HTTP
// ------------------------------------------------------------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel).replace(/\.\.+/g, ''); // cegah path traversal
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------------
// Validasi field wajib per koleksi
// ------------------------------------------------------------------
function validate(col, o) {
  const req = {
    fakultas: ['nama'],
    prodi: ['nama', 'fakultasId'],
    dosen: ['nama'],
    ruangan: ['nama'],
    matakuliah: ['nama', 'prodiId', 'semester', 'kelasId', 'dosenId'],
    kelas: ['nama', 'prodiId', 'semester'],
    semester: ['nomor'],
    tahunAkademik: ['nama'],
    slot: ['jamMulai', 'jamSelesai'],
    jadwal: ['matakuliahId', 'dosenId', 'ruanganId', 'kelasId', 'hari', 'jamMulai', 'jamSelesai']
  }[col] || [];
  const miss = req.filter(f => o[f] === undefined || o[f] === null || o[f] === '');
  return miss;
}

// ------------------------------------------------------------------
// Router API
// ------------------------------------------------------------------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1); // buang 'api'

  // ----- Autentikasi -----
  if (req.method === 'POST' && seg[0] === 'login') {
    const b = await readBody(req);
    const u = DB.users.find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase());
    if (!u || !verifyPassword(b.password, u.pass))
      return sendJSON(res, 401, { error: 'Username atau password salah' });
    if (u.nonaktif) return sendJSON(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' });
    return sendJSON(res, 200, { token: newSession(u.id), user: pubUser(u) });
  }
  if (req.method === 'POST' && seg[0] === 'logout') {
    const m = (req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/i);
    if (m) SESSIONS.delete(m[1]);
    return sendJSON(res, 200, { ok: true });
  }
  // Semua endpoint lain wajib login.
  const user = userFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Perlu login' });
  if (req.method === 'GET' && seg[0] === 'me') return sendJSON(res, 200, { user: pubUser(user) });
  // Ganti password sendiri.
  if (req.method === 'PUT' && seg[0] === 'akun' && seg[1] === 'password') {
    const b = await readBody(req);
    if (!verifyPassword(b.lama, user.pass)) return sendJSON(res, 400, { error: 'Password lama salah' });
    if (!b.baru || String(b.baru).length < 4) return sendJSON(res, 400, { error: 'Password baru minimal 4 karakter' });
    user.pass = hashPassword(b.baru);
    saveDB();
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/db  → basis data (disaring sesuai peran)
  if (req.method === 'GET' && seg[0] === 'db') {
    return sendJSON(res, 200, dbForUser(user));
  }

  // ----- Kelola Pengguna (admin saja) -----
  if (seg[0] === 'users') {
    if (user.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
    // GET daftar pengguna
    if (req.method === 'GET' && seg.length === 1) {
      return sendJSON(res, 200, DB.users.map(pubUserFull));
    }
    // POST buat admin baru
    if (req.method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      if (!username) return sendJSON(res, 400, { error: 'Username wajib diisi' });
      if (DB.users.some(u => u.username.toLowerCase() === username.toLowerCase()))
        return sendJSON(res, 400, { error: 'Username sudah dipakai' });
      const pass = String(b.password || '') || username;
      if (pass.length < 4) return sendJSON(res, 400, { error: 'Password minimal 4 karakter' });
      const rec = { id: uid('user'), username, nama: b.nama || username, role: 'admin', pass: hashPassword(pass) };
      DB.users.push(rec); saveDB();
      return sendJSON(res, 201, pubUserFull(rec));
    }
    // POST /api/users/{id}/reset → reset ke default (= username)
    if (req.method === 'POST' && seg.length === 3 && seg[2] === 'reset') {
      const u = DB.users.find(x => x.id === seg[1]);
      if (!u) return sendJSON(res, 404, { error: 'Pengguna tidak ditemukan' });
      u.pass = hashPassword(u.username); saveDB();
      return sendJSON(res, 200, { ok: true, password: u.username });
    }
    // PUT /api/users/{id} → ubah nama/password/status
    if (req.method === 'PUT' && seg.length === 2) {
      const u = DB.users.find(x => x.id === seg[1]);
      if (!u) return sendJSON(res, 404, { error: 'Pengguna tidak ditemukan' });
      const b = await readBody(req);
      if (b.nama != null) u.nama = String(b.nama);
      if (b.password) {
        if (String(b.password).length < 4) return sendJSON(res, 400, { error: 'Password minimal 4 karakter' });
        u.pass = hashPassword(String(b.password));
      }
      if (b.nonaktif != null) {
        if (b.nonaktif && u.id === user.id) return sendJSON(res, 400, { error: 'Tidak bisa menonaktifkan akun sendiri' });
        if (b.nonaktif && u.role === 'admin' && DB.users.filter(x => x.role === 'admin' && !x.nonaktif).length <= 1)
          return sendJSON(res, 400, { error: 'Tidak bisa menonaktifkan admin aktif terakhir' });
        u.nonaktif = !!b.nonaktif;
      }
      saveDB();
      return sendJSON(res, 200, pubUserFull(u));
    }
    // DELETE /api/users/{id} → hanya admin tambahan
    if (req.method === 'DELETE' && seg.length === 2) {
      const u = DB.users.find(x => x.id === seg[1]);
      if (!u) return sendJSON(res, 404, { error: 'Pengguna tidak ditemukan' });
      if (u.role !== 'admin') return sendJSON(res, 400, { error: 'Akun prodi/fakultas dibuat otomatis — nonaktifkan saja, tidak bisa dihapus.' });
      if (u.id === user.id) return sendJSON(res, 400, { error: 'Tidak bisa menghapus akun sendiri' });
      if (DB.users.filter(x => x.role === 'admin').length <= 1) return sendJSON(res, 400, { error: 'Tidak bisa menghapus admin terakhir' });
      DB.users = DB.users.filter(x => x.id !== u.id); saveDB();
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 405, { error: 'Metode tidak diizinkan' });
  }

  // Konfigurasi hanya untuk admin & fakultas (pengelola).
  const isManager = user.role === 'admin' || user.role === 'fakultas';
  if (seg[0] === 'config' && !isManager)
    return sendJSON(res, 403, { error: 'Tidak berwenang' });

  // PUT /api/config/hari → { hari: [...] }
  if (req.method === 'PUT' && seg[0] === 'config' && seg[1] === 'hari') {
    const body = await readBody(req);
    if (!Array.isArray(body.hari) || body.hari.length === 0)
      return sendJSON(res, 400, { error: 'Daftar hari tidak valid' });
    DB.hari = body.hari.map(String);
    saveDB();
    return sendJSON(res, 200, { hari: DB.hari });
  }

  // PUT /api/config/pengaturan → { tahunAkademik, semesterAktif }
  if (req.method === 'PUT' && seg[0] === 'config' && seg[1] === 'pengaturan') {
    const body = await readBody(req);
    const ta = String(body.tahunAkademik || '').trim();
    const sem = String(body.semesterAktif || '').trim();
    if (!ta) return sendJSON(res, 400, { error: 'Tahun akademik wajib diisi' });
    if (!['Ganjil', 'Genap', 'Pendek'].includes(sem))
      return sendJSON(res, 400, { error: 'Semester aktif tidak valid' });
    DB.pengaturan = { tahunAkademik: ta, semesterAktif: sem };
    saveDB();
    return sendJSON(res, 200, DB.pengaturan);
  }

  // PUT /api/config/jenis-ruang → { list: [...], fakultasId? }
  if (req.method === 'PUT' && seg[0] === 'config' && seg[1] === 'jenis-ruang') {
    const body = await readBody(req);
    if (!Array.isArray(body.list) || body.list.length === 0)
      return sendJSON(res, 400, { error: 'Daftar jenis ruang tidak valid' });
    let fId = body.fakultasId || null;
    if (user.role === 'fakultas') fId = user.fakultasId; // fakultas hanya boleh daftar miliknya
    const list = body.list.map(String);
    if (fId) DB.jenisRuangFak[fId] = list;   // override khusus fakultas
    else DB.jenisRuang = list;               // default global (admin)
    saveDB();
    return sendJSON(res, 200, { jenisRuang: DB.jenisRuang, jenisRuangFak: DB.jenisRuangFak });
  }

  // PUT /api/config/template-sk → simpan template Surat Tugas (global atau per fakultas)
  if (req.method === 'PUT' && seg[0] === 'config' && seg[1] === 'template-sk') {
    const body = await readBody(req) || {};
    if (body.logo && String(body.logo).length > 700000)
      return sendJSON(res, 400, { error: 'Ukuran logo terlalu besar (maks ~500 KB)' });
    let fId = body.fakultasId || null;
    if (user.role === 'fakultas') fId = user.fakultasId; // fakultas hanya template miliknya
    delete body.fakultasId;
    if (fId) {
      DB.templateSKFak[fId] = Object.assign(defaultTemplateSK(), DB.templateSKFak[fId] || {}, body);
      saveDB();
      return sendJSON(res, 200, DB.templateSKFak[fId]);
    }
    DB.templateSK = Object.assign(defaultTemplateSK(), DB.templateSK || {}, body);
    saveDB();
    return sendJSON(res, 200, DB.templateSK);
  }

  // Jadwal & auto-generate untuk pengelola (admin & fakultas).
  if ((seg[0] === 'jadwal' || seg[0] === 'auto-generate') && !isManager)
    return sendJSON(res, 403, { error: 'Tidak berwenang' });

  // POST /api/jadwal/check → cek bentrok tanpa menyimpan
  if (req.method === 'POST' && seg[0] === 'jadwal' && seg[1] === 'check') {
    const body = withPeriode(await readBody(req));
    const conflicts = findConflicts(body, jadwalSePeriode(body));
    return sendJSON(res, 200, { conflicts: expandConflicts(conflicts) });
  }

  // POST /api/jadwal/reset → hapus jadwal (opsional per periode)
  if (req.method === 'POST' && seg[0] === 'jadwal' && seg[1] === 'reset') {
    const body = await readBody(req);
    const before = DB.jadwal.length;
    const pids = user.role === 'fakultas' ? prodiIdsOfFakultas(user.fakultasId) : null;
    const perPeriode = body.tahunAkademik || body.semesterAktif;
    DB.jadwal = DB.jadwal.filter(j => {
      const cocokPeriode = perPeriode
        ? ((j.tahunAkademik || '') === (body.tahunAkademik || '') && (j.semesterAktif || '') === (body.semesterAktif || ''))
        : true;
      const dalamLingkup = !pids || pids.has(j.prodiId);
      return !(cocokPeriode && dalamLingkup); // hapus bila cocok periode & dalam lingkup
    });
    saveDB();
    return sendJSON(res, 200, { removed: before - DB.jadwal.length });
  }

  // POST /api/auto-generate
  if (req.method === 'POST' && seg[0] === 'auto-generate') {
    const body = await readBody(req);
    if (user.role === 'fakultas') body.fakultasId = user.fakultasId;
    const result = autoGenerate(body);
    return sendJSON(res, 200, result);
  }

  const col = seg[0];
  if (!COLLECTIONS.includes(col)) return sendJSON(res, 404, { error: 'Endpoint tidak dikenal' });

  // Otorisasi tulis untuk akun prodi: hanya dosen/matakuliah/kelas prodinya.
  const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
  if (isWrite && user.role === 'prodi') {
    if (!PRODI_WRITABLE.includes(col)) return sendJSON(res, 403, { error: 'Akun prodi tidak berhak mengubah data ini' });
  }
  // Akun fakultas: tidak boleh membuat/menghapus fakultas (hanya ubah miliknya).
  if (isWrite && user.role === 'fakultas' && col === 'fakultas' && req.method !== 'PUT') {
    return sendJSON(res, 403, { error: 'Akun fakultas tidak boleh membuat/menghapus fakultas' });
  }

  // GET /api/{col}
  if (req.method === 'GET' && seg.length === 1) {
    let data = DB[col];
    if (user.role === 'prodi') data = DB[col].filter(x => x.prodiId === user.prodiId);
    else if (user.role === 'fakultas') {
      if (col === 'fakultas') data = DB[col].filter(x => x.id === user.fakultasId);
      else if (col === 'prodi') data = DB[col].filter(x => x.fakultasId === user.fakultasId);
      else if (col === 'ruangan') data = DB[col].filter(x => x.daring || x.fakultasId === user.fakultasId);
      else if (FAKULTAS_PRODISCOPED.includes(col)) { const pids = prodiIdsOfFakultas(user.fakultasId); data = DB[col].filter(x => pids.has(x.prodiId)); }
    }
    return sendJSON(res, 200, data);
  }

  // POST /api/{col}  (buat)
  if (req.method === 'POST' && seg.length === 1) {
    const body = await readBody(req);
    // Akun prodi: paksa prodiId ke prodinya sendiri.
    if (user.role === 'prodi') body.prodiId = user.prodiId;
    // Akun fakultas: prodi baru dipaksa ke fakultasnya; data lain harus prodi di fakultasnya.
    if (user.role === 'fakultas') {
      if (col === 'prodi') body.fakultasId = user.fakultasId;
      else if (col === 'ruangan') body.fakultasId = user.fakultasId;
      else if (FAKULTAS_PRODISCOPED.includes(col) && !inUserFakultas(user, body.prodiId))
        return sendJSON(res, 403, { error: 'Prodi di luar fakultas Anda' });
    }
    const miss = validate(col, body);
    if (miss.length) return sendJSON(res, 400, { error: 'Field wajib kosong: ' + miss.join(', ') });

    if (col === 'jadwal') {
      const cand = withPeriode(body);
      const conflicts = findConflicts(cand, jadwalSePeriode(cand));
      if (conflicts.length && !body.force)
        return sendJSON(res, 409, { error: 'Jadwal bentrok', conflicts: expandConflicts(conflicts) });
      body.tahunAkademik = cand.tahunAkademik;
      body.semesterAktif = cand.semesterAktif;
    }
    // Penawaran (matakuliah) & kelas terikat periode aktif. Dosen berlaku lintas periode (tanpa stempel).
    if ((col === 'matakuliah' || col === 'kelas') && !body.tahunAkademik) {
      body.tahunAkademik = DB.pengaturan.tahunAkademik;
      body.semesterAktif = DB.pengaturan.semesterAktif;
    }
    // Dosen tanpa NIP/NIDN → homebase otomatis ke prodi "Non Home Base (LB)".
    if (col === 'dosen' && !String(body.kode || '').trim()) {
      const lb = findLBProdi();
      if (lb) body.prodiId = lb.id;
    }
    // Total SKS = teori + praktik.
    if (col === 'matakuliah') body.sks = (Number(body.sksTeori) || 0) + (Number(body.sksPraktik) || 0);
    // Normalisasi dosen (bisa banyak): dosenId = dosen utama (pertama).
    if ((col === 'matakuliah' || col === 'jadwal') && Array.isArray(body.dosenIds)) {
      body.dosenIds = body.dosenIds.filter(Boolean);
      if (!body.dosenId) body.dosenId = body.dosenIds[0] || '';
    }
    const rec = Object.assign({ id: uid(col) }, body);
    delete rec.force;
    DB[col].push(rec);
    // Prodi/Fakultas baru → buat akun loginnya.
    if (col === 'prodi' || col === 'fakultas') seedUsers();
    saveDB();
    return sendJSON(res, 201, rec);
  }

  // PUT /api/{col}/{id}  (ubah)
  if (req.method === 'PUT' && seg.length === 2) {
    const id = seg[1];
    const idx = DB[col].findIndex(x => x.id === id);
    if (idx === -1) return sendJSON(res, 404, { error: 'Data tidak ditemukan' });
    // Akun prodi hanya boleh mengubah data prodinya.
    if (user.role === 'prodi' && DB[col][idx].prodiId !== user.prodiId)
      return sendJSON(res, 403, { error: 'Bukan data prodi Anda' });
    // Akun fakultas: hanya data dalam fakultasnya.
    if (user.role === 'fakultas') {
      const exist = DB[col][idx];
      if (col === 'fakultas' && exist.id !== user.fakultasId)
        return sendJSON(res, 403, { error: 'Bukan fakultas Anda' });
      if (col === 'prodi' && exist.fakultasId !== user.fakultasId)
        return sendJSON(res, 403, { error: 'Bukan prodi fakultas Anda' });
      if (col === 'ruangan') {
        if (exist.daring) return sendJSON(res, 403, { error: 'Ruang Daring dikelola sistem' });
        if (exist.fakultasId !== user.fakultasId) return sendJSON(res, 403, { error: 'Bukan ruangan fakultas Anda' });
      }
      if (FAKULTAS_PRODISCOPED.includes(col) && col !== 'prodi' && !inUserFakultas(user, exist.prodiId))
        return sendJSON(res, 403, { error: 'Bukan data fakultas Anda' });
    }
    const body = await readBody(req);
    if (user.role === 'prodi') body.prodiId = user.prodiId;
    if (user.role === 'fakultas') {
      if (col === 'prodi') body.fakultasId = user.fakultasId; // tetap di fakultasnya
      if (col === 'ruangan') body.fakultasId = user.fakultasId;
      if (FAKULTAS_PRODISCOPED.includes(col) && col !== 'prodi' && body.prodiId && !inUserFakultas(user, body.prodiId))
        return sendJSON(res, 403, { error: 'Prodi di luar fakultas Anda' });
    }

    if (col === 'jadwal') {
      const cand = withPeriode(Object.assign({}, DB[col][idx], body, { id }));
      const conflicts = findConflicts(cand, jadwalSePeriode(cand));
      if (conflicts.length && !body.force)
        return sendJSON(res, 409, { error: 'Jadwal bentrok', conflicts: expandConflicts(conflicts) });
    }
    delete body.id; delete body.force;
    if (col === 'matakuliah') body.sks = (Number(body.sksTeori != null ? body.sksTeori : DB[col][idx].sksTeori) || 0) + (Number(body.sksPraktik != null ? body.sksPraktik : DB[col][idx].sksPraktik) || 0);
    if ((col === 'matakuliah' || col === 'jadwal') && Array.isArray(body.dosenIds)) {
      body.dosenIds = body.dosenIds.filter(Boolean);
      body.dosenId = body.dosenIds[0] || '';
    }
    DB[col][idx] = Object.assign({}, DB[col][idx], body);
    saveDB();
    return sendJSON(res, 200, DB[col][idx]);
  }

  // DELETE /api/{col}/{id}
  if (req.method === 'DELETE' && seg.length === 2) {
    const id = seg[1];
    const rec0 = DB[col].find(x => x.id === id);
    if (col === 'ruangan' && rec0 && rec0.daring)
      return sendJSON(res, 400, { error: 'Ruang Daring tidak boleh dihapus' });
    if (rec0 && user.role === 'prodi' && rec0.prodiId !== user.prodiId)
      return sendJSON(res, 403, { error: 'Bukan data prodi Anda' });
    if (rec0 && user.role === 'fakultas') {
      if (col === 'prodi' && rec0.fakultasId !== user.fakultasId)
        return sendJSON(res, 403, { error: 'Bukan prodi fakultas Anda' });
      if (col === 'ruangan' && rec0.fakultasId !== user.fakultasId)
        return sendJSON(res, 403, { error: 'Bukan ruangan fakultas Anda' });
      if (FAKULTAS_PRODISCOPED.includes(col) && col !== 'prodi' && !inUserFakultas(user, rec0.prodiId))
        return sendJSON(res, 403, { error: 'Bukan data fakultas Anda' });
    }
    const before = DB[col].length;
    DB[col] = DB[col].filter(x => x.id !== id);
    if (DB[col].length === before) return sendJSON(res, 404, { error: 'Data tidak ditemukan' });
    cascadeDelete(col, id);
    saveDB();
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 405, { error: 'Metode tidak diizinkan' });
}

// Lengkapi info bentrok dengan nama-nama untuk ditampilkan.
function expandConflicts(conflicts) {
  return conflicts.map(c => {
    const j = c.jadwal;
    const mk = DB.matakuliah.find(m => m.id === j.matakuliahId);
    const dosen = DB.dosen.find(d => d.id === j.dosenId);
    const ruang = DB.ruangan.find(r => r.id === j.ruanganId);
    const kelas = DB.kelas.find(k => k.id === j.kelasId);
    return {
      jenis: c.jenis,
      hari: j.hari,
      jam: `${j.jamMulai}-${j.jamSelesai}`,
      matakuliah: mk ? mk.nama : '-',
      dosen: dosen ? dosen.nama : '-',
      ruangan: ruang ? ruang.nama : '-',
      kelas: kelas ? kelas.nama : '-'
    };
  });
}

// Hapus data turunan saat induk dihapus (jaga konsistensi).
function cascadeDelete(col, id) {
  if (col === 'fakultas') {
    const prodiIds = DB.prodi.filter(p => p.fakultasId === id).map(p => p.id);
    DB.prodi = DB.prodi.filter(p => p.fakultasId !== id);
    prodiIds.forEach(pid => cascadeDelete('prodi', pid));
  } else if (col === 'prodi') {
    DB.matakuliah = DB.matakuliah.filter(m => m.prodiId !== id);
    DB.kelas = DB.kelas.filter(k => k.prodiId !== id);
    DB.dosen = DB.dosen.filter(d => d.prodiId !== id);
    DB.jadwal = DB.jadwal.filter(j => j.prodiId !== id);
  } else if (col === 'matakuliah') {
    DB.jadwal = DB.jadwal.filter(j => j.matakuliahId !== id);
  } else if (col === 'kelas') {
    const offIds = new Set(DB.matakuliah.filter(m => m.kelasId === id).map(m => m.id));
    DB.matakuliah = DB.matakuliah.filter(m => m.kelasId !== id);
    DB.jadwal = DB.jadwal.filter(j => j.kelasId !== id && !offIds.has(j.matakuliahId));
  } else if (col === 'dosen') {
    // Hapus dosen dari tiap penawaran/jadwal. Bila jadi tanpa dosen → hapus.
    const offHapus = new Set();
    DB.matakuliah.forEach(m => {
      const ds = dosenSetOf(m);
      if (!ds.includes(id)) return;
      const sisa = ds.filter(x => x !== id);
      if (sisa.length === 0) { offHapus.add(m.id); return; }
      m.dosenIds = sisa; m.dosenId = sisa[0];
    });
    DB.matakuliah = DB.matakuliah.filter(m => !offHapus.has(m.id));
    DB.jadwal = DB.jadwal.filter(j => {
      if (offHapus.has(j.matakuliahId)) return false;
      const ds = dosenSetOf(j);
      if (!ds.includes(id)) return true;
      const sisa = ds.filter(x => x !== id);
      if (sisa.length === 0) return false;
      j.dosenIds = sisa; j.dosenId = sisa[0];
      return true;
    });
  } else if (col === 'ruangan') {
    DB.jadwal = DB.jadwal.filter(j => j.ruanganId !== id);
  }
}

// ------------------------------------------------------------------
// Server
// ------------------------------------------------------------------
loadDB();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => {
      console.error('API error:', err);
      sendJSON(res, 500, { error: err.message || 'Kesalahan server' });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});
server.listen(PORT, HOST, () => {
  console.log(`SIMALIA (Sistem Informasi Manajemen Jadwal Kuliah) berjalan di http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[!] Port ${PORT} sedang dipakai — kemungkinan aplikasi SIMALIA sudah berjalan.`);
    console.error(`    Buka saja http://localhost:${PORT} di browser.\n`);
  } else {
    console.error('Gagal menjalankan server:', err.message);
  }
  process.exit(1);
});

