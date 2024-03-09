import { Elysia } from "elysia";
import { Pool } from 'pg';


const pool = new Pool({
  user: 'admin',
  host: 'localhost',
  database: 'rinha',
  password: '123',
  port: 5432
})

const runWarmup = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
} 

let warmupDone = false
setTimeout(() => {
  pool.connect().then(() => {
    console.log('Connected to database');
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(runWarmup().then(() => console.log('finished warmup')).catch((err) => console.log('Error running warmup', err)));
    }
    Promise.all(promises).then(() => {
      console.log('Warmup finished');
    }).catch((err) => {
      console.log('Error running warmup', err);
    }).finally(() => {
      warmupDone = true;
    });
  }).catch((err) => {
    console.log('Error connecting to database', err);
    process.exit(1);
  });
}, 10000);

const app = new Elysia().listen(process.env.APP_PORT as string);

type Customer = {
  id?: number;
  limite: number;
  saldo: number;
};

type CustomerWithTransactions = {
  saldo: {
    total: number;
    data_extrato: Date;
    limite: number;
  };
  ultimas_transacoes: {
    valor: number;
    tipo: string;
    descricao: string;
    realizada_em: Date;
  }[]
}

app.post("/clientes/:id/transacoes", async ({ body, params: { id }, set }) => {
  let body1 = body as unknown as any;
  const valor = Number(body1?.valor);
  const tipo = body1?.tipo;
  const parsedId = Number(id);
  const descricao = body1?.descricao;
  if (!id || isNaN(parsedId)) {
    set.status = 404;
    return
  }

  if (parsedId < 1 || parsedId > 5) {
    set.status = 404;
    return
  }

  if (!descricao || descricao.length < 1 || descricao.length > 10) {
    set.status = 400;
    return
  }

  if (tipo !== 'c' && tipo !== 'd') {
    set.status = 400;
    return
  }

  const vlrStr = String(body1?.valor);

  if (!valor || isNaN(valor) || vlrStr.includes('.') || vlrStr.includes(',')) {
    set.status = 400;
    return
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customer = (await client.query('SELECT * FROM clientes where id = $1 FOR UPDATE', [parsedId])).rows[0] as Customer;
    customer.limite = Number(customer.limite);
    customer.saldo = Number(customer.saldo);
    if (tipo === 'd') {
      if (valor > customer.limite + customer.saldo) {
        set.status = 422;
        await client.query('ROLLBACK')
        return
      }
  
      customer.saldo -= valor;
    } else if (tipo === 'c') {
      customer.saldo += valor;
    }
  
    await client.query('INSERT INTO transacoes (valor, descricao, tipo, cliente_id) VALUES ($1, $2, $3, $4)', [valor, descricao, tipo, id]);
    await client.query('UPDATE clientes SET saldo = $1 WHERE id = $2', [customer.saldo, id]);
    await client.query('COMMIT');
  
    return {
      limite: customer.limite,
      saldo: customer.saldo
    }
  } catch (error) {
    await client.query('ROLLBACK')
    set.status = 500
    throw error
  } finally {
    client.release()
  }
})

app.get("/clientes/:id/extrato", async ({ params: { id }, set }) => {
  if (!warmupDone) {
    set.status = 500;
    return
  }
  const parsedId = Number(id);
  if (!id || isNaN(parsedId)) {
    set.status = 404;
    return
  }

  if (parsedId < 1 || parsedId > 5) {
    set.status = 404;
    return
  }

  const client = await pool.connect()

  try {
    const customer = (await client.query('SELECT * FROM clientes where id = $1', [parsedId])).rows[0] as Customer;
    const res: CustomerWithTransactions = {
      saldo: {
        total: Number(customer.saldo),
        data_extrato: new Date(),
        limite: Number(customer.limite)
      },
      ultimas_transacoes: []
    }
    let query = 'SELECT valor, tipo, descricao, realizada_em FROM transacoes WHERE cliente_id = $1 ORDER BY realizada_em DESC LIMIT 10';
  
    res.ultimas_transacoes = (await client.query(query, [id])).rows;
    res.ultimas_transacoes.forEach((t) => {
      t.valor = Number(t.valor);
    });
    delete customer.id;
    return res;
  } finally {
    client.release()
  }

})

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
