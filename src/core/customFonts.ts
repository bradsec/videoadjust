// User-added overlay fonts. Font files are binary and often several megabytes, beyond what
// localStorage holds, so they live in IndexedDB on this device and are never uploaded.

export const CUSTOM_FONT_MAX_BYTES = 10 * 1024 * 1024;
export const CUSTOM_FONT_PREFIX = 'custom:';
const EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];
const DB_NAME = 'videoadjust-fonts';
const STORE = 'fonts';

export interface CustomFont {
  id: string;
  name: string;
  data: ArrayBuffer;
}

/** The canvas family name for a stored font; unique so it never shadows a bundled family. */
export const customFontFamily = (id: string) => `videoadjust-custom-${id}`;
export const isCustomFont = (font: string): font is `custom:${string}` =>
  font.startsWith(CUSTOM_FONT_PREFIX);
export const customFontId = (font: string) => font.slice(CUSTOM_FONT_PREFIX.length);

// Kept for this session too, so a font still works when the browser blocks IndexedDB.
const session = new Map<string, CustomFont>();
const registered = new Map<string, Promise<void>>();
const faces = new Map<string, FontFace>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Font storage is unavailable.'));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      if (mode === 'readonly') request.onsuccess = () => resolve(request.result);
      else transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Font storage failed.'));
      request.onerror = () => reject(request.error ?? new Error('Font storage failed.'));
    });
  } finally {
    db.close();
  }
}

export function customFontError(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!EXTENSIONS.some((extension) => name.endsWith(extension)))
    return 'Choose a TTF, OTF, WOFF or WOFF2 font file.';
  if (file.size > CUSTOM_FONT_MAX_BYTES) return 'Font files can be at most 10 MB.';
  return null;
}

/** Lists saved fonts, oldest first. Storage failures yield the fonts added this session. */
export async function listCustomFonts(): Promise<CustomFont[]> {
  try {
    const stored = await transact<CustomFont[]>('readonly', (store) => store.getAll());
    for (const font of stored) session.set(font.id, font);
  } catch (error) {
    console.warn('Saved fonts are unavailable', error);
  }
  return [...session.values()];
}

/**
 * Validates the file as a font, then saves it. Returns whether it was saved for later
 * visits; false means it works only until the page closes.
 */
export async function addCustomFont(file: File): Promise<{ font: CustomFont; saved: boolean }> {
  const problem = customFontError(file);
  if (problem) throw new Error(problem);
  const data = await file.arrayBuffer();
  const id = crypto.randomUUID().replaceAll('-', '');
  try {
    await new FontFace(customFontFamily(id), data).load();
  } catch {
    throw new Error('This file is not a font the browser can use.');
  }
  const font = { id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Font', data };
  session.set(id, font);
  try {
    await transact('readwrite', (store) => store.put(font));
    return { font, saved: true };
  } catch (error) {
    console.warn('Could not save the font for later visits', error);
    return { font, saved: false };
  }
}

export async function removeCustomFont(id: string): Promise<void> {
  session.delete(id);
  registered.delete(id);
  const face = faces.get(id);
  if (face) document.fonts.delete(face);
  faces.delete(id);
  await transact('readwrite', (store) => store.delete(id));
}

/** Registers a saved font with the document so canvas text can use it. */
export function loadCustomFont(id: string): Promise<void> {
  let load = registered.get(id);
  if (!load) {
    load = (async () => {
      const font = session.get(id) ?? (await listCustomFonts()).find((f) => f.id === id);
      if (!font)
        throw new Error('Your font is no longer saved in this browser. Choose another font.');
      const face = await new FontFace(customFontFamily(id), font.data).load();
      if (registered.get(id) !== load) return;
      faces.set(id, face);
      document.fonts.add(face);
    })();
    load.catch(() => {
      if (registered.get(id) === load) registered.delete(id);
    });
    registered.set(id, load);
  }
  return load;
}
