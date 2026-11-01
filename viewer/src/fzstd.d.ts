declare module "fzstd" {
  export function decompress(data: Uint8Array, output?: Uint8Array): Uint8Array;
}
