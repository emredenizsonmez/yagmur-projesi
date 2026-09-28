const fs = require('fs');
const path = require('path');
const { ayarlar, jetonOlustur, KLASOR } = require('./yardimci.js');

const sehirler = JSON.parse(fs.readFileSync(path.join(KLASOR, 'cities.json'), 'utf-8'));

const DATA_KLASORU = path.join(KLASOR, 'data');
const RAW_KLASORU = path.join(DATA_KLASORU, 'raw');
const RAW_DAKIKALIK_KLASORU = path.join(DATA_KLASORU, 'raw-dakikalik');
const CSV_DOSYASI = path.join(DATA_KLASORU, 'kayitlar.csv');
const DAKIKALIK_CSV_DOSYASI = path.join(DATA_KLASORU, 'kayitlar_dakikalik.csv');
const DURUM_DOSYASI = path.join(DATA_KLASORU, 'owm-durum.json');

if (!fs.existsSync(DATA_KLASORU)) fs.mkdirSync(DATA_KLASORU);
if (!fs.existsSync(RAW_KLASORU)) fs.mkdirSync(RAW_KLASORU);
if (!fs.existsSync(RAW_DAKIKALIK_KLASORU)) fs.mkdirSync(RAW_DAKIKALIK_KLASORU);
if (!fs.existsSync(CSV_DOSYASI)) {
  fs.writeFileSync(CSV_DOSYASI, 'zaman,sehir,tur,hedef_saat,kalan_dk,olasilik,durum\n');
}
if (!fs.existsSync(DAKIKALIK_CSV_DOSYASI)) {
  fs.writeFileSync(
    DAKIKALIK_CSV_DOSYASI,
    'zaman,sehir,hedef_saat,ilk_yagmur_dk,60dk_toplam_mm,en_yogun_dk_mm,durum\n'
  );
}
if (!fs.existsSync(DURUM_DOSYASI)) {
  fs.writeFileSync(DURUM_DOSYASI, '{}');
}

const TURKCE_TUR = {
  rain: 'yagmur',
  snow: 'kar',
  sleet: 'sulu kar',
  hail: 'dolu',
  mixed: 'karisik',
  clear: 'yok',
};

function owmDurumOku() {
  try {
    return JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf-8'));
  } catch {
    return {};
  }
}

function owmDurumYaz(durum) {
  fs.writeFileSync(DURUM_DOSYASI, JSON.stringify(durum, null, 2));
}

