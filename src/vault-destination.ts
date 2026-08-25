export const VAULT_ROOT_DESTINATION = "/";

function normalizeDestinationPath(value: unknown): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

export function normalizeVaultDestinationFolder(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === VAULT_ROOT_DESTINATION || raw === ".") return VAULT_ROOT_DESTINATION;
  const normalized = normalizeDestinationPath(raw || fallback)
    .replace(/^\/+|\/+$/g, "");
  return normalized || normalizeDestinationPath(fallback).replace(/^\/+|\/+$/g, "") || VAULT_ROOT_DESTINATION;
}

export function buildVaultDestinationPath(folder: string, filename: string): string {
  const normalizedFolder = normalizeVaultDestinationFolder(folder, VAULT_ROOT_DESTINATION);
  const normalizedFilename = normalizeDestinationPath(filename).replace(/^\/+/, "");
  if (!normalizedFilename || normalizedFilename === ".") throw new Error("A destination filename is required.");
  return normalizedFolder === VAULT_ROOT_DESTINATION
    ? normalizedFilename
    : normalizeDestinationPath(`${normalizedFolder}/${normalizedFilename}`);
}

export function fileIsInVaultDestination(filePath: string, folder: string): boolean {
  const normalizedPath = normalizeDestinationPath(filePath).replace(/^\/+/, "");
  const normalizedFolder = normalizeVaultDestinationFolder(folder, VAULT_ROOT_DESTINATION);
  if (!normalizedPath || normalizedPath === ".") return false;
  if (normalizedFolder === VAULT_ROOT_DESTINATION) return !normalizedPath.includes("/");
  return normalizedPath.startsWith(`${normalizedFolder}/`);
}
