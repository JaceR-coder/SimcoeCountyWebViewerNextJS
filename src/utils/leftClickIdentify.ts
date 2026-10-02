import { getStorageItem, setStorageItem } from "@/utils/storage";

/**
 * Left-click identify (legacy i-Map behaviour): every map left-click runs the full Identify and
 * shows the results in the Reports tab. The user's choice from the Settings tool is stored in
 * localStorage; until they pick one, config.leftClickIdentify decides (default on).
 */
const STORAGE_KEY = "Left Click Identify";

export function getLeftClickIdentify(config?: { leftClickIdentify?: boolean } | null): boolean {
  try {
    const stored = getStorageItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return config?.leftClickIdentify ?? true;
}

export function setLeftClickIdentify(enabled: boolean): void {
  try {
    setStorageItem(STORAGE_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}
