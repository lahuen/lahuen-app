const escMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => escMap[ch]);
}
