# Code Trail - Kapsamli Proje Analiz Dokumani

## 1. Genel Bakis

**Code Trail**, yerel makinede calisan bir Electron masaustu uygulamasidir. AI kodlama asistanlarinin (Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code Copilot) urettigi konusma gecmisini kesfeder, indeksler, aranabilir hale getirir ve tek bir arayuzden goruntulemeye olanak tanir.

**Temel prensip:** Tum veriler yerel kalir -- hicbir veri makineyi terk etmez, hicbir AI API'si cagirilmaz.

| Ozellik | Deger |
|---|---|
| Versiyon | 0.1.0 |
| Lisans | MIT (2026 Code Trail Contributors) |
| Runtime | Electron 35, Node >=20 <24 |
| Paket Yoneticisi | Bun >=1.1 |
| Monorepo Yapisi | Bun Workspaces |
| Kaynak | github.com/mdemirhan/codetrail |

---

## 2. Desteklenen AI Saglayicilar

| Saglayici | Kaynak Formati | Kesfedilen Dizin | Ozellikler |
|---|---|---|---|
| Claude Code | JSONL stream | `~/.claude/projects/` | Artirimli checkpoint, subagent destegi, Claude hooks entegrasyonu, worktree algilama |
| Codex CLI | JSONL stream | `~/.codex/sessions/` | Fork/lineage destegi, worktree algilama |
| Gemini CLI | Materialized JSON | `~/.gemini/tmp/`, `~/.gemini/history/` | SHA-256 hash tabanli proje cozumlemesi (`projects.json` + `.project_root` sentinel) |
| Cursor | JSONL stream | `~/.cursor/projects/` | Standart oturum kesfetme |
| VS Code Copilot | Materialized JSON | `.../Code/User/workspaceStorage/*/chatSessions/` | Standart oturum kesfetme |

### Saglayici Adapter Deseni

Her saglayici `ProviderAdapter` arayuzunu uygular. Iki format izlegi vardir:

- **JSONL Stream** (Claude, Codex, Cursor): Satirlari byte-offset checkpoint'leri ile artirimli olarak okur
- **Materialized JSON** (Gemini, Copilot): Dosyayi tamamen okur, zaman damgasi normalestirmesi uygular

Saglayici kayit defteri (`packages/core/src/providers/registry.ts`) tum adapterleri merkezi olarak yonetir.

### Oversized Icerik Yonetimi

Buyuk JSONL dosyalari icin 3 katmanli bir strateji uygulanir:

| Katman | Esik | Davranis |
|---|---|---|
| Normal | <8 MB | Tam indeksleme |
| Kurtarma | 8-32 MB | Medya/base64 icerik temizleme ile indeksleme |
| Red | >32 MB | Dosya atlanir (hard omission) |

Her saglayicinin kendi oversized handler'i vardir (`packages/core/src/providers/oversized/`): Claude ve Codex icin ozel temizleme, ortak paylasilan yardimci fonksiyonlar.

---

## 3. Teknoloji Stack'i

| Katman | Teknoloji | Versiyon |
|---|---|---|
| Framework | Electron | 35.0.0 |
| UI | React + TypeScript (strict mod) | 19.0.0 |
| Veritabani | better-sqlite3 (FTS5 + WAL modu) | 11.8.1 |
| IPC Dogrulama | Zod (contract-first yaklasim) | 3.24.2 |
| Syntax Highlighting | Shiki | ^3.13.0 |
| Markdown Render | react-markdown + remark-gfm | ^10.1.0 / ^4.0.1 |
| Dosya Izleme | @parcel/watcher | ^2.5.6 |
| Fontlar | Inter, JetBrains Mono, Plus Jakarta Sans | - |
| Build/Paketleme | Bun Workspaces + Electron Forge | ^7.8.1 |
| Lint/Format | Biome | 1.9.4 |
| Test | Vitest + Testing Library | 3.0.8 |
| E2E Test | Playwright | ^1.58.2 |
| CI | GitHub Actions (3 platform matrisi) | - |

---

## 4. Monorepo Yapisi

