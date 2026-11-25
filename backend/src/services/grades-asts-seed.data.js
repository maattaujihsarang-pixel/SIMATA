/**
 * Canonical Subject Catalog & Official ASTS Ganjil 2026/2027 Seed Data (BUG 74)
 * Verified against MA At-Taujih Sarang Excel sheets for Kelas X (19), Kelas XI (21), Kelas XII (7).
 * All comma-decimal values ("38,5", "72,5", etc.) normalized to exact numeric floats.
 */

const ASSESSMENT_PERIODS = [
  {
    code: 'ASTS_GANJIL',
    short_label: 'ASTS Ganjil',
    full_label: 'Asesmen Sumatif Tengah Semester (ASTS) Ganjil',
    print_heading: 'HASIL NILAI ASTS GANJIL',
    semester: 'Ganjil',
    schedule_semester: 'GANJIL',
    order: 1
  },
  {
    code: 'ASAS_GANJIL',
    short_label: 'ASAS Ganjil',
    full_label: 'Asesmen Sumatif Akhir Semester (ASAS) Ganjil',
    print_heading: 'HASIL NILAI ASAS GANJIL',
    semester: 'Ganjil',
    schedule_semester: 'GANJIL',
    order: 2
  },
  {
    code: 'ASTS_GENAP',
    short_label: 'ASTS Genap',
    full_label: 'Asesmen Sumatif Tengah Semester (ASTS) Genap',
    print_heading: 'HASIL NILAI ASTS GENAP',
    semester: 'Genap',
    schedule_semester: 'GENAP',
    order: 3
  },
  {
    code: 'ASAS_GENAP',
    short_label: 'ASAS Genap',
    full_label: 'Asesmen Sumatif Akhir Semester (ASAS) Genap',
    print_heading: 'HASIL NILAI ASAS GENAP',
    semester: 'Genap',
    schedule_semester: 'GENAP',
    order: 4
  }
];

const GRADE_SUBJECT_CATALOG = {
  QH: { code: 'QH', name: "Al-Qur'an Hadits", schedule_codes: ['QH', 'Q.H'] },
  AA: { code: 'AA', name: 'Akidah Akhlak', schedule_codes: ['A.A', 'AA'] },
  FQ: { code: 'FQ', name: 'Fiqih', schedule_codes: ['FQ', 'F.Q'] },
  SKI: { code: 'SKI', name: 'Sejarah Kebudayaan Islam', schedule_codes: ['SKI'] },
  PPKN: { code: 'PPKN', name: 'PPKn', schedule_codes: ['PKN', 'PPKN'] },
  'B.INDO': { code: 'B.INDO', name: 'Bahasa Indonesia', schedule_codes: ['B.INDO', 'BINDO', 'BI'] },
  'B.ARAB': { code: 'B.ARAB', name: 'Bahasa Arab', schedule_codes: ['B.A', 'BA', 'B.ARAB'] },
  MTK: { code: 'MTK', name: 'Matematika', schedule_codes: ['MTK'] },
  'B.JAWA': { code: 'B.JAWA', name: 'Bahasa Jawa', schedule_codes: ['B.J', 'BJ', 'B.JAWA'] },
  'B.ING': { code: 'B.ING', name: 'Bahasa Inggris', schedule_codes: ['B.ING', 'BING', 'B.INGGRIS'] },
  SBK: { code: 'SBK', name: 'Seni Budaya', schedule_codes: ['SBK'] },
  PJOK: { code: 'PJOK', name: 'PJOK', schedule_codes: ['PJOK'] },
  PKWU: { code: 'PKWU', name: 'Prakarya & Kewirausahaan', schedule_codes: ['PKWU'] },
  GEO: { code: 'GEO', name: 'Geografi', schedule_codes: ['GEO'] },
  EKO: { code: 'EKO', name: 'Ekonomi', schedule_codes: ['EKO'] },
  SOSIO: { code: 'SOSIO', name: 'Sosiologi', schedule_codes: ['SOS', 'SOSIO'] },
  SJR: { code: 'SJR', name: 'Sejarah', schedule_codes: ['SJR'] },
  IPA: { code: 'IPA', name: 'IPA', schedule_codes: ['IPA', 'FISIKA', 'KIMIA'] },
  BIOLOGI: { code: 'BIOLOGI', name: 'Biologi', schedule_codes: ['BIOLOGI'] },
  INF: { code: 'INF', name: 'Informatika', schedule_codes: ['INF'] },
  TAFSIR: { code: 'TAFSIR', name: 'Tafsir', schedule_codes: ['TAFSIR'] },
  NAHWU: { code: 'NAHWU', name: 'Nahwu', schedule_codes: ['NHW', 'NAHWU'] },
  SHOROF: { code: 'SHOROF', name: 'Shorof', schedule_codes: ['SRF', 'SHOROF'] }
};

