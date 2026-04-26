# Tradevelix — Panduan Penggunaan

## Apa itu Tradevelix?

Tradevelix adalah alat analisis saham IDX yang membantu kamu menemukan pergerakan uang besar (*smart money*) di balik harga saham. Alat ini menggunakan metode **Three Doors** — sebuah cara membaca siapa sesungguhnya yang sedang membeli atau menjual suatu saham.

---

## Glosarium — Istilah yang Perlu Kamu Tahu

| Istilah | Artinya |
|---|---|
| **Whale / Bandar** | Investor besar (institusi, konglomerat, atau pemegang saham mayoritas) yang bisa menggerakkan harga. Kebalikan dari retail. |
| **Retail** | Investor kecil-kecilan, termasuk kebanyakan trader individual. Sering jadi "korban" ketika bandar sudah mengumpulkan saham. |
| **Akumulasi** | Bandar diam-diam membeli banyak saham, biasanya ketika harga sedang turun atau sideways. Tanda: retail panik jual, bandar justru serap. |
| **Distribusi** | Bandar mulai jual ke pasar setelah harga naik. Tanda: retail baru masuk euforia, bandar keluar pelan-pelan. |
| **Broker / Sekuritas** | Perantara jual-beli saham. Di IDX setiap transaksi tercatat atas nama broker, sehingga bisa dilihat siapa yang beli/jual banyak. |
| **Lot** | Satuan saham IDX. 1 lot = 100 lembar saham. |
| **Bandar Floor** | Rata-rata harga beli *weighted* semua whale broker. Ini adalah "harga pokok" bandar — biasanya jadi support kuat. |
| **VPA (Volume Price Analysis)** | Analisis keselarasan volume dengan arah harga. Volume besar naik = konfirmasi. Volume besar turun = distribusi. |
| **Kekompakan** | Seberapa kompak whale broker bergerak ke satu arah. Makin tinggi, makin banyak institusi yang sepakat. |
| **Retail Exit %** | Persentase retail yang sudah jual. Tinggi berarti retail sudah kabur — biasanya bandar yang serap. |
| **T1 / T2** | Target harga. T1 = +12% dari entry, T2 = +25% dari entry. |
| **Stop Loss** | Batas kerugian maksimum. Jika harga turun sampai sini, keluar posisi. |
| **SID** | Single Investor Identification — jumlah investor individu yang pegang suatu saham. Makin banyak = lebih liquid tapi mungkin sudah ramai. |
| **YTD** | Year to Date — dari 1 Januari sampai hari ini. Data broker di Tradevelix dihitung YTD. |
| **Pump & Dump** | Pola manipulasi: harga naik cepat karena bandar mau jual ke retail yang ikut FOMO. Tanda bahaya. |

---

## Metode Three Doors

Three Doors bukan indikator mingguan biasa. Ia mendeteksi **perubahan perilaku** — ketika broker tertentu tiba-tiba muncul dengan transaksi ukuran besar, itu sinyal uang besar bergerak.

```
PINTU 1 — SIAPA?
Broker mana yang sedang akumulasi besar-besaran?
Apakah itu broker milik pemegang saham pengendali?

         ↓

PINTU 2 — APA?
Apakah retail sedang keluar (exit)?
Apakah VPA mengkonfirmasi arah naik?

         ↓

PINTU 3 — KOORDINASI?
Apakah beberapa whale broker bergerak ke arah yang sama?
(Kekompakan ≥70% = institusi kompak)

         ↓

SINYAL FINAL
```

---

## Cara Pakai: Langkah demi Langkah

### Langkah 1: Buka Dashboard

Buka `http://43.134.173.106` → Login → **Dashboard**

Kamu akan melihat daftar 24 saham IDX, diurutkan dari sinyal terkuat.

**Cara baca tabel:**

| Kolom | Artinya | Yang dicari |
|---|---|---|
| Signal | Kekuatan sinyal keseluruhan | STRONG BUY atau BUY |
| Whale Net | Total lot yang dibeli minus dijual oleh whale broker | Angka besar positif |
| Retail Exit % | Berapa persen retail sudah jual | Di atas 50% |
| Vs Floor | Jarak harga ke bandar floor | Angka negatif atau dekat 0 (berarti harga di zona beli) |
| Broker chips | Kode broker whale aktif | — |

**Badge khusus:**
- `⚠ PUMP` — Ada tanda manipulasi. Hati-hati atau skip.
- `▲ AKUMULASI` — API konfirmasi pola akumulasi
- `▼ DISTRIBUSI` — Bandar mulai jual

---

### Langkah 2: Buka Detail Saham

Klik saham yang menarik. Halaman ini menampilkan **bukti lengkap** di balik sinyal.

#### Kartu Bukti (klik untuk buka)

**🐋 Whale Net — Pintu 1**
- Lihat kode broker yang muncul
- Scroll ke bawah ke panel **"5%+ Shareholders"**
- Cocokkan kode broker dengan broker milik pemegang saham pengendali
- **Contoh**: BUVA menampilkan `YU` beli banyak → YU = CGS International = broker pemegang saham 61% → SINYAL SANGAT KUAT

**📊 Retail Exit — Pintu 2 (bagian 1)**
- Lihat siapa yang jual: YP (Mirae), XL (Stockbit), PD (Indo Premier)
- Ini adalah broker retail populer → kalau mereka jual banyak, retail sedang panik keluar

**🤝 Kekompakan — Pintu 3**
- Skor ≥70%: banyak institusi sepakat → sinyal kuat
- Skor 40–70%: ada yang beda pendapat → moderat
- Skor <40%: hanya satu pemain besar → bisa rebalancing biasa, bukan sinyal akumulasi sejati

