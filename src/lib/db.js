import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RAIZ } from './config.js';

const ESQUEMA = path.join(RAIZ, 'db', 'schema.sql');

/** Abre (e migra) o banco. Passe ':memory:' nos testes. */
export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(ESQUEMA, 'utf8'));
  return db;
}

/** Executa fn dentro de uma transacao; desfaz tudo se ela lancar. */
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
