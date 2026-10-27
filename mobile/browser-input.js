export function textEdit(before, after) {
  let at = 0;
  while (at < before.length && at < after.length && before[at] === after[at]) at++;
  if (at > 0 && /[\uD800-\uDBFF]/.test(before[at - 1])) at--;
  return { delete: [...before.slice(at)].length, text: after.slice(at) };
}
// The web window has no native input path; it uses the same worker envelope as Android.
export async function protectEdit(publicKey, edit) {
  const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const base64 = data => btoa(String.fromCharCode(...new Uint8Array(data)));
  const rsa = await crypto.subtle.importKey('spki', bytes(publicKey), { name:'RSA-OAEP', hash:'SHA-256' }, false, ['encrypt']);
  const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:new TextEncoder().encode('mybots-input') }, key, new TextEncoder().encode(JSON.stringify(edit))));
  return { type:'encrypted', key:base64(await crypto.subtle.encrypt('RSA-OAEP', rsa, await crypto.subtle.exportKey('raw', key))), iv:base64(iv), data:base64(encrypted.slice(0,-16)), tag:base64(encrypted.slice(-16)) };
}
