export interface MediaInput {
  url: string;
  mime: string;
  read(): Promise<Buffer>;
}
