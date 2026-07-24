// esbuild `text` loader: importing a .txt file yields its contents as a string.
declare module "*.txt" {
  const contents: string;
  export default contents;
}
