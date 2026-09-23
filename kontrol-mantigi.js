const fs = require('fs');
const path = require('path');
const { ayarlar, jetonOlustur, KLASOR } = require('./yardimci.js');

const sehirler = JSON.parse(fs.readFileSync(path.join(KLASOR, 'cities.json'), 'utf-8'));

const DATA_KLASORU = path.join(KLASOR, 'data');
const RAW_KLASORU = path.join(DATA_KLASORU, 'raw');
const CSV_DOSYASI = path.join(DATA_KLASORU, 'kayitlar.csv');

if (!fs.existsSync(DATA_KLASORU)) fs.mkdirSync(DATA_KLASORU);
if (!fs.existsSync(RAW_KLASORU)) fs.mkdirSync(RAW_KLASORU);
if (!fs.existsSync(CSV_DOSYASI)) {
  fs.writeFileSync(CSV_DOSYASI, 'zaman,sehir,tur,hedef_saat,kalan_dk,olasilik,durum\n');
}

const TURKCE_TUR = {
  rain: 'yagmur',
  snow: 'kar',
  sleet: 'sulu kar',
  hail: 'dolu',
  mixed: 'karisik',
  clear: 'yok',
};

async function sehirIcinKontrolEt(sehir, jeton) {
  const url = `https://weatherkit.apple.com/api/v1/weather/tr/${sehir.lat}/${sehir.lon}?dataSets=currentWeather,forecastHourly&timezone=Europe/Istanbul`;
  const yanit = await fetch(url, { headers: { Authorization: `Bearer ${jeton}` } });
  const zamanDamgasi = new Date().toISOString();

  if (!yanit.ok) {
    const hataMetni = await yanit.text();
    console.error(`[${sehir.name}] HATA (${yanit.status}): ${hataMetni.slice(0, 200)}`);
    fs.appendFileSync(CSV_DOSYASI, `${zamanDamgasi},${sehir.name},,,,,HATA-${yanit.status}\n`);
    return;
  }

  const veri = await yanit.json();
  fs.writeFileSync(
    path.join(RAW_KLASORU, `${zamanDamgasi.replace(/[:.]/g, '-')}_${sehir.name}.json`),
    JSON.stringify(veri, null, 2)
  );

  const saatler = veri.forecastHourly?.hours || [];
  const simdi = new Date();

  let bulunan = null;
  for (const saat of saatler) {
    const baslangic = new Date(saat.forecastStart);
    if (baslangic < simdi) continue;
    if (saat.precipitationChance >= ayarlar.YAGMUR_ESIK_ORANI && saat.precipitationType !== 'clear') {
      bulunan = saat;
      break;
    }
  }

  if (!bulunan) {
    console.log(`[${sehir.name}] Onumuzdeki saatlerde yagis beklenmiyor.`);
    fs.appendFileSync(CSV_DOSYASI, `${zamanDamgasi},${sehir.name},,,,,beklenmiyor\n`);
    return;
  }

  const hedefZaman = new Date(bulunan.forecastStart);
  const kalanDk = Math.round((hedefZaman - simdi) / 60000);
  const saatStr = Math.floor(kalanDk / 60);
  const dakikaStr = kalanDk % 60;
  const turAdi = TURKCE_TUR[bulunan.precipitationType] || bulunan.precipitationType;

  console.log(`[${sehir.name}] ${turAdi.toUpperCase()} bekleniyor: ${hedefZaman.toLocaleString('tr-TR')} (~${saatStr} saat ${dakikaStr} dk sonra), olasilik %${Math.round(bulunan.precipitationChance * 100)}, yogunluk(yagmur)=${bulunan.precipitationIntensity}, yogunluk(kar)=${bulunan.snowfallIntensity}`);

  fs.appendFileSync(
    CSV_DOSYASI,
    `${zamanDamgasi},${sehir.name},${bulunan.precipitationType},${bulunan.forecastStart},${kalanDk},${bulunan.precipitationChance},bekleniyor\n`
  );
}

async function tumSehirleriKontrolEt() {
  console.log(`\n--- Kontrol: ${new Date().toLocaleString('tr-TR')} ---`);
  const jeton = jetonOlustur();
  for (const sehir of sehirler) {
    try {
      await sehirIcinKontrolEt(sehir, jeton);
    } catch (err) {
      console.error(`[${sehir.name}] Beklenmeyen hata:`, err.message);
    }
  }
  console.log('--- Bitti ---\n');
}

module.exports = { tumSehirleriKontrolEt };
