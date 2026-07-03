import type { PortalCredentials, SearchInput } from "../types";

const STORAGE_KEY = "plane-finder:search-preferences:v1";
const CREDENTIALS_STORAGE_KEY = "plane-finder:credentials:v1";
const KEY_DB = "plane-finder-keys";
const KEY_STORE = "keys";
const KEY_ID = "credentials";
const OLD_SECURE_STORAGE_KEY = "plane-finder:search-input:v1";

export type SearchPreferences = Pick<
  SearchInput,
  "portalIds" | "desiredDate" | "startTime" | "endTime" | "aircraftModel" | "cfiName" | "requireCfi"
>;

export async function saveSearchPreferences(input: SearchInput): Promise<void> {
  const preferences: SearchPreferences = {
    portalIds: input.portalIds,
    desiredDate: input.desiredDate,
    startTime: input.startTime,
    endTime: input.endTime,
    aircraftModel: input.aircraftModel,
    cfiName: input.cfiName,
    requireCfi: input.requireCfi,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  localStorage.removeItem(OLD_SECURE_STORAGE_KEY);
  await saveEncryptedCredentials(input.credentials);
}

export async function loadSearchPreferences(): Promise<(SearchPreferences & { credentials?: Record<string, PortalCredentials> }) | null> {
  localStorage.removeItem(OLD_SECURE_STORAGE_KEY);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as SearchPreferences & { portalId?: string };
  return {
    ...parsed,
    portalIds: parsed.portalIds || (parsed.portalId ? [parsed.portalId] : []),
    aircraftModel: parsed.aircraftModel || "",
    credentials: await loadEncryptedCredentials(),
  };
}

async function saveEncryptedCredentials(credentials: Record<string, PortalCredentials>): Promise<void> {
  const key = await getCredentialKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify({
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }));
}

async function loadEncryptedCredentials(): Promise<Record<string, PortalCredentials> | undefined> {
  const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as { iv: string; ciphertext: string };
    const key = await getCredentialKey();
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, PortalCredentials>;
  } catch {
    localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
    return undefined;
  }
}

async function getCredentialKey(): Promise<CryptoKey> {
  const existing = await readStoredKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await writeStoredKey(key);
  return key;
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredKey(): Promise<CryptoKey | undefined> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const request = tx.objectStore(KEY_STORE).get(KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeStoredKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