**🎯 Vs Floor**
- Harga di bawah floor (angka negatif) = zona beli terbaik
- Harga 0–10% di atas floor = masih aman
- Harga >20% di atas floor = sudah jauh dari zona aman, risk/reward memburuk

#### Grafik Harga (1M / 3M / Max)
- Pilih **Max** untuk lihat gambaran YTD penuh
- **Band hijau** = entry zone ideal (dari data akumulasi API)
- Pastikan harga mendekati atau berada di dalam entry zone

#### Grafik 8-Week Trend (bawah halaman)
- **Bar naik hijau** = whale sedang beli bulan itu
- **Bar merah** = whale sedang jual
- Cari pola: bar meningkat terus selama beberapa bulan = akumulasi konsisten

#### Panel "5%+ Shareholders" (paling bawah)
- Menampilkan pemegang saham pengendali + broker yang mereka gunakan
- Ini adalah "key decoder" Three Doors — ketika kamu tahu `CC` adalah broker yang dipakai Indika Inti Investindo (37.79% INDY), dan `CC` muncul sebagai whale beli INDY → itu konglomerat sendiri yang akumulasi

---

### Langkah 3: Cek Inventory Chart (`/broker-flow`)

Masuk dari sidebar: **Inventory**

Ketik ticker → set tanggal → klik **Go**

**Cara baca:**
- Garis naik = broker itu terus beli dari bulan ke bulan
- Garis sideways = broker beli-jual seimbang, tidak ada tren
- Garis turun = broker sedang distribusi
- Candlestick menunjukkan harga saham di periode yang sama

**Apa yang dicari:**
- Garis whale naik, tapi harga justru turun atau sideways → **divergensi positif** = bandar kumpulkan di harga murah, potensi breakout ke atas
- Garis whale turun, tapi harga masih naik → bandar sudah mulai keluar, hati-hati

---

### Langkah 4: Cek Sinyal (`/signals`)

Halaman ini menampilkan rekomendasi masuk dengan parameter lengkap.

```
Entry Price: harga ideal untuk masuk
Stop Loss:   keluar jika harga turun sampai sini (kerugian ~5–8%)
T1:          target pertama +12%
T2:          target kedua   +25%
```

**Progress bar** menunjukkan posisi harga saat ini di antara stop dan T2.

---

### Langkah 5: Cek Backtest (`/backtest`)

Sebelum masuk posisi, kamu bisa lihat histori sinyal serupa:
- Set tanggal dari Januari 2026
- Lihat Win Rate — apakah Three Doors bekerja pada saham ini sebelumnya?
- Lihat T2 Hit Rate — seberapa sering mencapai target +25%?

---

## Checklist Sebelum Entry

Centang minimal 4 dari 6:

- [ ] Sinyal STRONG BUY atau BUY dengan confidence ≥70%
- [ ] Retail Exit ≥50%
- [ ] Kekompakan ≥60%
- [ ] Harga di bawah atau dekat bandar floor (Vs Floor ≤+10%)
- [ ] Broker whale = broker milik pemegang saham pengendali
- [ ] Inventory chart: garis whale naik selama 2+ bulan
- [ ] Tidak ada `⚠ PUMP` badge
- [ ] Major Holder Disclosure tidak menunjukkan penjualan besar baru-baru ini

---

## Tingkat Keyakinan

| Kondisi | Keyakinan | Yang dilakukan |
|---|---|---|
| Semua 6 terpenuhi + broker = pengendali | Sangat Tinggi | Posisi penuh sesuai rencana |
| 4–5 terpenuhi, broker pengendali tidak teridentifikasi | Tinggi | 70% dari rencana posisi |
| 3 terpenuhi, kekompakan rendah | Sedang | 40–50%, tambah jika minggu depan konfirmasi |
| Kurang dari 3 | Rendah | Watch saja, jangan masuk |
| Ada `⚠ PUMP` | Apapun sinyalnya | Kurangi ukuran 50% atau skip |
| Ada penjualan oleh pemegang saham pengendali (disclosure) | Apapun sinyalnya | Skip, tunggu siklus berikutnya |

---

## Data Diperbarui Kapan?

| Data | Jadwal |
|---|---|
| Harga (OHLCV, foreign flow) | Otomatis, Senin–Jumat pukul 18.00 WIB |
| Analisis broker + sinyal Three Doors | Otomatis, setiap Sabtu pukul 10.00 WIB |
| Disclosure pemegang saham (IDX/KSEI) | Otomatis, setiap Sabtu |

**Refresh manual**: Admin → tab System → klik sync yang diinginkan → lalu "Recalculate"

---

## Pertanyaan Umum

**Kenapa sinyal bisa berubah minggu ke minggu?**  
Data broker diperbarui YTD setiap minggu. Jika bulan ini whale berbalik jual setelah akumulasi panjang, sinyalnya berubah jadi SELL. Ini normal — justru menunjukkan sistem bekerja.

**Apakah Tradevelix memberikan sinyal beli/jual yang pasti?**  
Tidak. Tradevelix adalah alat analisis, bukan rekomendasi investasi. Semua keputusan ada di tanganmu. Gunakan sebagai konfirmasi, bukan sebagai oracle.

**Kenapa ada saham dengan confidence 100% tapi tidak masuk watchlist saya?**  
Confidence 100% berarti semua yang tersedia di data itu konsisten. Tapi kalau datanya tipis (retail exit rendah, kekompakan rendah), confidence tinggi bisa saja dari data yang belum cukup. Selalu cek manual.

**Apa artinya "bandar floor" lebih tinggi dari harga sekarang?**  
Artinya harga saham saat ini berada DI BAWAH rata-rata harga beli bandar. Secara teori, bandar tidak akan senang biarkan harga jauh di bawah modalnya. Sering jadi zona support kuat — dan zona beli terbaik.
