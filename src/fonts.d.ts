declare module 'opentype.js' {
  const opentype: { parse(buf: ArrayBuffer): any };
  export default opentype;
  export function parse(buf: ArrayBuffer): any;
}
declare module '*.woff?inline' { const dataUrl: string; export default dataUrl; }
