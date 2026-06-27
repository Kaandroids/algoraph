/**
 * Browser file-transfer helpers — triggering a download of in-memory text and
 * reading a picked file back as text. Kept out of the component so it only
 * orchestrates *what* to save/load, not the Blob / FileReader plumbing.
 */

/** Trigger a browser download of in-memory text. */
export function downloadText(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download a value as a pretty-printed JSON file. */
export function downloadJson(name: string, data: unknown): void {
  downloadText(name, JSON.stringify(data, null, 2), 'application/json');
}

/** Read a picked file's contents as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
