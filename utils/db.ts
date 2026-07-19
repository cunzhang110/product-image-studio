import { normalizeProductBatch, type ProductBatch } from "../domain/productWorkflow";

const PROMPT_TEMPLATE_PREFERENCE_ID = "prompt-template-preference";

export const initDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('GeminiImageDB', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('productBatches')) {
        db.createObjectStore('productBatches', { keyPath: 'id' });
      }
    };
  });
};

export const saveProductBatchesToDB = async (batches: ProductBatch[]) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('productBatches', 'readwrite');
    const store = tx.objectStore('productBatches');
    store.clear();
    batches.forEach(batch => store.put(batch));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const loadProductBatchesFromDB = async (): Promise<ProductBatch[]> => {
  const db = await initDB();
  return new Promise<ProductBatch[]>((resolve, reject) => {
    const tx = db.transaction('productBatches', 'readonly');
    const request = tx.objectStore('productBatches').getAll();
    request.onsuccess = () => resolve((request.result as ProductBatch[]).map(normalizeProductBatch));
    request.onerror = () => reject(request.error);
  });
};

export const savePromptTemplatePreference = async (promptTemplate: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ id: PROMPT_TEMPLATE_PREFERENCE_ID, promptTemplate });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const loadPromptTemplatePreference = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const request = tx.objectStore("settings").get(PROMPT_TEMPLATE_PREFERENCE_ID);
    request.onsuccess = () => resolve(request.result
      ? String(request.result.promptTemplate ?? "")
      : null);
    request.onerror = () => reject(request.error);
  });
};

export const saveTasksToDB = async (tasks: any[]) => {
  try {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      store.clear();
      tasks.forEach(task => store.put(task));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to save tasks to DB', e);
  }
};

export const loadTasksFromDB = async () => {
  try {
    const db = await initDB();
    return new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction('tasks', 'readonly');
      const store = tx.objectStore('tasks');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to load tasks from DB', e);
    return [];
  }
};

export const saveSettingsToDB = async (settings: any) => {
  try {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ id: 'global', ...settings });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to save settings to DB', e);
  }
};

export const loadSettingsFromDB = async () => {
  try {
    const db = await initDB();
    return new Promise<any>((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get('global');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to load settings from DB', e);
    return null;
  }
};
