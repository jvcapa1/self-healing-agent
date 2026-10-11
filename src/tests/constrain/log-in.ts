import path from 'node:path';
export const username :string = process.env.SAUCEDEMO_USERNAME as string;
export const password :string = process.env.SAUCEDEMO_PASSWORD as string;
export const storageStatePath :string = path.resolve(process.cwd(), 'playwright', '.auth', 'saucedemo.json');