// Default ordered subjects per class level matching Madrasah Leger Matrix
const DEFAULT_SUBJECT_CODES_BY_LEVEL = {
  10: ['QH', 'AA', 'FQ', 'SKI', 'PPKN', 'B.INDO', 'B.ARAB', 'MTK', 'B.JAWA', 'B.ING', 'SBK', 'PJOK', 'PKWU', 'GEO', 'EKO', 'SOSIO', 'SJR', 'IPA', 'BIOLOGI', 'INF', 'TAFSIR', 'NAHWU', 'SHOROF'],
  11: ['QH', 'AA', 'FQ', 'SKI', 'PPKN', 'B.INDO', 'B.JAWA', 'B.ARAB', 'MTK', 'B.ING', 'SBK', 'PJOK', 'PKWU', 'GEO', 'EKO', 'SOSIO', 'SJR', 'INF', 'TAFSIR', 'NAHWU', 'SHOROF'],
  12: ['QH', 'AA', 'FQ', 'SKI', 'PPKN', 'B.INDO', 'B.ARAB', 'MTK', 'B.JAWA', 'B.ING', 'SBK', 'PJOK', 'PKWU', 'GEO', 'EKO', 'SOSIO', 'SJR', 'INF', 'TAFSIR', 'NAHWU', 'SHOROF']
};

const DEFAULT_HOMEROOM_BY_LEVEL = {
  10: "Faridatun Ni'mah, S.Pd",
  11: 'Tsurrayya Rochmania, S.E',
  12: 'Muhammad Lutfi, S.Ag'
};

