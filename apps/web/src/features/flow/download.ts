/**
 * Saves `content` as a file named `fileName`, through a temporary link to an object URL. The
 * URL is revoked once the browser has taken the download over.
 */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoking in the same task may cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