```
codetrail/
  apps/
    desktop/                       # Electron masaustu uygulamasi (@codetrail/desktop)
      src/
        main/                      # Ana islem (~42 dosya)
          data/                    # Veri erisim katmani (queryService, bookmarkStore)
          live/                    # Canli oturum alt sistemi
        preload/                   # Preload koprusu (1 dosya)
        renderer/                  # React UI (~100+ dosya)
          app/                     # Uygulama sabitleri ve tipleri
          components/              # UI bilesenleri
            history/               # Proje ve oturum panelleri
            messages/              # Mesaj gosterim bilesenleri
            settings/              # Ayarlar alt bilesenleri
          features/                # Ozellik controller'lari ve gorunumler
          hooks/                   # Paylasilan React hook'lari
          lib/                     # Yardimci kutuphane (~36 dosya)
          test/                    # Test altyapisi
        shared/                    # Main/renderer arasi paylasilan tipler (9 dosya)
        types/                     # Tip tanimlari
      scripts/                     # Build/paketleme betikleri (9 dosya)
      assets/icons/                # Uygulama ikonu kaynaklari
  packages/
    core/                          # Platform-agnostik cekirdek kutuphane (@codetrail/core)
      src/
        contracts/                 # Kanonik tipler, IPC semalari (Zod), kategoriler
        db/                        # SQLite sema olusturma ve migrasyon
        discovery/                 # Dosya sistemi kesfetme (5 saglayici)
          providers/               # Saglayiciya ozel kesfetme modulleri
        indexing/                   # Artirimli indeksleme motoru
        live/                      # Canli oturum durum makinesi
        parsing/                   # Saglayici dosya ayristirma
        providers/                 # Saglayici adapter'lari
          adapters/                # Her saglayici icin adapter
          oversized/               # Buyuk dosya yonetimi
        search/                    # FTS5 tam metin arama
        testing/                   # In-memory test altyapisi
        tooling/                   # Arac islemi sezgiselleri
      test-fixtures/               # Test verisi
  scripts/
    check-platform-boundaries.mjs  # Platform-spesifik kodun izole kalmasini zorunlu kilar
  e2e/                             # Playwright E2E test paketi
    fixtures/                      # Electron app fixture
    helpers/                       # Yardimci fonksiyonlar
    scenarios/                     # 10 test senaryo spesifikasyonu (markdown)
    tests/                         # 9 Playwright test dosyasi
  docs/                            # Mimari ve karar kayitlari
  .github/workflows/               # CI pipeline
```

### 4.1. `@codetrail/core` (packages/core)

Platform-bagimsiz veri motoru. Tum SQLite islemleri, dosya kesfetme, oturum ayristirma, indeksleme ve arama islevselligini icerir.

**Bagimliliklari:** `better-sqlite3`, `zod`

**Export Noktalari:**

| Export | Dosya | Amac |
|---|---|---|
| `.` | `src/index.ts` | Tam Node.js API (DB, indeksleme, kesfetme, ayristirma, arama) |
| `./browser` | `src/browser.ts` | Tarayici-guvenli alt kume (contract'lar, path matching -- SQLite/Node yok) |
| `./testing` | `src/testing/index.ts` | In-memory DB/FS stub'lari, test fixture yardimcilari |
| `./tooling/editOperations` | `src/tooling/editOperations.ts` | Duzenleme islemi tespit sezgiselleri |

**Alt Moduller:**

| Modul | Dosya Sayisi | Amac |
|---|---|---|
| `contracts/` | 6 | Kanonik veri tipleri, IPC semalari (Zod), mesaj kategorileri, saglayici metadata |
| `db/` | 3 | SQLite sema olusturma, migrasyon, FTS5 kurulumu (sema v11) |
| `discovery/` | 19 | Her saglayici icin dosya sistemi kesfetme (5 saglayiciya ozel modul + yardimcilar) |
| `indexing/` | 8 | Kesfedilen oturumlari SQLite'a indeksleme (artirimli checkpoint destegi) |
| `parsing/` | 9 | Ham saglayici dosyalarini kanonik mesajlara ceviren parser'lar (~1516 satir ana parser) |
| `providers/` | 11 | Saglayici adapter kayit defteri ve adapter'lar (5 saglayici + oversized handler'lar) |
| `search/` | 5 | FTS5 tam metin arama, BM25 siralama, sorgu plani olusturucu (~678 satir) |
| `live/` | 4 | Canli oturum durum makinesi (~1153 satir) |
| `testing/` | 6 | In-memory SQLite ve dosya sistemi test altyapisi |
| `tooling/` | 1 | Arac islemi sezgiselleri |

### 4.2. `@codetrail/desktop` (apps/desktop)

Electron uygulamasi. 3 islem katmani + paylasilan kod icerir.