const ASTS_GANJIL_2026_SEED = {
  academic_year_id: '2026/2027',
  assessment_type: 'ASTS_GANJIL',
  semester: 'Ganjil',
  classes: [
    {
      class_id: 'CLS-2627-10',
      level: 10,
      homeroom_name: "Faridatun Ni'mah, S.Pd",
      subjects: DEFAULT_SUBJECT_CODES_BY_LEVEL[10],
      rows: [
        { student_id: 'STD-K10001', name: 'Safiq Nuruddin', scores: [50, 55, 70, 68, 47, 70, 35, 92, 89, 35, 58, 55, 38.5, 35, 55, 45, 52, 54, 70, 50, 40, 60, 95] },
        { student_id: 'STD-K10002', name: 'Muhammad Syaifuddin Abbas', scores: [60, 75, 70, 68, 53, 70, 40, 82, 91, 60, 72, 40, 31, 55, 41.5, 35, 56, 45, 60, 55, 45, 50, 55] },
        { student_id: 'STD-K10003', name: 'Muhammad Abdul Ghani', scores: [55, 10, 54, 52, 49, 0, 50, 40, 86, 75, 20, 50, 30.5, 10, 27, 30, 39, 20, 40, 30, 30, 75, 100] },
        { student_id: 'STD-K10004', name: 'Najib Hilmi', scores: [60, 75, 85, 83, 36, 48, 100, 35, 82, 72.5, 39, 35, 17, 10, 33.5, 43, 51, 30, 30, 60, 50, 100, 100] },
        { student_id: 'STD-K10005', name: 'Athar Rijki Khiar', scores: [70, 90, 80, 78, 63, 76, 95, 52, 89, 82.5, 79, 60, 55, 70, 79, 70, 80, 40, 90, 65, 55, 95, 95] },
        { student_id: 'STD-K10006', name: 'Muhammad Jauhar Alfiansyah', scores: [50, 20, 55, 53, 35, 31, 15, 30, 88, 37.5, 51, 35, 15, 20, 11.5, 29, 19, 20, 25, 60, 50, 35, 55] },
        { student_id: 'STD-K10007', name: 'Mochammad Hisyam Ar Rosyid', scores: [80, 90, 78, 76, 73, 91, 100, 90, 86, 82.5, 65, 70, 72, 25, 74, 49, 75, 40, 82, 75, 60, 95, 95] },
        { student_id: 'STD-K10008', name: 'Muhammad Luthfan Al Qolbi', scores: [50, 65, 66, 64, 57, 78, 95, 70, 89, 42.5, 66, 55, 29, 10, 34.5, 31, 75, 35, 55, 55, 40, 75, 80] },
        { student_id: 'STD-K10009', name: 'Muhamad Haikal Ahsan', scores: [60, 35, 60, 58, 42, 75, 35, 54, 86, 25, 44, 45, 18.5, 20, 10, 46, 46, 25, 35, 60, 55, 60, 80] },
        { student_id: 'STD-K10010', name: "Muhamad Ala'udin", scores: [68, 95, 80, 78, 74, 95, 100, 94, 85, 95, 84, 60, 68, 70, 66, 68, 61, 85, 85, 75, 60, 100, 100] },
        { student_id: 'STD-K10011', name: 'Muhammad Fakhri Naufal', scores: [60, 65, 74, 72, 43, 49, 60, 48, 92, 40, 62, 55, 44, 35, 42, 34, 56, 30, 40, 55, 40, 70, 95] },
        { student_id: 'STD-K10012', name: 'Khoyrul Ahmad Alfaris', scores: [70, 100, 73, 70, 72, 88, 84, 100, 84, 85, 81, 70, 71.5, 55, 77.5, 62, 47, 90, 65, 40, 30, 85, 90] },
        { student_id: 'STD-K10013', name: 'Mohammad Imam Fajar Afandi', scores: [50, 10, 55, 52, 40, 22, 10, 48, 82, 45, 48, 35, 30, 20, 20, 50, 46, 15, 55, 30, 25, 20, 20] },
        { student_id: 'STD-K10014', name: 'Imdad Robbil Chaq', scores: [40, 10, 57, 55, 29, 8, 5, 24, 88, 27.5, 40, 20, 7, 10, 2, 30, 14, 10, 10, 30, 25, 10, 10] },
        { student_id: 'STD-K10015', name: 'Abdul Hamid Al Muthohhar', scores: [60, 75, 70, 68, 53, 71, 77.5, 80, 86, 60, 68, 70, 67.5, 54, 44.5, 40, 65, 75, 75, 60, 55, 90, 90] },
        { student_id: 'STD-K10018', name: 'Muhamad Fathur Rizqi', scores: [60, 70, 75, 72, 46, 52, 92.5, 76, 90, 50, 63, 55, 50, 20, 33, 33, 46, 40, 55, 30, 25, 80, 75] },
        { student_id: 'STD-K10017', name: 'Muhammad Anji Mawali Nasirudin', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K10016', name: 'Mohammad Rohid Falih', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K10019', name: 'Muhammad Habib Akromaniyalhaq', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
      ]
    },
    {
      class_id: 'CLS-2627-11',
      level: 11,
      homeroom_name: 'Tsurrayya Rochmania, S.E',
      subjects: DEFAULT_SUBJECT_CODES_BY_LEVEL[11],
      rows: [
        { student_id: 'STD-K11017', name: 'Adam Maulana', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K11001', name: 'Ahmad Abdul Latif', scores: [65, 75, 78, 76, 71, 56, 90, 81, 96, 95, 77, 65, 72.5, 85, 63.5, 62, 65, 50, 40, 70, 90] },
        { student_id: 'STD-K11002', name: 'Ahmad Kholis', scores: [70, 80, 78, 76, 77, 85, 88, 94, 94, 95, 98, 85, 89.5, 100, 82, 90, 85, 55, 60, 90, 90] },
        { student_id: 'STD-K11003', name: 'Haikal Nurul Sobah', scores: [78, 85, 84, 82, 94, 65, 86, 80, 58, 95, 96, 60, 90.5, 100, 94, 87, 81, 60, 65, 95, 95] },
        { student_id: 'STD-K11018', name: 'Hirzul Fahmil Akbar', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K11004', name: 'Linggar Ahmad Cevaniel Cavy', scores: [58, 65, 66, 64, 78, 0, 83, 65, 20, 95, 66, 90, 44, 65, 45, 62, 70, 35, 40, 55, 85] },
        { student_id: 'STD-K11005', name: 'Moch. Adji Soko Alif Mubarok', scores: [55, 60, 78, 76, 79, 75, 82, 87, 78, 93, 80, 50, 63.5, 65, 56, 78, 65, 40, 45, 67, 75] },
        { student_id: 'STD-K11006', name: 'Mohammad Iqbal Rifqillah', scores: [50, 50, 56, 54, 61, 68, 83, 50, 20, 78, 70, 65, 47, 35, 29.5, 60, 57, 35, 45, 35, 65] },
        { student_id: 'STD-K11008', name: 'Muhamad Mukhlosin', scores: [57, 57.5, 76, 74, 77, 66, 84, 86, 64, 90, 94, 50, 71, 38, 66, 62, 70, 50, 40, 68, 90] },
        { student_id: 'STD-K11009', name: 'Muhammad Danial Tibrizi', scores: [68, 60, 80, 78, 95, 62, 88, 93, 54, 93, 69, 85, 68, 80, 35, 50, 51, 45, 50, 60, 100] },
        { student_id: 'STD-K11010', name: 'Muhammad Dzikri Karim', scores: [70, 60, 78, 76, 0, 60, 90, 93, 62, 93, 79, 50, 74.5, 65, 56, 50, 41, 50, 55, 90, 100] },
        { student_id: 'STD-K11011', name: 'Muhammad Lafif Fazi', scores: [65, 65, 74, 72, 79, 78, 88, 70, 58, 90, 87, 55, 81.5, 75, 91.5, 76, 57, 45, 40, 65, 100] },
        { student_id: 'STD-K11012', name: 'Muhammad Mazza Najbun Naqyy', scores: [68, 72.5, 74, 72, 68, 58, 84, 90, 28, 90, 79, 50, 55, 75, 43.5, 60, 70, 50, 40, 55, 90] },
        { student_id: 'STD-K11013', name: "Muhammad Mu'tasim Billah", scores: [65, 65, 70, 68, 80, 51, 86, 21, 24, 62, 75, 75, 61.5, 50, 29, 69, 65, 35, 30, 55, 75] },
        { student_id: 'STD-K11007', name: 'Muhammad Rifqi Nuristiono', scores: [70, 60, 85, 82, 84, 82, 89, 84, 84, 97, 82, 60, 71, 85, 71.5, 70, 90, 60, 50, 65, 90] },
        { student_id: 'STD-K11014', name: 'Rizky Arga Saputra', scores: [63, 62, 78, 76, 77, 73, 88, 68, 82, 89, 96, 55, 80.5, 90, 72.5, 80, 70, 30, 45, 50, 90] },
        { student_id: 'STD-K11015', name: 'Yaafi Adiyansyah', scores: [59, 50, 70, 68, 49, 53, 87, 50, 50, 78, 91, 35, 68, 70, 59, 78, 46, 30, 35, 60, 90] },
        { student_id: 'STD-K11019', name: 'Muhammad Hasan', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K11021', name: 'Muhammad Muhibbuddin Mathori', scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { student_id: 'STD-K11022', name: 'Maftoh Wahyu Utomo', scores: [53, 47, 70, 68, 92, 34, 84, 25, 54, 80, 67, 40, 71, 85, 58.5, 62, 66, 25, 30, 35, 80] },
        { student_id: 'STD-K11016', name: 'Mochamad Ilham Tamami', scores: [55, 55, 68, 66, 29, 33, 79, 10, 38, 70, 57, 55, 43.5, 55, 42.5, 50, 36, 30, 45, 30, 60] }
      ]
    },
    {
      class_id: 'CLS-2627-12',
      level: 12,
      homeroom_name: 'Muhammad Lutfi, S.Ag',
      subjects: DEFAULT_SUBJECT_CODES_BY_LEVEL[12],
      rows: [
        { student_id: 'STD-K12001', name: 'Ahmad Najibul Fahri', scores: [68, 65, 74, 72, 64, 63, 40, 40, 91, 80, 68, 55, 34.5, 75, 70.5, 60, 66, 50, 35, 45, 90] },
        { student_id: 'STD-K12002', name: 'Minanur Rohman', scores: [65, 70, 78, 76, 68, 64, 66, 25, 90, 85, 72, 85, 48.5, 60, 61.5, 76, 71, 40, 30, 35, 85] },
        { student_id: 'STD-K12003', name: 'Muhammad Ulil Fawaiz', scores: [68, 50, 78, 76, 65, 53, 50, 35, 88, 85, 60, 55, 45.5, 70, 47, 52, 38, 35, 50, 55, 85] },
        { student_id: 'STD-K12004', name: 'Ahmad Roghib Al Qudsy', scores: [70, 90, 82, 80, 84, 76, 90, 66, 92, 90, 86, 90, 64.5, 70, 71.5, 85, 71, 40, 55, 70, 100] },
        { student_id: 'STD-K12005', name: 'M. Setyo Fahmi Firdaus', scores: [59, 25, 70, 68, 54, 32, 30, 18, 81, 80, 51, 70, 30, 20, 41.5, 40, 33, 25, 25, 15, 55] },
        { student_id: 'STD-K12006', name: 'Mohammad Hibbanurrohim Rizq', scores: [65, 45, 78, 76, 60, 76, 39, 66, 88, 89, 63, 50, 66, 65, 73, 50, 47, 35, 40, 60, 90] },
        { student_id: 'STD-K12007', name: "Imam Maulana Sa'adi", scores: [69, 90, 78, 76, 84, 71, 85, 44, 80, 90, 73, 50, 54, 65, 85, 88, 76, 55, 40, 70, 90] }
      ]
    }
  ]
};

module.exports = {
  ASSESSMENT_PERIODS,
  GRADE_SUBJECT_CATALOG,
  DEFAULT_SUBJECT_CODES_BY_LEVEL,
  DEFAULT_HOMEROOM_BY_LEVEL,
  ASTS_GANJIL_2026_SEED
};
