/**
 * Tipe data inti OSCE Harian Interaktif.
 * Skema impor didokumentasikan di docs/FORMAT-BANK.md.
 */

export const SCHEMA_VERSION = 1;

export interface ChecklistItem {
  /** ID unik di dalam stasiun, mis. "c1". */
  id: string;
  text: string;
  /** Bobot eksplisit; default 1 bila bank tidak menetapkan. */
  weight: number;
}

export interface AssetRef {
  /** Path relatif di dalam paket ZIP, mis. "assets/trauma-001/ap.jpg". Tidak pernah ditampilkan ke peserta. */
  path: string;
  /** Label netral yang boleh terlihat sebelum review, mis. "AP", "Lateral", "MRI T2 sagital". */
  label: string;
  modality?: string;
  /** Keterangan yang mungkin mengungkap diagnosis — hanya tampil saat review. */
  caption?: string;
  /** Diisi importer: kunci isi (SHA-256) blob di IndexedDB. */
  blobKey?: string;
  mime?: string;
}

export interface CaseSource {
  /** Nama dokumen sumber, persis seperti nama file/dokumen aslinya. */
  document: string;
  scenario?: string;
  page?: string;
  url?: string;
  /** true bila vignette diparafrasekan dari sumber. */
  paraphrased?: boolean;
  note?: string;
}

export interface DiscussionSection {
  heading: string;
  body: string;
}

export interface Station {
  id: string;
  topic: string;
  /** Judul netral — tidak boleh membocorkan diagnosis. */
  title: string;
  vignette: string;
  clinicalQuestion: string;
  followupQuestion: string;
  /** Informasi lanjutan berbasis teks (hasil lab, temuan tambahan) yang dibuka di tahap 2. */
  followupInfo?: string;
  imagingRequired: boolean;
  assets: AssetRef[];
  key: { clinical: string; followup: string };
  discussion: DiscussionSection[];
  checklist: { clinical: ChecklistItem[]; followup: ChecklistItem[] };
  source: CaseSource;
  /** true untuk kasus demo sintetis — tidak pernah masuk paket berbasis sumber. */
  demo: boolean;
}

/** Stasiun di bank lokal beserta status kelayakan dari validasi. */
export interface BankStation extends Station {
  eligible: boolean;
  /** Alasan stasiun belum layak masuk paket (mis. aset wajib hilang). */
  issues: string[];
  importedAt: string;
  bankName: string;
}

export type Stage = 'clinical' | 'followup' | 'review';

export interface StationProgress {
  stationId: string;
  stage: Stage;
  draftClinical: string;
  draftFollowup: string;
  answerClinical?: string;
  answerFollowup?: string;
  submittedClinicalAt?: string;
  submittedFollowupAt?: string;
  /** Butir checklist yang dicentang: key = "clinical:c1" / "followup:f2". */
  checked: Record<string, boolean>;
  reviewedAt?: string;
}

export type SessionKind = 'source' | 'demo';

export interface Session {
  /** "source:2026-11-25" atau "demo:2026-11-25". */
  id: string;
  kind: SessionKind;
  /** Tanggal siklus (YYYY-MM-DD, WITA). */
  cycleDate: string;
  createdAt: string;
  updatedAt: string;
  targetSize: number;
  /** Snapshot stasiun saat sesi dibuat — impor bank baru tidak mengubahnya. */
  stations: Station[];
  progress: Record<string, StationProgress>;
  currentIndex: number;
  /** Jumlah stasiun layak di bank saat sesi dibuat (untuk informasi). */
  eligibleAtCreation: number;
}

export interface ImportReport {
  bankName: string;
  accepted: { id: string; eligible: boolean; issues: string[] }[];
  rejected: { id: string; reasons: string[] }[];
  errors: string[];
}
