-- Esquema do sistema de separacao (equipe operacional).
-- Aplicado automaticamente na inicializacao (src/lib/db.js). Idempotente.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. Mobilizacao: criada quando o sistema de origem envia o Excel.
CREATE TABLE IF NOT EXISTS mobilizacoes (
  id                   TEXT PRIMARY KEY,              -- ID gerado no sistema de origem (ou automatico)
  nome                 TEXT NOT NULL,
  obra                 TEXT,
  solicitante          TEXT,
  status               TEXT NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente', 'em_separacao', 'concluida', 'cancelada')),
  arquivo_nome         TEXT,
  arquivo_caminho      TEXT,
  itens_total          INTEGER NOT NULL DEFAULT 0,
  criada_em            TEXT NOT NULL,
  atualizada_em        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobilizacoes_status ON mobilizacoes (status, criada_em DESC);

-- 2. Itens da mobilizacao: uma linha por material do Excel.
--    "linha" guarda a linha real da planilha para o sistema de origem
--    preencher a coluna "Estoque" na linha certa.
CREATE TABLE IF NOT EXISTS mobilizacao_itens (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  mobilizacao_id        TEXT NOT NULL REFERENCES mobilizacoes (id) ON DELETE CASCADE,
  linha                 INTEGER NOT NULL,
  codigo                TEXT,
  descricao             TEXT NOT NULL,
  unidade               TEXT,
  quantidade_solicitada REAL NOT NULL CHECK (quantidade_solicitada >= 0),
  observacao            TEXT,
  dados_origem          TEXT                           -- JSON da linha original (auditoria/mapeamento)
);

CREATE INDEX IF NOT EXISTS idx_itens_mobilizacao ON mobilizacao_itens (mobilizacao_id, linha);

-- 3. Separacao: uma por mobilizacao. Nasce como rascunho e vira 'enviada'.
CREATE TABLE IF NOT EXISTS separacoes (
  id              TEXT PRIMARY KEY,
  mobilizacao_id  TEXT NOT NULL UNIQUE REFERENCES mobilizacoes (id) ON DELETE CASCADE,
  operador        TEXT,
  status          TEXT NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'enviada')),
  observacao      TEXT,
  criada_em       TEXT NOT NULL,
  atualizada_em   TEXT NOT NULL,
  enviada_em      TEXT
);

-- 4. Conferencia item a item.
--    disponivel NULL = ainda nao conferido; 1 = tem em estoque; 0 = nao tem.
CREATE TABLE IF NOT EXISTS separacao_itens (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  separacao_id         TEXT NOT NULL REFERENCES separacoes (id) ON DELETE CASCADE,
  mobilizacao_item_id  INTEGER NOT NULL REFERENCES mobilizacao_itens (id) ON DELETE CASCADE,
  disponivel           INTEGER CHECK (disponivel IN (0, 1)),
  quantidade_separada  REAL,
  patrimonios          TEXT,                           -- lista livre separada por virgula
  observacao           TEXT,
  UNIQUE (separacao_id, mobilizacao_item_id)
);

-- 5. Notificacoes do sininho (equipe operacional).
CREATE TABLE IF NOT EXISTS notificacoes (
  id             TEXT PRIMARY KEY,
  mobilizacao_id TEXT NOT NULL REFERENCES mobilizacoes (id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'mobilizacao_pendente',
  titulo         TEXT NOT NULL,
  mensagem       TEXT,
  lida_em        TEXT,
  criada_em      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_lidas ON notificacoes (lida_em, criada_em DESC);

-- 6. Outbox do webhook de retorno ao sistema de origem.
--    Garante reenvio mesmo se o sistema de origem estiver fora do ar.
CREATE TABLE IF NOT EXISTS webhook_entregas (
  id                    TEXT PRIMARY KEY,
  separacao_id          TEXT NOT NULL REFERENCES separacoes (id) ON DELETE CASCADE,
  evento                TEXT NOT NULL,
  payload               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'enviado', 'falhou')),
  tentativas            INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em  TEXT,
  ultimo_erro           TEXT,
  resposta_status       INTEGER,
  criada_em             TEXT NOT NULL,
  enviada_em            TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_pendentes ON webhook_entregas (status, proxima_tentativa_em);