**Runtime Bagimliliklari:** React 19, react-dom, react-markdown, remark-gfm, shiki, better-sqlite3, @parcel/watcher, font paketleri

**Dev Bagimliliklari:** @codetrail/core (workspace link), electron 35, @electron-forge/*, @electron/rebuild

---

## 5. Mimari Yapi

### 5.1. Electron 3-Katman Mimarisi

```
+------------------+     IPC (Zod validated)     +------------------+
|   Main Process   | <=========================> |    Renderer      |
|   (Node.js)      |     contextBridge           |    (React 19)    |
|                  |          ^                   |                  |
|  - SQLite DB     |          |                   |  - History View  |
|  - File Watcher  |    +-----+------+            |  - Search View   |
|  - Indexing      |    |  Preload   |            |  - Settings      |
|  - Live Sessions |    |  Script    |            |  - Message Viewer|
|  - Editor Launch |    +------------+            |  - Bookmarks     |
+------------------+                              +------------------+
        |                                                  |
        v                                                  v
  Worker Threads                                    React Hooks
  (Indexing)                                    (Controller Pattern)
```

### 5.2. Main Process (apps/desktop/src/main/) -- ~42 dosya

Tum uzun omurlu kaynaklari yonetir.

| Dosya | Satir | Amac |
|---|---|---|
| `main.ts` | ~200 | Giris noktasi. BrowserWindow olusturma, tekil-ornek kilidi, pencere durumu kaliciligi |
| `bootstrap.ts` | ~1007 | Cekirdek baslatma. DB, QueryService, IndexingRunner, FileWatcher, LiveSessionStore baslatma ve 35+ IPC handler kaydi |
| `ipc.ts` | - | Genel IPC kayit cercevesi. Zod ile cift yonlu (istek+yanit) dogrulama |
| `data/queryService.ts` | - | SQLite uzerinden veri erisim katmani |
| `data/bookmarkStore.ts` | - | Ayri SQLite veritabaninda yer imi yonetimi |
| `indexingRunner.ts` | - | Worker thread tabanli indeksleme kosucu |
| `indexingWorker.ts` | - | Indeksleme icin worker thread giris noktasi |
| `fileWatcherService.ts` | - | @parcel/watcher ile dosya sistemi izleme |
| `liveSessionStore.ts` | - | Canli/aktif oturum durumu yonetimi |
| `live/liveSnapshot.ts` | - | Canli oturum anlik goruntu hesaplama |
| `live/liveInstrumentation.ts` | - | Canli oturum enstrumantasyonu |
| `live/claudeHookSettings.ts` | - | Claude hooks yapilandirmasi |
| `editorRegistry.ts` | - | Harici editor algilama ve yonetimi |
| `editorLaunch.ts` | - | Dosyalari harici editor'lerde acma |
| `editorDetection.ts` | - | Editor kurulum algilama |
| `editorDefinitions.ts` | - | Editor tanimlari (VS Code, Zed, Sublime, Neovim, Cursor, TextEdit) |
| `editorMacos.ts` | - | macOS'e ozel editor destegi |
| `editorPlatform.ts` | - | Platform editor soyutlamasi |
| `editorTempArtifacts.ts` | - | Gecici artifact yonetimi |
| `historyExport.ts` | - | Gecmis disa aktarim (ilerleme raporlu) |
| `appMenu.ts` | - | Uygulama menu sablonu |
| `appStateStore.ts` | - | UI durumunu `ui-state.json`'a kalici saklama |
| `instanceMode.ts` | - | Yan yana ornek modu (`--instance=compare`) |
| `quitLifecycle.ts` | - | Duzgun kapatma yonetimi |
| `indexingJobSource.ts` | - | Indeksleme is kaynagi |
| `indexingRequestConfig.ts` | - | Indeksleme istek yapilandirmasi |
| `watchStatsStore.ts` | - | Izleme istatistikleri |
| `debugLog.ts` | - | Hata ayiklama log'lari |
| `platformConfig.ts` | - | Platform yapilandirmasi |
| `serializeError.ts` | - | Hata serializasyonu |

### 5.3. Preload Script (apps/desktop/src/preload/)

Tek dosya: `index.ts`. `contextBridge.exposeInMainWorld("codetrail", api)` ile `CodetrailBridge` API'sini renderer'a acar. Her metot bir IPC kanalina eslesir. Renderer, main process'e yalnizca bu kopru uzerinden erisebilir.

### 5.4. Renderer Process (apps/desktop/src/renderer/) -- ~100+ dosya

React 19 tabanli kullanici arayuzu.

**Ana Gorunumler:**

| Gorunum | Bilesenler | Aciklama |
|---|---|---|
| History View | `HistoryLayout`, `ProjectPane`, `SessionPane`, `HistoryDetailPane` | 3 panelli duzenleme (Projeler - Oturumlar - Mesajlar) |
| Search View | `SearchView` | FTS5 tam metin arama (basit ve gelismis mod) |
| Settings View | `SettingsView`, `ExternalToolsSection`, `LiveWatchSection` | Saglayici ayarlari, harici arac, canli izleme |
| Shortcuts Dialog | `ShortcutsDialog` | Klavye kisayollari yardimi |

**Durum Yonetimi Mimarisi:**

Zustand/Redux **kullanilmiyor**. Saf React hooks (`useState`, `useCallback`, `useRef`) ile ozel controller hook'lari. Bu yaklasim bagimliliklari azaltir ve React'in dogal veri akisini korur.

| Controller | Alt Hook'lar | Amac |
|---|---|---|
| `useHistoryController` | 5 alt hook | Ana gecmis gorunum durumu (~1500 satir toplam) |
| `useSearchController` | - | Arama gorunum durumu |
| `useAppearanceController` | - | Tema ve gorunum tercihleri |
| `useLiveWatchController` | - | Canli oturum izleme durumu |

**History Controller Ayristirmasi (5 alt hook):**

| Hook | Amac |
|---|---|
| `useHistoryDataEffects` | Veri yukleme ve IPC etkileri |
| `useHistoryDerivedState` | Turetilmis durum hesaplama (~350 satir) |
| `useHistoryInteractions` | Kullanici etkilesimleri |
| `useHistorySelectionState` | Secim durumu yonetimi (~265 satir) |
| `useHistoryViewportEffects` | Viewport ve kaydirma etkileri |

**Ek Mekanizmalar:**

- `CodetrailClient` React Context uzerinden saglanir (IPC koprusunu saran istemci)
- `PaneFocusProvider` klavye tabanli panel odak yonetimi icin
- Router kutuphanesi yok -- basit `mainView` state degiskeni (`"history"`, `"search"`, `"help"`, `"settings"`)
- Debounced secim: Klavye bosaldikca 140ms gecikme ile secim onaylama (hizli ok tus navigasyonunda titresimi onler)
- Otomatik kaydirma: Yeni oturumlar icin otomatik sayfa sonu takibi

### 5.5. Shared (apps/desktop/src/shared/) -- 9 dosya

| Dosya | Amac |
|---|---|
| `codetrailBridge.ts` | Bridge tip tanimlari (preload -> renderer arasi) |
| `appCommands.ts` | Uygulama komut tanimlari |
| `desktopPlatform.ts` | Platform normallemeleri |
| `externalTools.ts` | Harici arac tanimlari |
| `historyExport.ts` | Gecmis disa aktarim tipleri |
| `liveStatusPush.ts` | Canli durum push tipleri |
| `textViewerThemes.ts` | Metin goruntuleyici tema tanimlari |
| `toolParsing.ts` | Arac ayristirma tipleri |
| `uiPreferences.ts` | UI tercih tipleri |

---

## 6. Veri Akisi (End-to-End)

```
AI Arac Dosyalari
  Claude: ~/.claude/projects/**/*.jsonl (JSONL stream)
  Codex:  ~/.codex/sessions/**/*.jsonl  (JSONL stream)
  Gemini: ~/.gemini/tmp/**/*.json       (Materialized JSON)
  Cursor: ~/.cursor/projects/**/*.jsonl (JSONL stream)
  Copilot: .../workspaceStorage/*/chatSessions/*.json (Materialized JSON)
      |
      v
  [1. Discovery] --> Her saglayici icin dosya sistemi taramasi
      |               discoverSessionFiles() -> DiscoveredFile[]
      |               (worktree algilama, proje yolu cozumleme, hash-tabanli lookup)
      v
  [2. Parsing] --> Saglayiciya ozel formatlari CanonicalMessage[] formatina cevir
      |            providerParsers.ts (~1516 satir) + helpers.ts (~244 satir)
      |            (rol normalizasyonu, zaman damgasi duzeltme, kategori atama)
      v
  [3. Indexing] --> SQLite'a yaz (Worker Thread uzerinde)
      |             indexSessions.ts (~3200+ satir)
      |             (projeler, oturumlar, mesajlar, arac cagrilari, FTS5 indeksi)
      |             Artirimli: dosya boyutu/mtime + JSONL byte-offset checkpoint'leri
      |             UTF-8 byte-aware truncation (32KB FTS limiti)
      v
  [4. QueryService] --> SQL sorgulari
      |                 (projeler/oturumlar/mesajlar/arama/yer imleri/istatistikler)
      v
  [5. IPC Handlers] <-- Zod cift yonlu dogrulama --> [6. Preload Bridge]
      |                                                     |
      v                                                     v
  [7. FileWatcher] --> @parcel/watcher ile           [8. React UI]
      |                dizin izleme                  (Controller hook'lari ile
      |                                              durum yonetimi)
      v
  [9. LiveSessionStore] --> Aktif oturumlari
                            gercek zamanli izle
                            --> renderer'a push
```

### Artirimli Indeksleme Detayi

Indeksleme motoru (`indexSessions.ts`, ~3200+ satir) su adimlari izler:

1. **Dosya degisiklik algilama**: Boyut ve mtime kontrolu (indexed_files tablosu)
2. **JSONL checkpoint sistemi**: Byte-offset + satir-numarasi + event-index + head/tail hash dogrulama
3. **Duplicate resolution**: Ayni oturum ID ile birden fazla dosya varsa, en guncel olani secme
4. **Stream persistence**: Dusuk seviyeli Buffer I/O ile JSONL satirlarini okuma
5. **UTF-8 byte-aware truncation**: FTS5 icin icerik 32KB'de kesilir (karakter sinirinda)

### Canli Oturum Durum Makinesi

`packages/core/src/live/liveSessionState.ts` (~1153 satir) saglayici-agnostik bir durum makinesi:

- Islem takibi (operation tracking)
- Oncelik tabanli detay gorunurlugu
- Yapilandirabilir bosta bekleme zamani asimi (idle timeout)
- Durum gecisleri: `idle` -> `active` -> `writing` -> `idle`

---

## 7. Veritabani Semasi (v11)

Sema yonetimi kaba daneli versiyon kontrolu + tam yeniden olusturma stratejisi kullanir (migrasyon zincirleri yerine). Bu, verilerin yalnizca yerel bir onbellek olmasi ve kaynak dosyalardan yeniden olusturulabilmesi nedeniyle meşrudur.

### Tablolar

| Tablo | Amac | Onemli Sutunlar |
|---|---|---|
| `projects` | Proje kayitlari | yol, saglayici, ad, olusturulma tarihi |
| `sessions` | Oturum kayitlari | proje FK, zaman damgasi, dosya yolu, saglayici |
| `messages` | Kanonik mesajlar | oturum FK, rol, kategori, icerik, zaman damgasi |
| `tool_calls` | Arac cagrilari | mesaj FK, arac adi, girdi, cikti |
| `project_stats` | Proje istatistikleri | oturum sayisi, mesaj sayisi (trigger ile guncellenir) |
| `indexed_files` | Indekslenmis dosya durumu | boyut, mtime (artirimli indeksleme icin) |
| `index_checkpoints` | JSONL checkpoint'leri | byte_offset, line_number, event_index, head_hash, tail_hash |
| `deleted_sessions` | Silinen oturumlar | soft delete |
| `deleted_projects` | Silinen projeler | soft delete |
| `message_fts` | FTS5 tam metin arama | `prefix='2 3 4'`, BM25 siralama |
| `meta` | Sema versiyonu | versiyon numarasi, meta bilgiler |

### SQLite Yapilandirmasi

- **WAL modu**: Yazma islemleri okuma islemlerini bloklamaz
- **FTS5**: Tam metin arama icin sanal tablo, BM25 siralama algoritmasi
- **Trigger'lar**: Mesaj ekleme/silme islemlerinde istatistik tablolarini otomatik guncelleme

---

## 8. IPC Kanallari (~35 kanal)

IPC kontrat'lari `packages/core/src/contracts/ipc.ts` dosyasinda (~848 satir) Zod semalari olarak tanimlanir. Her kanal istek ve yanit semalarina sahiptir.

### Kanal Domainleri

| Domain | Ornek Kanallar | Aciklama |
|---|---|---|
| `app:*` | `app:info`, `app:platform`, `app:version` | Uygulama bilgisi |
| `projects:*` | `projects:list`, `projects:detail`, `projects:delete` | Proje yonetimi |
| `sessions:*` | `sessions:list`, `sessions:messages`, `sessions:stats` | Oturum yonetimi |
| `bookmarks:*` | `bookmarks:add`, `bookmarks:remove`, `bookmarks:list` | Yer imi yonetimi |
| `search:*` | `search:query` | Tam metin arama |
| `indexer:*` | `indexer:status`, `indexer:config` | Indeksleme durumu |
| `watcher:*` | `watcher:status`, `watcher:start`, `watcher:stop` | Dosya izleyici |
| `ui:*` | `ui:pane-state`, `ui:preferences` | UI durum kaliciligi |
| `editor:*` | `editor:open`, `editor:detect` | Harici editor eylemleri |
| `claudeHooks:*` | `claudeHooks:config`, `claudeHooks:update` | Claude hooks yapilandirmasi |
| `dialog:*` | `dialog:open-file`, `dialog:open-directory` | Dialog/dosya secici |
| `history:*` | `history:export` | Gecmis disa aktarim |
| `debug:*` | `debug:info`, `debug:log` | Hata ayiklama |
| `live:*` | `live:status`, `live:sessions` | Canli oturum |

Her kanal Zod ile cift yonlu (istek + yanit) dogrulanir. Bu contract-first yaklasim, calisma zamani tip guvenligini garanti eder.

---

## 9. Arama Motoru

### Sorgu Planlama (`queryPlan.ts`, ~678 satir)

Kullanicinin arama girdisini SQL sorgusuna donusturmek icin bir sorgu plan olusturucu:

- Basit arama: tek terim veya coklu terim
- Gelismis filtreleme: saglayici, proje, kategori, tarih araligi
- FTS5 ozel soz dizimi: `prefix`, `NEAR`, `AND`/`OR` operatorleri
- Otomatik prefix genisletme: 2, 3 ve 4 karakter prefix'leri icin FTS5 indeksi

### BM25 Siralama (`searchMessages.ts`, ~344 satir)

- FTS5'in yerlesik BM25 siralama algoritmasi
- Vurgulu snippet uretimi (arama sonuclarinda eslesen terimlerin vurgulanmasi)
- Sonuc sayfalama

---

## 10. Onemli Ozellikler

| Ozellik | Aciklama |
|---|---|
| Coklu Saglayici | 5 AI aracinin gecmisini tek arayuzde goruntuleme |
| Tam Metin Arama | SQLite FTS5, BM25 siralama, vurgulu snippet'lar, prefix arama |
| 3 Panelli Gecmis | Projeler, Oturumlar, Mesajlar hiyerarsisi |
| Proje Agac Gorunumu | Liste ve agac goruntuleme modlari |
| Kategori Filtreleri | User, Assistant, Tool Use, Tool Edit, Tool Result, Thinking, System |
| Artirimli Indeksleme | Dosya boyutu/mtime + JSONL byte-offset checkpoint bazli degisiklik algilama |
| Canli Oturum Izleme | Aktif AI oturumlarinin gercek zamanli takibi (durum makinesi ile) |
| Otomatik Yenileme | Watch (1s/3s/5s) ve scan (5s-5dk) modlari |
| Yer Imleri | Bireysel mesajlari yer imlerine ekleme (ayri SQLite DB) |
| Harici Editor | VS Code, Zed, Sublime, Neovim, Cursor, TextEdit destegi |
| Gecmis Disa Aktarim | Oturum/proje gecmisini dosyaya aktarma (ilerleme raporlu) |
| 13 UI Temasi | light, dark, ft-dark, tomorrow-night, catppuccin-mocha, obsidian, graphite, midnight, onyx, clean-white, warm-paper, stone, sand |
| Syntax Highlighting | Shiki tabanli, yapilandirabilir temalar |
| Klavye Kisayollari | Kapsamli klavye tabanli navigasyon (~832 satir shortcut sistemi) |
| Yan Yana Ornekler | `--instance=compare` ile coklu ornek calistirma |
| Capraz Platform | macOS (birincil), Windows, Linux |
| Worktree Algilama | Claude ve Codex worktree'leri otomatik algilanir, kanonik proje yoluna normallestirilir |

---

## 11. Build ve CI/CD

### Build Sureci

| Adim | Script | Amac |
|---|---|---|
| 1 | `scripts/build.ts` | TypeScript bundle olusturma (main + renderer) |
| 2 | `scripts/rebuild-native.ts` | Native modulleri Electron ABI'sine yeniden derleme |
| 3 | Electron Forge | Paketleme (DMG, ZIP -- macOS; Squirrel -- Windows) |
| 4 | `scripts/build-app-icons.mjs` | SVG'den platform-spesifik ikonlar uretme |

### Test Stratejisi

| Tip | Arac | Detay |
|---|---|---|
| Unit | Vitest + Testing Library (JSDOM) | Electron runtime ile calistirilir (native modul ABI uyumlulugu icin) |
| Integration | Vitest | SQLite veritabani ile entegrasyon testleri |
| E2E | Playwright | Capraz platform (9 test dosyasi, 10 senaryo spesifikasyonu) |
| Coverage | V8 | Statements %85, Lines %85, Functions %85, Branches %75 |

**Test Dosyasi Dagilimi:** ~99 test dosyasi toplam (unit + integration + E2E)

### CI Pipeline (GitHub Actions -- `.github/workflows/e2e.yml`)

| Adim | Aciklama |
|---|---|
| 1 | Checkout + Bun kurulumu + `bun install --frozen-lockfile` |
| 2 | `bun run ci` (lint + platform boundaries + typecheck + unit test + coverage) |
| 3 | `bun run desktop:build` |
| 4 | `bun run fix:native` (native modul dogrulama/yeniden derleme) |
| 5 | Playwright sistem bagimlilik kurulumu (yalnizca Linux) |
| 6 | E2E testleri (Linux: xvfb ile, Windows/macOS: dogrudan) |
| 7 | Playwright raporu + test sonuclari artifact olarak yukleme (7 gun tutma) |

**Platform Matrisi:** `ubuntu-latest`, `windows-latest`, `macos-latest` (fail-fast: false)
**Timeout:** 60 dakika/is

### Platform Sinir Kontrolu

`scripts/check-platform-boundaries.mjs` (~112 satir) -- Platform-spesifik kodun (`process.platform`, `darwin`, `win32`, `osascript`, `metaKey`/`ctrlKey` vb.) yalnizca beyaz listedeki dosyalarda bulunmasini zorunlu kilar. CI'da otomatik calisir.

---

## 12. TypeScript Yapilandirmasi

| Ayar | Deger | Aciklama |
|---|---|---|
| `target` | ES2022 | Modern JavaScript ciktisi |
| `module` | ESNext | ES modulleri |
| `moduleResolution` | Bundler | Bundler uyumlu modul cozumlemesi |
| `jsx` | react-jsx | React JSX donusumu |
| `strict` | true | Tum siki kontroller aktif |
| `noUncheckedIndexedAccess` | true | Dizin erisimlerinde `undefined` olasiligi zorunlu |
| `exactOptionalPropertyTypes` | true | Opsiyonel ozelliklerde `undefined` acikca yazilmali |
| `noImplicitOverride` | true | Override anahtar kelimesi zorunlu |
| `noFallthroughCasesInSwitch` | true | Switch-case dusme engelleme |
| Path aliases | `@codetrail/core` | `packages/core/src/index.ts`'e eslesir |

---

## 13. Paketin Bagimliliklari Arasi Iliskiler

```
@codetrail/core (packages/core/)
  |
  |-- devDependency olarak baglanir -->  @codetrail/desktop (apps/desktop/)
  |
  Import Kurallari:
    main process:  "@codetrail/core"          (tam API: DB, indeksleme, kesfetme, arama)
    preload:       "@codetrail/core"          (yalnizca IPC tipleri)
    renderer:      "@codetrail/core/browser"  (tarayici-guvenli alt kume, SQLite yok)
    shared:        "@codetrail/core/browser"  (IPC tipleri)
```

Bu mimari sinir, renderer'in yanlis bir sekilde Node.js/SQLite API'lerine erismesini onler. Platform sinir kontrolu (`check-platform-boundaries.mjs`) bunu CI'da da zorunlu kilar.

---

## 14. Ortam Degiskenleri

| Degisken | Amac |
|---|---|
| `CODETRAIL_OPEN_DEVTOOLS=1` | Baslatmada DevTools'u ac |
| `CODETRAIL_DEBUG_RENDERER=1` | Renderer hata ayiklama modu |
| `CODETRAIL_RENDERER_URL=http://...` | Ozel renderer URL'si (gelistirme icin) |

---

## 15. Mimari Tasarim Kararlari

| Karar | Gerekce |
|---|---|
| Contract-first IPC (Zod) | Tum IPC kanallari Zod semalari ile cift yonlu dogrulanir -- calisma zamani tip guvenligi |
| Sema rebuild vs. migrasyon | Veriler yerel onbellek oldugu icin kaba daneli versiyon kontrolu + tam yeniden olusturma yeterli |
| Platform izolasyonu | Platform-spesifik kod beyaz listeyle sinirlanir ve CI'da kontrol edilir |
| Tarayici-guvenli export | `@codetrail/core/browser` ile renderer'da Node.js bagimliligini engelleme |
| Worker thread indeksleme | Ana islem bloklanmaz, uzun sureli indeksleme islemleri ayri thread'de calisir |
| Redux/Zustand yerine saf hooks | Bagimliliklari azaltir, React'in dogal veri akisini korur |
| Router kutuphanesi yok | Basit `mainView` state degiskeni yeterli (4 gorunum) |
| Debounced secim (140ms) | Hizli ok tus navigasyonunda titresimi onler |
| Ayri SQLite DB (bookmarks) | Yer imleri ana veritabanindan bagimsiz, sema yeniden olusturma yer imlerini etkilemez |
| JSONL byte-offset checkpoint | Buyuk dosyalarda artirimli okuma, yalnizca yeni satirlari isler |
| Oversized 3-katman stratejisi | 8MB/32MB esiklarinde temizleme ve red ile bellek tasmasini onler |

---

## 16. Mimari Guclu Yonler

1. **Contract-first IPC**: Tum IPC kanallari Zod semalari ile cift yonlu dogrulanir -- calisma zamani tip guvenligi
2. **Platform izolasyonu**: Platform-spesifik kod beyaz listeyle sinirlanir ve CI'da kontrol edilir
3. **Tarayici-guvenli export**: `@codetrail/core/browser` ile renderer'da Node.js bagimliligini engelleme
4. **Artirimli indeksleme**: JSONL byte-offset checkpoint sistemi ile buyuk dosya koleksiyonlarinda verimli guncelleme
5. **Worker thread indeksleme**: Ana islem bloklanmaz
6. **Yuksek test kapsami**: %85 esik degeri zorunlu, ~99 test dosyasi
7. **Siki TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` gibi nadir kullanilan siki ayarlar aktif
8. **Capraz platform CI**: 3 platform matrisinde otomatik test
9. **Temiz saglayici soyutlamasi**: `ProviderAdapter` arayuzu ile yeni saglayici eklemek kolay
10. **Canli oturum durum makinesi**: Provider-agnostik, test edilebilir, 1153 satirlik kapsamli durum yonetimi
11. **Modüler controller hook deseni**: History controller 5 alt hook'a ayristirip bakilabilirlik arttirilmis

---

## 17. Potansiyel Gelistirme Alanlari

| Alan | Aciklama |
|---|---|
| Yeni saglayici ekleme | `ProviderAdapter` arayuzunu uygulayarak yeni AI araci destegi eklenebilir |
| Disa aktarim formatlari | Markdown, JSON, HTML gibi ek disa aktarim formatlari |
| Istatistik dashboard | Kullanim istatistikleri, trend analizi, saglayici karsilastirmasi |
| Coklu dil destegi | Uygulama arayuzu lokalizasyonu |
| Plugin sistemi | Ucuncu parti uzantilar icin plugin API |
| Bulut senkronizasyon | Istege bagli, sifrelenmis bulut yedekleme (mevcut yerel-oncelikli prensibe uygun) |
| Gelismis arama | Semantik arama, tarih araligi filtreleri, regex destegi |
| Performans optimizasyonu | Cok buyuk veritabanlari icin sayfalama ve lazy loading iyilestirmeleri |

---

## 18. Dosya Istatistikleri (Tahmini)

| Kategori | Dosya Sayisi |
|---|---|
| Main Process kaynak dosyalari | ~42 |
| Renderer kaynak dosyalari | ~100+ |
| Shared dosyalar | ~9 |
| Core paket kaynak dosyalari | ~70+ |
| Test dosyalari (unit + integration) | ~90 |
| E2E test dosyalari | ~9 |
| Build/CI scriptleri | ~12 |
| Dokumantasyon | ~5 |
| **Toplam** | **~340+** |

---

*Bu dokuman 16 Nisan 2026 tarihinde Code Trail v0.1.0 kaynak kodu uzerinden kapsamli analiz ile olusturulmustur.*
