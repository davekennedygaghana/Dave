import type { BankStation } from '../lib/types';

/**
 * Kasus demo SINTETIS untuk menguji alur aplikasi.
 * Ditulis khusus untuk aplikasi ini — bukan dari bank sumber mana pun — dan tidak memakai gambar medis.
 * Tidak pernah masuk paket berbasis sumber.
 */
const DEMO_SOURCE = {
  document: 'Demo — bukan dari bank sumber',
  paraphrased: false,
  note: 'Kasus sintetis yang ditulis untuk menguji alur aplikasi.',
};

const base = { demo: true, eligible: true, issues: [] as string[], importedAt: '2026-01-01T00:00:00.000Z', bankName: 'Demo bawaan (Demo)' };

export const DEMO_STATIONS: BankStation[] = [
  {
    ...base,
    id: 'demo-trauma-01',
    topic: 'trauma',
    title: 'Stasiun Demo A — Nyeri panggul pasca jatuh',
    vignette:
      'Perempuan 71 tahun, tinggal sendiri dan berjalan tanpa alat bantu sebelum kejadian, datang ke IGD 3 jam setelah terpeleset di kamar mandi dan jatuh ke sisi kanan. Ia tidak dapat berdiri. Riwayat hipertensi terkontrol. Pemeriksaan: tungkai kanan tampak lebih pendek dan berotasi eksternal, nyeri hebat pada gerakan pasif panggul kanan, neurovaskular distal baik.',
    clinicalQuestion:
      'Apa diagnosis kerja dan diagnosis banding Anda? Sebutkan langkah awal penanganan di IGD serta pemeriksaan penunjang yang Anda minta.',
    followupQuestion:
      'Berdasarkan laporan pemeriksaan di atas, klasifikasikan cedera ini dan jelaskan pilihan tata laksana definitif beserta alasannya untuk pasien ini.',
    followupInfo:
      'Laporan radiologi (teks): X-ray pelvis AP dan hip kanan lateral menunjukkan garis fraktur intrakapsular pada collum femur kanan dengan pergeseran total fragmen (displaced). Tidak tampak lesi litik. Lab: Hb 12,1 g/dL, kreatinin normal.',
    imagingRequired: false,
    assets: [],
    key: {
      clinical:
        'Diagnosis kerja: fraktur proksimal femur kanan (curiga fraktur collum femur atau intertrochanter) akibat trauma energi rendah — perlu dicurigai fragility fracture. Banding: fraktur intertrochanter, fraktur acetabulum/ramus pubis, dislokasi panggul. Langkah awal: primary survey, analgesia adekuat (pertimbangkan fascia iliaca block), cairan, cek komorbid, pencegahan ulkus dekubitus dan delirium. Penunjang: X-ray pelvis AP + hip lateral, toraks, EKG, lab dasar; CT/MRI bila X-ray negatif namun curiga occult fracture.',
      followup:
        'Fraktur collum femur intrakapsular displaced (Garden III–IV). Pada lansia aktif, mandiri, kognisi baik: total hip arthroplasty (atau hemiarthroplasty bila tuntutan fungsional lebih rendah/komorbid berat). Fiksasi internal tidak dianjurkan karena risiko nonunion dan avascular necrosis tinggi. Operasi sebaiknya dalam 24–48 jam, mobilisasi dini, profilaksis VTE, evaluasi dan terapi osteoporosis.',
    },
    discussion: [
      { heading: 'Diagnosis', body: 'Fraktur collum femur kanan displaced pada lansia setelah jatuh energi rendah.' },
      { heading: 'Interpretasi', body: 'Fraktur intrakapsular dengan pergeseran total → suplai darah kaput femur kemungkinan besar terganggu (Garden III–IV).' },
      { heading: 'Tata laksana', body: 'Arthroplasty (THA untuk pasien aktif dan mandiri; hemiarthroplasty bila kebutuhan fungsi lebih rendah). Operasi dini, analgesia, mobilisasi dini, profilaksis VTE, tata laksana osteoporosis.' },
      { heading: 'Kesalahan umum', body: 'Melakukan fiksasi internal pada fraktur displaced lansia; menunda operasi tanpa alasan medis; lupa evaluasi osteoporosis dan pencegahan jatuh.' },
    ],
    checklist: {
      clinical: [
        { id: 'c1', text: 'Menyebut fraktur proksimal femur / collum femur sebagai diagnosis kerja', weight: 2 },
        { id: 'c2', text: 'Menyebut minimal dua diagnosis banding yang relevan', weight: 1 },
        { id: 'c3', text: 'Analgesia adekuat (termasuk opsi regional block) dan resusitasi awal', weight: 1 },
        { id: 'c4', text: 'Meminta X-ray pelvis AP dan hip lateral', weight: 1 },
      ],
      followup: [
        { id: 'f1', text: 'Mengklasifikasikan sebagai fraktur collum femur displaced (Garden III–IV)', weight: 2 },
        { id: 'f2', text: 'Memilih arthroplasty (THA/hemiarthroplasty) dengan alasan yang tepat', weight: 2 },
        { id: 'f3', text: 'Menjelaskan risiko AVN/nonunion bila difiksasi', weight: 1 },
        { id: 'f4', text: 'Menyebut operasi dini, profilaksis VTE, dan evaluasi osteoporosis', weight: 1 },
      ],
    },
    source: DEMO_SOURCE,
  },
  {
    ...base,
    id: 'demo-peds-01',
    topic: 'pediatrics',
    title: 'Stasiun Demo B — Anak tidak mau berjalan',
    vignette:
      'Anak laki-laki 6 tahun dibawa orang tuanya karena menolak berjalan sejak 2 hari dan mengeluh nyeri pada pangkal paha kiri. Seminggu sebelumnya ia batuk pilek. Tidak ada riwayat trauma yang jelas. Pemeriksaan: tampak kesakitan, panggul kiri diposisikan fleksi, abduksi, dan rotasi eksternal; rotasi internal sangat terbatas dan nyeri.',
    clinicalQuestion:
      'Apa diagnosis banding utama Anda untuk anak ini? Data klinis dan laboratorium apa yang Anda butuhkan untuk membedakannya?',
    followupQuestion:
      'Interpretasikan data lanjutan ini. Bagaimana probabilitas diagnosis Anda dan apa tata laksana yang Anda lakukan sekarang?',
    followupInfo:
      'Data lanjutan: suhu 39,0 °C; anak tetap tidak mau menumpu berat badan. Leukosit 15.800/µL, LED 52 mm/jam, CRP 4,8 mg/dL (rujukan < 1,0). USG panggul kiri: efusi sendi.',
    imagingRequired: false,
    assets: [],
    key: {
      clinical:
        'Banding utama: septic arthritis panggul vs transient synovitis. Banding lain: osteomielitis proksimal femur, Perthes, SCFE (lebih tua), JIA, keganasan (leukemia). Butuh: suhu, kemampuan menumpu berat badan, leukosit, LED, CRP (kriteria Kocher + CRP), kultur darah, USG panggul untuk efusi.',
      followup:
        'Demam > 38,5 °C, tidak mau menumpu, LED > 40, leukosit > 12.000, ditambah CRP > 2 mg/dL → probabilitas septic arthritis sangat tinggi (4/4 kriteria Kocher). Tata laksana: aspirasi sendi (analisis cairan, Gram, kultur) lalu irigasi/debridement sendi segera (arthrotomy) dan antibiotik empiris IV yang mencakup S. aureus (dan Kingella kingae sesuai usia), disesuaikan kultur. Ini kegawatan karena risiko kerusakan kartilago dan AVN.',
    },
    discussion: [
      { heading: 'Diagnosis', body: 'Septic arthritis panggul kiri.' },
      { heading: 'Interpretasi data', body: 'Keempat kriteria Kocher positif ditambah CRP tinggi dan efusi pada USG.' },
      { heading: 'Langkah awal', body: 'Aspirasi sendi untuk konfirmasi dan kultur; jangan menunda tindakan bedah bila klinis jelas.' },
      { heading: 'Tata laksana', body: 'Irigasi dan debridement segera, antibiotik empiris IV lalu disesuaikan kultur, pemantauan CRP.' },
      { heading: 'Kesalahan umum', body: 'Menganggap transient synovitis tanpa menilai kriteria; memberi antibiotik sebelum aspirasi; menunda drainase.' },
    ],
    checklist: {
      clinical: [
        { id: 'c1', text: 'Menyebut septic arthritis panggul sebagai diagnosis banding utama', weight: 2 },
        { id: 'c2', text: 'Menyebut transient synovitis dan minimal satu banding lain', weight: 1 },
        { id: 'c3', text: 'Meminta suhu, status menumpu berat badan, leukosit, LED, CRP', weight: 2 },
        { id: 'c4', text: 'Meminta USG panggul untuk menilai efusi', weight: 1 },
      ],
      followup: [
        { id: 'f1', text: 'Menghitung kriteria Kocher (4/4) dan menyimpulkan probabilitas tinggi septic arthritis', weight: 2 },
        { id: 'f2', text: 'Aspirasi sendi sebelum antibiotik (Gram, kultur, hitung sel)', weight: 1 },
        { id: 'f3', text: 'Irigasi/debridement sendi segera', weight: 2 },
        { id: 'f4', text: 'Antibiotik empiris IV mencakup S. aureus, disesuaikan kultur', weight: 1 },
      ],
    },
    source: DEMO_SOURCE,
  },
  {
    ...base,
    id: 'demo-sports-01',
    topic: 'sports',
    title: 'Stasiun Demo C — Lutut bengkak setelah bermain futsal',
    vignette:
      'Laki-laki 23 tahun, pemain futsal amatir, merasakan lututnya "bergeser" dan mendengar bunyi "pop" saat berputar dengan kaki menapak. Ia tidak dapat melanjutkan permainan. Dalam beberapa jam lutut kanan membengkak hebat. Datang 5 hari kemudian dengan keluhan lutut terasa tidak stabil saat menuruni tangga.',
    clinicalQuestion:
      'Apa diagnosis kerja Anda? Sebutkan pemeriksaan fisik spesifik yang akan Anda lakukan dan temuan yang Anda harapkan.',
    followupQuestion:
      'Dengan temuan ini, pemeriksaan penunjang apa yang Anda pilih dan bagaimana rencana tata laksana untuk pasien ini?',
    followupInfo:
      'Temuan pemeriksaan: efusi sedang. Lachman test: translasi anterior meningkat dengan end point lunak dibanding sisi kiri. Pivot shift positif. McMurray medial menimbulkan nyeri pada joint line medial. Valgus/varus stress stabil pada 0° dan 30°.',
    imagingRequired: false,
    assets: [],
    key: {
      clinical:
        'Diagnosis kerja: ruptur anterior cruciate ligament (ACL) kanan dengan hemarthrosis akut; curigai cedera meniskus atau ligamen kolateral penyerta. Pemeriksaan: Lachman (paling sensitif), anterior drawer, pivot shift, uji meniskus (McMurray, joint line tenderness), valgus/varus stress, posterior drawer, status neurovaskular.',
      followup:
        'X-ray lutut AP/lateral untuk menyingkirkan fraktur (mis. Segond fracture, avulsi tibial spine). MRI lutut untuk konfirmasi ruptur ACL dan menilai meniskus medial serta cedera penyerta. Tata laksana: fase awal RICE, rehabilitasi untuk mengembalikan ROM dan mengurangi efusi (prehab); pada pasien muda aktif dengan olahraga pivoting dan instabilitas → rekonstruksi ACL, dengan penanganan meniskus (repair bila memungkinkan) bersamaan.',
    },
    discussion: [
      { heading: 'Diagnosis', body: 'Ruptur ACL kanan, kemungkinan disertai robekan meniskus medial.' },
      { heading: 'Pemeriksaan kunci', body: 'Lachman paling sensitif; pivot shift paling spesifik untuk instabilitas rotasional.' },
      { heading: 'Penunjang', body: 'X-ray untuk fraktur/avulsi; MRI untuk konfirmasi dan cedera penyerta.' },
      { heading: 'Tata laksana', body: 'Prehab hingga ROM penuh dan efusi berkurang, lalu rekonstruksi ACL untuk atlet pivoting dengan instabilitas.' },
      { heading: 'Kesalahan umum', body: 'Hanya melakukan anterior drawer pada fase akut; tidak menilai meniskus/ligamen kolateral; operasi saat lutut masih kaku.' },
    ],
    checklist: {
      clinical: [
        { id: 'c1', text: 'Menyebut ruptur ACL sebagai diagnosis kerja', weight: 2 },
        { id: 'c2', text: 'Menyebut Lachman test dan pivot shift beserta temuan yang diharapkan', weight: 2 },
        { id: 'c3', text: 'Menilai cedera penyerta (meniskus, ligamen kolateral, PCL)', weight: 1 },
      ],
      followup: [
        { id: 'f1', text: 'Meminta X-ray untuk menyingkirkan fraktur/avulsi', weight: 1 },
        { id: 'f2', text: 'Meminta MRI lutut untuk konfirmasi dan cedera penyerta', weight: 1 },
        { id: 'f3', text: 'Merencanakan rehabilitasi awal (prehab) sebelum operasi', weight: 1 },
        { id: 'f4', text: 'Merekomendasikan rekonstruksi ACL dengan alasan (muda, pivoting, instabilitas)', weight: 2 },
      ],
    },
    source: DEMO_SOURCE,
  },
];
