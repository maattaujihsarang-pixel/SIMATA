/**
 * SIMATA - Indonesian Currency Number to Words (Terbilang)
 */

function terbilangAngka(n) {
  const bilangan = [
    '', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima',
    'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'
  ];

  const num = Math.floor(n);
  if (num < 12) {
    return bilangan[num];
  } else if (num < 20) {
    return `${terbilangAngka(num - 10)} Belas`;
  } else if (num < 100) {
    return `${terbilangAngka(Math.floor(num / 10))} Puluh ${bilangan[num % 10]}`.trim();
  } else if (num < 200) {
    return `Seratus ${terbilangAngka(num - 100)}`.trim();
  } else if (num < 1000) {
    return `${terbilangAngka(Math.floor(num / 100))} Ratus ${terbilangAngka(num % 100)}`.trim();
  } else if (num < 2000) {
    return `Seribu ${terbilangAngka(num - 1000)}`.trim();
  } else if (num < 1000000) {
    return `${terbilangAngka(Math.floor(num / 1000))} Ribu ${terbilangAngka(num % 1000)}`.trim();
  } else if (num < 1000000000) {
    return `${terbilangAngka(Math.floor(num / 1000000))} Juta ${terbilangAngka(num % 1000000)}`.trim();
  } else if (num < 1000000000000) {
    return `${terbilangAngka(Math.floor(num / 1000000000))} Milyar ${terbilangAngka(num % 1000000000)}`.trim();
  } else {
    return `${terbilangAngka(Math.floor(num / 1000000000000))} Triliun ${terbilangAngka(num % 1000000000000)}`.trim();
  }
}

function terbilangRupiah(amount) {
  const num = Number(amount);
  if (isNaN(num) || num <= 0) return 'Nol Rupiah';
  return `${terbilangAngka(num)} Rupiah`;
}

module.exports = {
  terbilangAngka,
  terbilangRupiah
};
