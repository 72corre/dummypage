// 保存（IndexedDB 主保存、4ストア、版番号つき）
// tech-foundation.md 第3節に対応する。
// バックエンドは小さな非同期インターフェースに切り、テストではメモリ実装に差し替えられる。
//   backend.get(store, key) / put(store, key, value) / delete(store, key) / clear(store) / keys(store)

export const DB_NAME = 'tower-tool';
export const DB_VERSION = 1;
export const STORE_NAMES = ['state', 'formations', 'records', 'settings'];
export const RECORD_VERSION = 1;

// ---- メモリ実装（テスト・フォールバック用） ----
export function memoryBackend() {
  const data = new Map(STORE_NAMES.map((name) => [name, new Map()]));
  return {
    async get(store, key) {
      const v = data.get(store).get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    async put(store, key, value) {
      data.get(store).set(key, structuredClone(value));
    },
    async delete(store, key) {
      data.get(store).delete(key);
    },
    async clear(store) {
      data.get(store).clear();
    },
    async keys(store) {
      return [...data.get(store).keys()];
    },
  };
}

// ---- IndexedDB 実装 ----
export function idbBackend(dbName = DB_NAME) {
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of STORE_NAMES) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  };
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    async get(store, key) {
      return tx(store, 'readonly', (os) => request(os.get(key)));
    },
    async put(store, key, value) {
      return tx(store, 'readwrite', (os) => request(os.put(value, key)));
    },
    async delete(store, key) {
      return tx(store, 'readwrite', (os) => request(os.delete(key)));
    },
    async clear(store) {
      return tx(store, 'readwrite', (os) => request(os.clear()));
    },
    async keys(store) {
      return tx(store, 'readonly', (os) => request(os.getAllKeys()));
    },
  };
}

// ---- 高レベルの読み書き（レコードには版番号を持たせる） ----

// ランの操作履歴（state ストア、キー 'run'）
// faceShownFloors は顔見せカードを自動表示済みの階（SW90）。
// squareFormations はマスに残す編成の対応（SW91）。保持単位は敵
// グループごと（問題16）で、保存形はマスID → { legacy, groups }
// （legacy = 旧形から引き継いだマスの編成、groups = 種名 → 編成ID）。
// この層では値の形は検査せず、そのまま往復させる（正規化は main.js）。
// どちらも操作履歴には含めない（元に戻す／やり直しの対象ではない）
// ため、ランの記録の付帯として持つ。ランが替われば呼び出し側が
// 空に戻す。
export async function loadRun(backend) {
  const rec = await backend.get('state', 'run');
  if (!rec) return null;
  return {
    ops: rec.ops || [],
    cursor: rec.cursor ?? (rec.ops || []).length,
    faceShownFloors: Array.isArray(rec.faceShownFloors) ? rec.faceShownFloors : [],
    squareFormations: rec.squareFormations && typeof rec.squareFormations === 'object'
      && !Array.isArray(rec.squareFormations) ? rec.squareFormations : {},
  };
}
export async function saveRun(backend, history, faceShownFloors, squareFormations) {
  await backend.put('state', 'run', {
    version: RECORD_VERSION,
    ops: history.ops,
    cursor: history.cursor,
    faceShownFloors: Array.isArray(faceShownFloors) ? faceShownFloors : [],
    squareFormations: squareFormations && typeof squareFormations === 'object'
      && !Array.isArray(squareFormations) ? squareFormations : {},
  });
}

// 編成と所持・育成（formations ストア、キー 'data'）
export async function loadFormationsData(backend) {
  const rec = await backend.get('formations', 'data');
  if (!rec) return null;
  return { formations: rec.formations || [], megidoDetails: rec.megidoDetails ?? null };
}
export async function saveFormationsData(backend, data) {
  await backend.put('formations', 'data', {
    version: RECORD_VERSION,
    formations: data.formations || [],
    megidoDetails: data.megidoDetails ?? null,
  });
}

// 過去のランの戦績（records ストア、キー 'runs'）
export async function loadRecords(backend) {
  const rec = await backend.get('records', 'runs');
  if (!rec) return { runs: [] };
  return { runs: rec.runs || [] };
}
export async function saveRecords(backend, records) {
  await backend.put('records', 'runs', { version: RECORD_VERSION, runs: records.runs || [] });
}

// 設定（settings ストア、キー 'ui'）
export async function loadSettings(backend) {
  const rec = await backend.get('settings', 'ui');
  return rec || { version: RECORD_VERSION };
}
export async function saveSettings(backend, settings) {
  await backend.put('settings', 'ui', { version: RECORD_VERSION, ...settings });
}

// 状態メタ（移行の記録など。state ストア、キー 'meta'）
export async function loadMeta(backend) {
  return (await backend.get('state', 'meta')) || null;
}
export async function saveMeta(backend, meta) {
  await backend.put('state', 'meta', { version: RECORD_VERSION, ...meta });
}

// ---- JSON の書き出しと読み込み（全ストアを1ファイルにまとめる） ----
export const EXPORT_KIND = 'tower-tool-export';

// 書き出しファイル名（最終チェック K6 の小物、2026-11-20）: 固定名では
// 退避のたびに同名になり、どれが新しい退避か分からなくなるため、
// 書き出し日（ローカル日付、YYYYMMDD）を入れる。読み込み側はファイル名
// には依存しない（中身の kind で検証する。importAll を参照）。
export function exportFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${EXPORT_KIND}-${y}${m}${d}.json`;
}

export async function exportAll(backend) {
  const out = { kind: EXPORT_KIND, version: RECORD_VERSION, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of STORE_NAMES) {
    out.stores[name] = {};
    for (const key of await backend.keys(name)) {
      out.stores[name][key] = await backend.get(name, key);
    }
  }
  return out;
}

export async function importAll(backend, json) {
  if (!json || json.kind !== EXPORT_KIND || !json.stores) {
    throw new Error('書き出しJSONの形式が違います');
  }
  for (const name of STORE_NAMES) {
    await backend.clear(name);
    const entries = json.stores[name] || {};
    for (const [key, value] of Object.entries(entries)) {
      await backend.put(name, key, value);
    }
  }
}

// 起動時の永続化要求（ブラウザ環境でのみ意味を持つ）。
export async function requestPersist() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // 要求に失敗しても起動は続ける。
  }
  return false;
}
