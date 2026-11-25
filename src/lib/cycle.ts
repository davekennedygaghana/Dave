/**
 * Siklus paket harian: paket baru tersedia pukul 09.00 WITA (Asia/Makassar, UTC+8, tanpa DST).
 * Sebelum 09.00 WITA, tanggal siklus = tanggal kemarin.
 * Dihitung setiap kali aplikasi dibuka — tidak bergantung aplikasi aktif tepat pukul 09.00.
 */
export const WITA_OFFSET_MINUTES = 8 * 60;
export const RELEASE_HOUR_WITA = 9;

export function cycleDateFor(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + (WITA_OFFSET_MINUTES - RELEASE_HOUR_WITA * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Waktu (UTC) saat siklus berikutnya dimulai. */
export function nextCycleStart(now: Date = new Date()): Date {
  const date = cycleDateFor(now);
  const [y, m, d] = date.split('-').map(Number);
  // 09.00 WITA = 01.00 UTC pada tanggal yang sama.
  return new Date(Date.UTC(y, m - 1, d + 1, RELEASE_HOUR_WITA - WITA_OFFSET_MINUTES / 60, 0, 0));
}

export function formatCycleDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatWita(dt: Date): string {
  const shifted = new Date(dt.getTime() + WITA_OFFSET_MINUTES * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}.${mm} WITA`;
}