// Yagmur, WeatherKit'e gore YAKINLASMA esigine (varsayilan 60 dk) girdiginde
// OpenWeatherMap'in dakikalik verisini TEK SEFER cekip ozetler.
// Ayni olay (ayni hedef saat) icin tekrar tekrar sorgu atmamak icin
// data/owm-durum.json dosyasinda "bu sehir icin en son hangi hedef saat sorgulandi" bilgisini tutar.
async function openWeatherKontrolEt(sehir, bulunan, zamanDamgasi, kalanDk) {
  const apiAnahtari = process.env.OPENWEATHER_API_KEY;
  if (!apiAnahtari) {
    console.log(`[${sehir.name}] OPENWEATHER_API_KEY tanimli degil, dakikalik kontrol atlaniyor.`);
    return;
  }

  const durum = owmDurumOku();
  const sonSorgulananHedef = durum[sehir.name];

  if (sonSorgulananHedef === bulunan.forecastStart) {
    console.log(`[${sehir.name}] Bu olay (${bulunan.forecastStart}) icin dakikalik veri zaten alinmisti, tekrar sorgulanmiyor.`);
    return;
  }

  console.log(`[${sehir.name}] Yagis ${kalanDk} dk sonraya girdi, OpenWeatherMap'ten dakikalik veri aliniyor...`);

  // Not: OpenWeatherMap "One Call API 3.0"u kullanimdan kaldirip yerine
  // "One Call API 4.0" ile ayri, sade bir "1 dakikalik zaman cizelgesi" endpoint'i getirdi.
  // Asagidaki adres o yeni endpoint.
  const url = `https://api.openweathermap.org/data/4.0/onecall/timeline/1min?lat=${sehir.lat}&lon=${sehir.lon}&units=metric&appid=${apiAnahtari}`;

  let yanit;
  try {
    yanit = await fetch(url);
  } catch (err) {
    console.error(`[${sehir.name}] OpenWeatherMap istegi basarisiz:`, err.message);
    fs.appendFileSync(DAKIKALIK_CSV_DOSYASI, `${zamanDamgasi},${sehir.name},${bulunan.forecastStart},,,,AG-HATASI\n`);
    return;
  }

  if (!yanit.ok) {
    const hataMetni = await yanit.text();
    console.error(`[${sehir.name}] OpenWeatherMap HATA (${yanit.status}): ${hataMetni.slice(0, 200)}`);
    fs.appendFileSync(DAKIKALIK_CSV_DOSYASI, `${zamanDamgasi},${sehir.name},${bulunan.forecastStart},,,,HATA-${yanit.status}\n`);
    return;
  }

  const veri = await yanit.json();
  fs.writeFileSync(
    path.join(RAW_DAKIKALIK_KLASORU, `${zamanDamgasi.replace(/[:.]/g, '-')}_${sehir.name}.json`),
    JSON.stringify(veri, null, 2)
  );

  // 4.0'in yanit sekli dokumantasyonda tam netlesmedigi icin birden fazla
  // olasi sekli deniyoruz; hangisi tutarsa onu kullaniyoruz. Ilk gercek
  // veri geldiginde data/raw-dakikalik/ altindaki dosyaya bakip gerekirse
  // burayi kesinlestirecegiz.
  const dakikalar = Array.isArray(veri?.data)
    ? veri.data
    : Array.isArray(veri)
    ? veri
    : Array.isArray(veri?.minutely)
    ? veri.minutely
    : [];

  if (dakikalar.length === 0) {
    console.warn(`[${sehir.name}] OpenWeatherMap yanitinin sekli beklenenden farkli olabilir, hicbir dakikalik kayit okunamadi. Ham yaniti data/raw-dakikalik/ klasorunde kontrol et.`);
  } else {
    // Hata ayiklama icin: ilk birkac dakikanin ham degerlerini logla, boylece
    // "0mm" ciktisinin gercek bir tahmin mi yoksa bir okuma sorunu mu oldugunu
    // Actions log'undan geriye donuk kontrol edebiliriz.
    console.log(`[${sehir.name}] OWM ham ornek (ilk 3 dk): ${JSON.stringify(dakikalar.slice(0, 3))}`);
  }

  let ilkYagmurDk = null;
  let toplamMm = 0;
  let enYogunMm = 0;
  const simdiSaniye = Math.floor(Date.now() / 1000);

  for (const dk of dakikalar) {
    const gecenDk = Math.round((dk.dt - simdiSaniye) / 60);
    const mm = dk.precipitation || 0;
    toplamMm += mm;
    if (mm > enYogunMm) enYogunMm = mm;
    if (mm > 0 && ilkYagmurDk === null) ilkYagmurDk = gecenDk;
  }

  console.log(
    `[${sehir.name}] Dakikalik veri: ${dakikalar.length} dk, ilk yagmur ${ilkYagmurDk === null ? 'onumuzdeki 60 dk icinde yok' : ilkYagmurDk + ' dk sonra'}, 60dk toplam ${toplamMm.toFixed(2)}mm, en yogun dk ${enYogunMm.toFixed(2)}mm/sa`
  );

  fs.appendFileSync(
    DAKIKALIK_CSV_DOSYASI,
    `${zamanDamgasi},${sehir.name},${bulunan.forecastStart},${ilkYagmurDk === null ? '' : ilkYagmurDk},${toplamMm.toFixed(2)},${enYogunMm.toFixed(2)},ok\n`
  );

  durum[sehir.name] = bulunan.forecastStart;
  owmDurumYaz(durum);
}

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

  // WeatherKit'in kendi "su anki hava durumu" verisi (dataSets=currentWeather ile
  // zaten cekiliyordu ama simdiye kadar hic kullanilmiyordu). Bu, "60 dk icinde
  // yagmur geliyor" tahmininden FARKLI ve daha dogrudan bir sinyal: "su an
  // gercekten yagiyor mu" sorusuna WeatherKit'in kendi cevabi.
  const anlik = veri.currentWeather;
  const anlikYagisSiddeti = anlik?.precipitationIntensity || 0;
  const anlikYagiyorMu = anlikYagisSiddeti > 0 && anlik?.conditionCode !== 'Clear' && anlik?.conditionCode !== 'MostlyClear';

  // Icinde bulundugumuz saati veya gelecekteki ilk uygun saati bul.
  // ONEMLI DUZELTME: eskiden bir saatin BASLANGICI gecince o saat tamamen
  // atlaniyordu - yani tam o saatin ortasinda (yagmur gercekten yagarken)
  // sistem bir sonraki saate zipliyordu ve "su an yagiyor" hic yakalanmiyordu.
  // Simdi bir saat, BITENE kadar (baslangic + 60 dk) listede tutuluyor.
  let bulunan = null;
  for (const saat of saatler) {
    const baslangic = new Date(saat.forecastStart);
    const bitis = new Date(baslangic.getTime() + 60 * 60 * 1000);
    if (bitis <= simdi) continue;
    if (saat.precipitationChance >= ayarlar.YAGMUR_ESIK_ORANI && saat.precipitationType !== 'clear') {
      bulunan = saat;
      break;
    }
  }

  if (anlikYagiyorMu) {
    const turAdi = TURKCE_TUR[bulunan?.precipitationType] || anlik.conditionCode || 'yagis';
    console.log(`[${sehir.name}] SU AN YAGIS VAR (WeatherKit anlik veri): ${turAdi}, siddet=${anlikYagisSiddeti}mm/sa, conditionCode=${anlik.conditionCode}`);
    fs.appendFileSync(
      CSV_DOSYASI,
      `${zamanDamgasi},${sehir.name},${bulunan?.precipitationType || anlik.conditionCode},${zamanDamgasi},0,${bulunan?.precipitationChance ?? 1},YAGIYOR-SIMDI\n`
    );
    // Dedup icin bu saatin basini (ornek: 20:00, 21:00) kullaniyoruz, boylece
    // ayni saat icinde tekrar tekrar OpenWeatherMap'e gidilmiyor ama saat
    // degisince (yagmur devam ediyorsa) taze bir dakikalik veri aliniyor.
    const saatBasi = new Date(simdi);
    saatBasi.setUTCMinutes(0, 0, 0);
    try {
      await openWeatherKontrolEt(sehir, { forecastStart: saatBasi.toISOString() }, zamanDamgasi, 0);
    } catch (err) {
      console.error(`[${sehir.name}] OpenWeatherMap kontrolu sirasinda beklenmeyen hata:`, err.message);
    }
  }

  if (!bulunan) {
    if (!anlikYagiyorMu) {
      console.log(`[${sehir.name}] Onumuzdeki saatlerde yagis beklenmiyor.`);
      fs.appendFileSync(CSV_DOSYASI, `${zamanDamgasi},${sehir.name},,,,,beklenmiyor\n`);
    }
    return;
  }

  const hedefZaman = new Date(bulunan.forecastStart);
  const kalanDk = Math.max(0, Math.round((hedefZaman - simdi) / 60000));
  const saatStr = Math.floor(kalanDk / 60);
  const dakikaStr = kalanDk % 60;
  const turAdi = TURKCE_TUR[bulunan.precipitationType] || bulunan.precipitationType;

  console.log(`[${sehir.name}] ${turAdi.toUpperCase()} bekleniyor: ${hedefZaman.toLocaleString('tr-TR')} (~${saatStr} saat ${dakikaStr} dk sonra), olasilik %${Math.round(bulunan.precipitationChance * 100)}, yogunluk(yagmur)=${bulunan.precipitationIntensity}, yogunluk(kar)=${bulunan.snowfallIntensity}`);

  fs.appendFileSync(
    CSV_DOSYASI,
    `${zamanDamgasi},${sehir.name},${bulunan.precipitationType},${bulunan.forecastStart},${kalanDk},${bulunan.precipitationChance},bekleniyor\n`
  );

  if (kalanDk <= ayarlar.OPENWEATHER_YAKINLASMA_ESIK_DK && !anlikYagiyorMu) {
    try {
      await openWeatherKontrolEt(sehir, bulunan, zamanDamgasi, kalanDk);
    } catch (err) {
      console.error(`[${sehir.name}] OpenWeatherMap kontrolu sirasinda beklenmeyen hata:`, err.message);
    }
  }
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
