/**
 * Saves `content` as a file named `fileName`, through a temporary link to an object URL. The
 * URL is revoked once the browser has taken the download over.
 */
export function downloadFile(fileName: string, content: Blob): void {
  const url = URL.createObjectURL(content);
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
